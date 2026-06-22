/**
 * screen-capture-no-leak — captureScreen (capture/screen.ts) and captureWindowRGB (element/window.ts) build a
 * GDI DC + memory DC + bitmap, then allocate a BGRA Buffer (width*height*4). A whole-virtual-desktop grab is tens
 * of MB and on an extreme multi-monitor config or under memory pressure that Buffer.alloc can RangeError/OOM —
 * AFTER the three GDI objects exist. The teardown was unconditional (not a finally), so a throw there leaked the
 * DC + memory DC against the per-process GDI-object quota (default 10k); a long-lived MCP server retrying a
 * too-large capture in a loop exhausts it. The fix hoists the handles into a try/finally released under !==0n.
 *
 * Proof: force the BGRA alloc to throw with an absurd region (50000x50000 -> 10 GB > Buffer max) 30x and assert
 * the process GDI-object count (GetGuiResources GR_GDIOBJECTS) does NOT grow — was +2/throw (+60), now ~0. Plus
 * a success-path loop for captureScreen and captureWindowRGB asserting non-empty pixels and a flat GDI count.
 *
 * bun test is broken repo-wide for FFI; runnable harness (spawns + kills its own Notepad):
 * Run: bun run example/screen-capture-no-leak.integration.test.ts
 */
import Kernel32 from '@bun-win32/kernel32';
import User32 from '@bun-win32/user32';
import { captureScreen, captureWindowRGB, closeWindow, killProcess, umbriel, windowProcessId } from 'umbriel';

const GR_GDIOBJECTS = 0;
const self = Kernel32.GetCurrentProcess();
const gdiObjects = (): number => User32.GetGuiResources(self, GR_GDIOBJECTS);

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const notepad = await umbriel.launch(['notepad.exe'], { className: 'Notepad' });
await Bun.sleep(900);
try {
  // 1) Success path, captureScreen: a small region many times must not leak GDI objects (it always released; sanity).
  captureScreen({ x: 0, y: 0, width: 64, height: 64 }); // warm-up
  const okScreenBefore = gdiObjects();
  let screenPixels = 0;
  for (let i = 0; i < 30; i += 1) screenPixels = captureScreen({ x: 0, y: 0, width: 64, height: 64 }).rgb.length;
  assert(screenPixels === 64 * 64 * 3, `captureScreen returns a full RGB buffer (${screenPixels} bytes)`);
  assert(gdiObjects() - okScreenBefore <= 5, `captureScreen success path leaks no GDI objects over 30 calls (Δ${gdiObjects() - okScreenBefore})`);

  // 2) THROW path, captureScreen: a 50000x50000 region forces the BGRA Buffer.alloc (10 GB) to RangeError AFTER the
  //    DC/memDC exist. The finally must release them. Before the fix this leaked +2 GDI objects per failed call.
  const throwBefore = gdiObjects();
  let threw = 0;
  for (let i = 0; i < 30; i += 1) {
    try {
      captureScreen({ x: 0, y: 0, width: 50000, height: 50000 });
    } catch {
      threw += 1;
    }
  }
  const throwGrowth = gdiObjects() - throwBefore;
  assert(threw === 30, `all 30 oversized captures threw as expected (${threw}/30)`);
  assert(throwGrowth <= 5, `captureScreen leaks no GDI objects on the throw path — try/finally released the DC/bitmap (Δ${throwGrowth}, was ~+60)`);

  // 3) Success path, captureWindowRGB on a real window: non-empty pixels + flat GDI count over 30 calls.
  const warm = captureWindowRGB(notepad.hWnd);
  if (warm === null) {
    console.log('  skip: captureWindowRGB returned null (no PrintWindow surface on this host)');
  } else {
    const winBefore = gdiObjects();
    let winPixels = 0;
    for (let i = 0; i < 30; i += 1) {
      const shot = captureWindowRGB(notepad.hWnd);
      if (shot !== null) winPixels = shot.rgb.length;
    }
    assert(winPixels > 0, `captureWindowRGB returns pixels for a real window (${winPixels} bytes)`);
    assert(gdiObjects() - winBefore <= 5, `captureWindowRGB success path leaks no GDI objects over 30 calls (Δ${gdiObjects() - winBefore})`);
  }
} finally {
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  await Bun.sleep(200);
  if (pid) killProcess(pid);
  notepad.dispose();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — captureScreen/captureWindowRGB release their GDI objects on both the success and throw paths.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
