/**
 * reveal-winui-virtualized — reveal() must REALIZE a deep item in a WinUI3 / XAML virtualized list, not hand back an
 * unrealized ghost. A WinUI ListView keeps off-screen items in the UIA tree by NAME but unrealized (isOffscreen, a
 * {0,0,0,0} rect, no actionable pattern), AND reports verticallyScrollable=false on the List itself (the real scroll is
 * on its ScrollViewer, surfaced as a Pane). Before the fix reveal() early-returned the ghost and scrolled the wrong
 * (non-scrollable) container, so an AI could read a row's name but never click it — on the dominant modern-UI shape
 * (Settings/Store/Photos/Xbox). The fix: don't accept a found-but-unrealized item, and when the auto-picked container
 * can't scroll, fall back to the most-specific scrollable Pane.
 *
 * Proof: open Settings → Installed apps (a long WinUI virtualized list), pick a DEEP item, assert a direct find returns
 * it UNREALIZED (offscreen / zero rect), then assert reveal() returns it REALIZED with a real on-screen rect. Skips
 * cleanly if Settings doesn't open or the list is short. Settings killed in finally.
 *
 * bun test is broken repo-wide for FFI; runnable harness (opens + kills its own Settings):
 * Run: bun run example/reveal-winui-virtualized.integration.test.ts
 */
import { closeWindow, ControlType, killProcess, openPath, umbriel, windowProcessId } from 'umbriel';

let failures = 0;
let asserted = 0;
function assert(condition: boolean, message: string): void {
  asserted += 1;
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
openPath('ms-settings:appsfeatures');
let hWnd = 0n;
for (let i = 0; i < 40 && hWnd === 0n; i += 1) {
  await Bun.sleep(500);
  for (const w of umbriel.windows()) if (/settings/i.test(w.title)) { hWnd = w.hWnd; break; }
}
try {
  if (hWnd === 0n) {
    console.log('  skip: Settings did not open (ms-settings unavailable on this host)');
  } else {
    const win = umbriel.attach(hWnd);
    await Bun.sleep(2500);
    let items = win.findAll({ controlType: ControlType.ListItem });
    for (let i = 0; i < 8 && items.length < 20; i += 1) {
      for (const it of items) it.release();
      await Bun.sleep(500);
      items = win.findAll({ controlType: ControlType.ListItem });
    }
    const names = items.map((it) => it.name).filter((n) => n.length > 0);
    for (const it of items) it.release();
    if (names.length < 12) {
      console.log(`  skip: only ${names.length} list items — too short to have an off-screen item`);
    } else {
      const target = names[Math.floor(names.length * 0.85)]!; // deep in the list, guaranteed off-screen at rest
      const direct = win.find({ name: target });
      const ghost = direct !== null && (direct.isOffscreen || direct.boundingRectangle.width === 0);
      assert(ghost, `a direct find of the deep item "${target.slice(0, 32)}" is an UNREALIZED ghost (offscreen / zero rect) — the WinUI virtualization the fix must overcome`);
      direct?.release();

      const revealed = win.reveal({ name: target });
      assert(revealed !== null, 'reveal() returned the deep item (did not give up)');
      if (revealed !== null) {
        const rect = revealed.boundingRectangle;
        assert(!revealed.isOffscreen && rect.width > 0 && rect.height > 0, `reveal() REALIZED it on-screen with a real rect (${rect.x},${rect.y} ${rect.width}x${rect.height}) — now clickable, not a ghost`);
        revealed.release();
      }
    }
  }
} finally {
  if (hWnd !== 0n) {
    const pid = windowProcessId(hWnd);
    closeWindow(hWnd);
    await Bun.sleep(300);
    if (pid) killProcess(pid);
  }
  umbriel.uninitialize();
}

console.log(failures > 0 ? `\nFAILED — ${failures} assertion(s)` : asserted === 0 ? '\nINCONCLUSIVE — scenario not exercised (Settings unavailable / list short)' : '\nPASS — reveal() realizes a deep WinUI virtualized-list item on-screen (drivable, not a ghost).');
process.exit(failures > 0 ? 1 : 0);
