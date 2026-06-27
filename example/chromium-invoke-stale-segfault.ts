/**
 * Chromium stale-element InvokePattern segfault — controlled repro
 *
 * Description:
 *   Isolates the destructive half of the reported crash: calling the REAL InvokePattern on a Chromium element
 *   that was torn down between resolve and act. Launches its OWN throwaway Edge window pointed at a local page
 *   whose DOM rebuilds its entire link list every 30ms (mimicking Discord's DM-list re-render while the user is
 *   active), then loops: findAll({controlType: Hyperlink}) → wait ~60ms so the page destroys those exact nodes →
 *   fire InvokePattern.Invoke() on the now-STALE proxies. This is the "element destroyed between resolve and
 *   invoke" race find_and_act hits under live churn, made deterministic. Invoking an in-page <a href="#"> is
 *   harmless, so it never touches the user's real apps.
 *
 *   Outcome legend:
 *     • guardThrows counted, process exits 0  ⇒ the stale invoke is CAUGHT (vcall guard / UIA_E HRESULT) — SAFE.
 *     • hard exit (code 3, "Segmentation fault") ⇒ the reported uncatchable crash REPRODUCED.
 *
 * APIs demonstrated:
 *   - umbriel.launch / Window.webRoots / Window.findAll / Element.release / closeWindow
 *   - vcall(GetCurrentPattern) + vcall(Invoke) + comRelease (real cross-process InvokePattern over FFI/COM)
 *
 * Run: bun run example/chromium-invoke-stale-segfault.ts [iterations]
 */

import { FFIType } from 'bun:ffi';

import { comRelease, vcall } from '../com/com';
import { ControlType, PatternId, S_OK, SLOT } from '../com/constants';
import { umbriel } from '../index';
import { closeWindow } from '../element/window';

const iterations = Number(Bun.argv.slice(2).find((part) => /^\d+$/.test(part)) ?? 400);

const edgeCandidates = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];
const edge = edgeCandidates.find((path) => Bun.file(path).size > 0);
if (edge === undefined) {
  console.log('[repro] Edge not found in the standard locations — pass a Chromium exe path or run the Discord repro instead.');
  process.exit(2);
}

// Churning page: the link container's innerHTML is replaced every 30ms, so every <a> the UIA tree exposes is
// destroyed and recreated continuously — the same teardown a busy Discord/Electron view does between snapshots.
const html = `<!doctype html><html><head><meta charset="utf-8"><title>UMBRIEL-CHURN-TARGET</title></head>
<body><h1>umbriel churn target</h1><div id="box"></div>
<script>
let n = 0;
function rebuild() {
  const box = document.getElementById('box');
  box.innerHTML = '';
  for (let i = 0; i < 60; i += 1) {
    const a = document.createElement('a');
    a.href = '#' + (n++);
    a.textContent = 'link-' + i + '-' + n;
    box.appendChild(a);
  }
}
setInterval(rebuild, 16);
rebuild();
</script></body></html>`;
const htmlPath = `${Bun.env.TEMP ?? '.'}\\umbriel-churn.html`;
await Bun.write(htmlPath, html);
const url = `file:///${htmlPath.replaceAll('\\', '/')}`;

console.log(`[repro] launching Edge → ${url}`);
console.log(`[repro] iterations=${iterations} bun=${Bun.version} (${Bun.revision})`);
umbriel.initialize();
// Force a FRESH, isolated Edge process (own user-data-dir) so --force-renderer-accessibility is honored — a plain
// --new-window would reuse an already-running Edge process and silently drop the a11y flag, leaving an empty UIA tree.
const profileDir = `${Bun.env.TEMP ?? '.'}\\umbriel-edge-profile`;
Bun.spawn([edge, '--new-window', '--force-renderer-accessibility', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', url], { stdout: 'ignore', stderr: 'ignore' });

// Poll for the throwaway window by its page title (a fresh title no other window has), then attach by hWnd.
let win = null as ReturnType<typeof umbriel.attach> | null;
let hWnd = 0n;
for (let attempt = 0; attempt < 40 && win === null; attempt += 1) {
  await Bun.sleep(250);
  const found = umbriel.windows({ includeUntitled: true }).find((window) => window.title.includes('UMBRIEL-CHURN-TARGET'));
  if (found !== undefined) {
    hWnd = found.hWnd;
    win = umbriel.attach(found.hWnd);
  }
}
if (win === null) {
  console.log('[repro] Edge window never appeared (title UMBRIEL-CHURN-TARGET). a11y may be disabled or the launch was blocked.');
  process.exit(2);
}
console.log(`[repro] attached to ${JSON.stringify(win.name)} hWnd=0x${hWnd.toString(16)} class=${win.className}`);
await Bun.sleep(800); // let the page paint + a11y tree realize

const patternOut = Buffer.alloc(8);
let totalInvoked = 0;
let totalGuardThrows = 0;
let totalStaleLinks = 0;
const start = Bun.nanoseconds();

try {
  for (let i = 0; i < iterations; i += 1) {
    const roots = win.webRoots();
    // The bridge can expose page content under the top-level window directly OR only under each render-widget root.
    // Use the render-widget roots when present; otherwise fall back to the window itself (never released here).
    const scopes = roots.length > 0 ? roots : [win];
    if (i === 0) {
      const winLinks = win.findAll({ controlType: ControlType.Hyperlink });
      console.log(`[repro] diag: webRoots=${roots.length}, window-scope Hyperlinks=${winLinks.length}, per-webRoot Hyperlinks=${roots.map((root) => root.findAll({ controlType: ControlType.Hyperlink }).reduce((count, link) => (link.release(), count + 1), 0)).join(',')}`);
      for (const link of winLinks) link.release();
    }
    for (const root of scopes) {
      const links = root.findAll({ controlType: ControlType.Hyperlink });
      totalStaleLinks += links.length;
      await Bun.sleep(60); // the page rebuilds (~2×) during this — every `links` proxy now points at a destroyed DOM node
      for (const link of links) {
        try {
          // The exact two cross-process calls Element.invoke() makes — on a STALE Chromium proxy.
          if (vcall(link.ptr, SLOT.GetCurrentPattern, [FFIType.i32, FFIType.ptr], [PatternId.Invoke, patternOut.ptr!]) === S_OK) {
            const pattern = patternOut.readBigUInt64LE(0);
            if (pattern !== 0n) {
              vcall(pattern, SLOT.Invoke, [], []); // REAL InvokePattern.Invoke() across the process boundary
              comRelease(pattern);
              totalInvoked += 1;
            }
          }
        } catch (error) {
          totalGuardThrows += 1;
          if (totalGuardThrows <= 3) console.log(`[repro]   caught guard throw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const link of links) link.release();
    }
    for (const root of roots) root.release();
    if (i % 25 === 0 || i === iterations - 1) {
      const seconds = ((Bun.nanoseconds() - start) / 1e9).toFixed(1);
      console.log(`[repro] iter ${i}/${iterations} staleLinks=${totalStaleLinks} invoked=${totalInvoked} guardThrows=${totalGuardThrows} elapsed=${seconds}s`);
    }
  }
  console.log(`[repro] SURVIVED ${iterations} iterations — invoked ${totalInvoked} stale proxies, ${totalGuardThrows} caught guard throws, NO segfault`);
} finally {
  if (hWnd !== 0n) closeWindow(hWnd); // WM_CLOSE the throwaway Edge window
  umbriel.uninitialize();
}
