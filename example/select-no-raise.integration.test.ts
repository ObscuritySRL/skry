/**
 * select-no-raise — the foreground-stability guard for SelectionItemPattern.Select on a classic own-HWND control, the
 * gap the MCP `select` verb left open. invoke/toggle/set_value DISCLOSE the OS UIA->provider/MSAA-bridge foreground
 * steal via disclosingPatternAct; `select` routed through bare patternAction and claimed a flat "cursor-free". The fix
 * threads a select-accurate steal note (SELECT_STEAL_NOTE) through disclosingPatternAct (keeping invoke/toggle/set_value
 * byte-identical) and routes the act()/handler select verbs through it, so a select that moves foreground says so.
 *
 * This guards the RAW behavior the disclosure keys on (mirroring pattern-no-raise.integration.test.ts for invoke/toggle/
 * set_value): on a synthetic classic radio (BS_AUTORADIOBUTTON, class "BUTTON", own HWND) in a MINIMIZED popup,
 * element.select() may move the foreground to the control's OWN HWND (the documented bridge wall) but MUST NOT raise the
 * parent, which stays minimized — and the select MUST land (BM_GETCHECK==1). The MCP select tool now appends the ⚠ note
 * whenever this foreground move is observed (disclosingPatternAct's foregroundWindow() before/after, same as invoke).
 * The window is self-created and DestroyWindow'd in finally (dispose≠close — no leak).
 *
 * bun test is broken repo-wide for FFI; runnable harness (creates + destroys its own synthetic radio):
 * Run: bun run example/select-no-raise.integration.test.ts
 */
import User32 from '@bun-win32/user32';
import { ControlType, foregroundWindow, fromHandle, isMinimized, minimizeWindow, umbriel } from 'umbriel';

const WS_POPUP = 0x8000_0000;
const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_GROUP = 0x0002_0000;
const WS_TABSTOP = 0x0001_0000;
const WS_CAPTION = 0x00c0_0000;
const BS_AUTORADIOBUTTON = 0x0009;
const BM_GETCHECK = 0x00f0;
const SW_RESTORE = 9;

const msg = Buffer.alloc(48);
function pump(): void {
  for (let i = 0; i < 256; i += 1) {
    if (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, 0x0001) === 0) break;
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
}
const checked = (hWnd: bigint): bigint => User32.SendMessageW(hWnd, BM_GETCHECK, 0n, 0n);

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
const staticClass = Buffer.from('Static\0', 'utf16le');
const buttonClass = Buffer.from('BUTTON\0', 'utf16le');
const parent = User32.CreateWindowExW(0, staticClass.ptr!, Buffer.from('SelectNoRaiseParent\0', 'utf16le').ptr!, WS_POPUP | WS_CAPTION | WS_VISIBLE, 180, 180, 280, 140, 0n, 0n, 0n, null);
const radioA = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Option A\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | BS_AUTORADIOBUTTON, 15, 20, 220, 28, parent, 0n, 0n, null);
const radioB = User32.CreateWindowExW(0, buttonClass.ptr!, Buffer.from('Option B\0', 'utf16le').ptr!, WS_CHILD | WS_VISIBLE | BS_AUTORADIOBUTTON, 15, 56, 220, 28, parent, 0n, 0n, null);

try {
  await Bun.sleep(120);
  pump();
  const radio = fromHandle(radioB);
  try {
    assert(radio.controlType === ControlType.RadioButton, `synthetic control is a RadioButton (${radio.controlTypeName})`);
    assert(radio.nativeWindowHandle === radioB, 'the radio owns its OWN HWND (classic MSAA-bridged — the steal target a no-own-HWND WinUI item would not be)');
    assert(radio.isSelected === false, 'radio exposes SelectionItemPattern and starts unselected');

    minimizeWindow(parent);
    await Bun.sleep(300);
    pump();
    assert(isMinimized(parent), 'parent popup is minimized before select()');
    const before = foregroundWindow();
    assert(before !== parent, `parent is provably NOT the foreground window before select() (fg=0x${before.toString(16)})`);

    radio.select();
    await Bun.sleep(200);
    pump();
    const after = foregroundWindow();

    // The honest outcome (mirrors pattern-no-raise's guard): foreground is unchanged OR moved only to the acted
    // control's OWN HWND (the OS bridge activating it — the wall the MCP select tool now DISCLOSES); never the parent.
    const honest = after === before || after === radioB;
    assert(honest, `select(): foreground is unchanged or moved only to the radio's own HWND (the bridge wall the ⚠ note discloses), not elsewhere (before=0x${before.toString(16)} after=0x${after.toString(16)})`);
    assert(after !== parent, 'select(): did NOT raise the parent popup (the parity claim — the app window is never foregrounded)');
    assert(isMinimized(parent), 'select(): the parent stays minimized (the act did not restore it)');
    assert(checked(radioB) === 1n, 'select() actually LANDED: the radio is now checked (BM_GETCHECK==1) — not a silent no-op');
    if (after === radioB) console.log('  note: select() moved foreground to the radio own HWND — exactly the steal the MCP select tool now appends SELECT_STEAL_NOTE for (parity with invoke/toggle/set_value).');
  } finally {
    radio.release();
  }
} finally {
  User32.ShowWindow(parent, SW_RESTORE);
  User32.DestroyWindow(radioA);
  User32.DestroyWindow(radioB);
  User32.DestroyWindow(parent);
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — SelectionItem.Select on a minimized classic own-HWND radio never raises the parent (foreground stability guarded); the MCP select tool discloses any move to the control own HWND.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
