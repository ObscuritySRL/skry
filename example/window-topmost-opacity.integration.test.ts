/**
 * window-topmost-opacity — manage_window gained two background-capable, cursor-free window-state controls rivals expose
 * (FlaUI/AutoHotkey/nut.js) but umbriel lacked: ALWAYS-ON-TOP (SetWindowPos HWND_TOPMOST/NOTOPMOST — the persistent
 * topmost band a one-shot raise can't give) and OPACITY (a layered window, alpha 0–255). Both work on a SEPARATE-process
 * background window with no activation, using already-bound user32 (no new binding, no COM).
 *
 * Proof: on a launched Notepad — setTopmost(true) sets WS_EX_TOPMOST (read back via GWL_EXSTYLE), setTopmost(false)
 * clears it; setOpacity(128) adds WS_EX_LAYERED and GetLayeredWindowAttributes reads alpha=128, setOpacity(255) → 255.
 * Notepad killed in finally.
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/window-topmost-opacity.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { closeWindow, killProcess, setOpacity, setTopmost, umbriel, windowProcessId } from 'umbriel';

const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x0000_0008n;
const WS_EX_LAYERED = 0x0008_0000n;

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
await Bun.sleep(800);
try {
  const hWnd = notepad.hWnd;
  const exStyle = (): bigint => User32.GetWindowLongPtrW(hWnd, GWL_EXSTYLE);
  const readAlpha = (): { ok: boolean; alpha: number } => {
    const key = Buffer.alloc(4);
    const alpha = Buffer.alloc(1);
    const flags = Buffer.alloc(4);
    const ret = User32.GetLayeredWindowAttributes(hWnd, key.ptr!, alpha.ptr!, flags.ptr!);
    return { ok: ret !== 0, alpha: alpha.readUInt8(0) };
  };

  assert((exStyle() & WS_EX_TOPMOST) === 0n, 'window is NOT topmost before setTopmost');
  assert(setTopmost(hWnd, true) && (exStyle() & WS_EX_TOPMOST) !== 0n, 'setTopmost(true) set WS_EX_TOPMOST on the background window');
  assert(setTopmost(hWnd, false) && (exStyle() & WS_EX_TOPMOST) === 0n, 'setTopmost(false) cleared WS_EX_TOPMOST');

  assert(setOpacity(hWnd, 128) && (exStyle() & WS_EX_LAYERED) !== 0n, 'setOpacity(128) added WS_EX_LAYERED');
  const half = readAlpha();
  assert(half.ok && half.alpha === 128, `opacity reads back as 128 via GetLayeredWindowAttributes (got ${half.alpha})`);
  setOpacity(hWnd, 255);
  const full = readAlpha();
  assert(full.ok && full.alpha === 255, `setOpacity(255) restored full opacity (got ${full.alpha})`);
} finally {
  const pid = windowProcessId(notepad.hWnd);
  closeWindow(notepad.hWnd);
  await Bun.sleep(200);
  if (pid) killProcess(pid);
  notepad.dispose();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — manage_window topmost + set_opacity drive a background window cursor-free (always-on-top band + layered alpha).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
