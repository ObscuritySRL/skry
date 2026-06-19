/**
 * snapshot-leak — a fault mid-walk must not leak COM refs. walk() materializes each child (a new AddRef'd
 * Element) one at a time via the cached control-view walker (firstChildCached / nextSiblingCached) and recurses;
 * if a child's property read throws partway (possible since the vcall guards turn a torn-down-tree
 * use-after-free into a catchable THROW), the already-materialized children must still be released. The fix
 * pushes every child to `owned` the instant it is materialized, so the snapshot's error path frees all of them.
 *
 * Proof: instrument Element — count release() calls and children materialized (via firstChildCached /
 * nextSiblingCached, the path walk() actually uses — NOT the cachedChildren getter, which the walk no longer
 * calls), inject a throw mid-walk, then assert releases >= materialized (every AddRef'd child was released).
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/snapshot-leak.integration.test.ts
 */
import { CacheRequest, closeWindow, Element, snapshot, umbriel, windowProcessId } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
let notepad = 0n;
const prior = new Set(umbriel.windows().filter((w) => /Notepad/i.test(w.className)).map((w) => w.hWnd));
Bun.spawn(['notepad.exe'], { stdout: 'ignore', stderr: 'ignore' });
for (let attempt = 0; attempt < 40 && notepad === 0n; attempt += 1) {
  await Bun.sleep(150);
  notepad = umbriel.windows().find((w) => /Notepad/i.test(w.className) && !prior.has(w.hWnd))?.hWnd ?? 0n;
}

// instrument Element.prototype: count releases + materialized children, and inject a throw mid-walk.
const proto = Element.prototype;
const releaseDescriptor = Object.getOwnPropertyDescriptor(proto, 'release');
const firstChildDescriptor = Object.getOwnPropertyDescriptor(proto, 'firstChildCached');
const nextSiblingDescriptor = Object.getOwnPropertyDescriptor(proto, 'nextSiblingCached');
const controlTypeDescriptor = Object.getOwnPropertyDescriptor(proto, 'cachedControlType');
let releases = 0;
let materialized = 0;
let armed = false;
let controlTypeReads = 0;
const THROW_AT = 6; // mid-tree: after a few nodes are walked, so the old code would orphan later siblings

try {
  assert(notepad !== 0n, 'launched Notepad');
  if (notepad !== 0n) {
    await Bun.sleep(500);
    const win = umbriel.attach(notepad);
    Object.defineProperty(proto, 'release', { configurable: true, value() { if (armed) releases += 1; return releaseDescriptor!.value.call(this); } });
    // Count children via the cached control-view walker — the materialization path walk() actually uses (each
    // returns one new AddRef'd Element, owned by the walk). The old cachedChildren-getter hook counted 0.
    Object.defineProperty(proto, 'firstChildCached', { configurable: true, value(request: CacheRequest) { const child: Element | null = firstChildDescriptor!.value.call(this, request); if (armed && child !== null) materialized += 1; return child; } });
    Object.defineProperty(proto, 'nextSiblingCached', { configurable: true, value(request: CacheRequest) { const child: Element | null = nextSiblingDescriptor!.value.call(this, request); if (armed && child !== null) materialized += 1; return child; } });
    Object.defineProperty(proto, 'cachedControlType', { configurable: true, get() { if (armed && ++controlTypeReads === THROW_AT) throw new Error('injected mid-walk fault'); return controlTypeDescriptor!.get!.call(this); } });

    armed = true;
    let threw = false;
    try {
      const snap = snapshot(win, { maxDepth: 25 });
      snap.dispose(); // didn't throw (tree too small to hit THROW_AT) — disposing still releases everything
    } catch {
      threw = true;
    }
    armed = false;

    assert(threw, `injected a fault mid-walk (controlType read #${THROW_AT})`);
    assert(materialized > 0, `walk materialized children before the fault (${materialized})`);
    assert(releases >= materialized, `every materialized child was released — no leak (releases ${releases} >= materialized ${materialized})`);
    win.dispose();
  }
} finally {
  const notepadPid = notepad !== 0n ? windowProcessId(notepad) : 0;
  if (notepadPid) Bun.spawnSync(['taskkill', '/F', '/PID', String(notepadPid)]);
  if (releaseDescriptor) Object.defineProperty(proto, 'release', releaseDescriptor);
  if (firstChildDescriptor) Object.defineProperty(proto, 'firstChildCached', firstChildDescriptor);
  if (nextSiblingDescriptor) Object.defineProperty(proto, 'nextSiblingCached', nextSiblingDescriptor);
  if (controlTypeDescriptor) Object.defineProperty(proto, 'cachedControlType', controlTypeDescriptor);
  if (notepad !== 0n) closeWindow(notepad);
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — a fault mid-walk releases every materialized child (no COM leak).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
