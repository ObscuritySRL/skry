# Slate.js / controlled-contentEditable SET — can we set the value focus-free + keystroke-free? — 2026-06-20

User ask (Panel B capability): "we apparently cannot set_value to Slate.js inputs, so we have to use keystrokes.
Deep-dive making this a feature — set values without requiring focus OR keystrokes. Surely there is some way."
Target the user named live: **Discord's message box (Slate.js in Electron), and the slatejs.org playground (Slate in a browser tab).**

## VERDICT — NO native focus-free + keystroke-free path that enters Slate's MODEL. (declined wall, recorded)

There is no UI Automation, MSAA/IAccessible, or IAccessible2 path on Windows that sets a Slate.js editor's text
(or any "controlled contentEditable": Draft.js, Lexical, ProseMirror, TipTap, Quill, CKEditor5) **without OS focus
and without per-character keystrokes** such that the text actually enters the editor's model and sticks. The honest
native floor for reliable Slate entry is **focus + synthetic keystrokes** (umbriel's existing `type`). The only path
that is genuinely focus-free + keystroke-free is **CDP `Input.insertText`** — a Chromium DevTools transport umbriel
does NOT have and which is out of its native-Win32 thesis (see "Why not CDP" below).

## Hands-on empirical results (live probes this session — `.scratch/`, all windows closed after)

1. **Browser TAB (slatejs.org/examples/richtext in Edge):** ValuePattern.SetValue on the contentEditable EDIT
   (ct=50004, name="", `IsValuePatternAvailable=true`, `Value.IsReadOnly=false`) **WORKED and changed the text when
   the Edge window was FOREGROUND at launch**, but **FAILED with HRESULT 0x80131509 once the window was not active**
   (background/minimized) — and a non-visible background tab's renderer is throttled, so the editable isn't even fully
   exposed. So for a browser tab it is foreground-gated, not focus-free.

2. **Electron app (Discord, real Slate message box, no-own-HWND Chromium sub-control):** `setValue` was **reliable and
   clean — 8/8 trials exact-replace, zero artifacts** (an earlier stray "a" was the USER typing concurrently, not a
   lossy set — confirmed clean on the rigorous retry). It changed the visible DOM text every time. **BUT** I could not
   isolate the focus-free question empirically: Windows foreground-lock prevents a background automation process from
   moving the foreground OFF an actively-used window, so `fgBefore` was Discord every trial and a "steal" could not be
   detected. (The box being a no-own-HWND sub-control means umbriel's model would route it through the focus-clean
   ValuePattern path rather than the SetFocus/BM_CLICK steal path — but that wasn't the decisive question.)

   **The decisive question is not focus — it is whether the set enters Slate's MODEL. Per the primary-source research
   below, it does NOT: the UIA set is a bulk DOM `setInnerText` with no input events, so it is a phantom DOM change,
   not a Slate edit.** My 8/8 "worked" measured the DOM (UIA TextPattern reads the DOM), not Slate's model. I did not
   (and must not) press Enter to test whether Discord would actually SEND it — but the mechanism says it would not
   reliably, because Slate's model was never updated. **This is exactly why the user observes "we have to use keystrokes."**

## Mechanism — why every native write surface fails (primary sources; research agent, verified)

- **Slate is model-as-truth.** It registers a native `beforeinput` listener, uses `getTargetRanges()`, calls
  `preventDefault()`, and applies the edit to its OWN model (`Editor.insertText`) — it does not let the browser mutate
  the DOM. A `MutationObserver` + `restoreDOM()` revert out-of-band DOM changes. So a mutation that does NOT arrive via
  `beforeinput`/`input` is not seen as an edit and is overwritten/ignored. Same for Lexical / ProseMirror / TipTap.
- **UIA: no settable pattern for contentEditable.** `ITextProvider` (TextPattern) is READ-ONLY. Chromium's Windows UIA
  exposes a settable Value pattern only for native `<input>/<textarea>` + range/picker roles — a contentEditable rich
  region gets only the read-only Text pattern. (`ax_platform_node_delegate_utils_win.cc IsValuePatternSupported`.)
- **IAccessible2: dead end.** Chromium does NOT implement `IAccessibleEditableText` on web content —
  `QueryInterface(IID_IAccessibleEditableText)` returns **E_NOINTERFACE** (the interface is entirely absent, not just
  unimplemented). There is no native `insertText`/`replaceText` to call. (NVDA/JAWS type into web editors by passing
  real keystrokes, not IA2 editable-text.)
- **The kSetValue smoking gun.** UIA `IValueProvider::SetValue` and IA2 `IAccessibleValue` both marshal a `kSetValue`
  action through the renderer. In Blink `AXNodeObject::OnNativeSetValueAction`: `<input>/<textarea>` →
  `SetValue(..., kDispatchInputAndChangeEvent)` (fires input/change), but **contentEditable → `setInnerText(string)`**
  — a bulk DOM replacement with **NO `beforeinput`/`input` dispatch**. So even where a Value set lands on a
  contentEditable (Electron), it bypasses the input pipeline → a controlled editor reverts/ignores it at the model level.
- **TextEdit pattern (`ITextEditProvider`)**: notification-only (composition/autocorrect), no write method.
- **TSF / `ITextStoreACP`**: the text store is owned by the app's focused renderer; an external process can't acquire
  the manager lock. Not a cross-process set path.
- **SendInput / posted WM_CHAR**: SendInput is foreground/focus-bound and UIPI-gated (not focus-free); posted WM_CHAR
  to Chromium's render HWND is ignored for web content (confirmed live — `postText` had no effect).

## What WOULD work, and why not (CDP)

**CDP `Input.insertText`** (what Playwright's `fill()` uses for contentEditable) injects text at the renderer/page
level, firing real `beforeinput`/`input` so Slate's model updates — focus-free, keystroke-free, background/headless.
That is the ONLY working mechanism. umbriel does NOT adopt it:
- It is a **new transport** (a WebSocket CDP client) — outside umbriel's native UIA/Win32 thesis and app-agnostic reach.
- **Chromium-only** (not Firefox, not native Win32 apps).
- Requires the browser launched with **`--remote-debugging-port`**; **Chrome 136+ ignores it against the default
  profile** (anti-cookie-theft hardening) → you must relaunch with a fresh non-default `--user-data-dir`, i.e. you
  **cannot attach to the user's existing logged-in Discord/Chrome session.** That defeats the actual use case.

So a CDP lane buys a Chromium-only, fresh-profile-only, new-transport capability that can't drive the user's real
session — it does not clear the net-benefit bar for a native desktop substrate. **DECLINED — owner decision if ever.**

## Recommendation (the GENERAL primitive already covers it)

For Slate / controlled web editors, the reliable umbriel path is the EXISTING general `type` primitive (focus +
synthetic keystrokes — real input events Slate's model accepts). `set_value` (ValuePattern) is NOT reliable for these
editors (phantom DOM change). No new tool is warranted; this is a documented wall, not a ship. If desired, a future
HARDEN could make `set_value`/the agent guidance WARN when the target is a contentEditable/Chromium sub-control that
its set won't truly enter (owner-decision, byte-changing) — recorded here, not built.

## Constraint for future passes (re-confirm before re-investigating)
- Native focus-free + keystroke-free SET of a controlled web editor's MODEL = WALL (UIA/IA2 have no contentEditable
  write that fires input events; kSetValue→setInnerText is reverted). Re-confirm only if Chromium adds an
  IAccessibleEditableText impl or a settable contentEditable Value pattern (neither exists as of 2026-01).
- CDP transport = declined (new transport, Chromium-only, can't reach the user's logged-in session). Still not worth it.
