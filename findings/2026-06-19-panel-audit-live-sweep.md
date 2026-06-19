# Panel audit + live integration sweep — 2026-06-19

Iteration run on Windows 11 build 26200, Bun 1.4.0-canary. Baseline at start was
green (`tsc --noEmit` 0; `bun run index.ts` clean). Desktop was unattended/idle
during the sweep (relevant — see "artifacts" below).

## Shipped this iteration (3 commits, pushed to main)

- `dafe447` — README missing the live tool-count string that `test/tool-count.test.ts`
  asserts (the test was RED). Added `**61 snapshot-first tools** (55 safe / 22 readonly / 6 os-fs)`.
- `9820e2d` — README missing the UWP/WinUI minimized-suspend caveat asserted by
  `example/minimized-uwp-caveat.integration.test.ts` (AI.md + MCP instructions already had it).
- `2b8034a` — `example/selector-controltype.integration.test.ts` was STALE: it asserted
  `{role, label}` is rejected as an unknown selector key, but `SELECTOR_ALIASES` (mcp.ts:361)
  folds `role→controlType`, `label→name` as documented aliases (tool description + error string
  advertise them). Re-pointed the assertion at a genuinely-unknown key (`frobnicate`).

## Panel A (critics) — verified results

- **BG+FG parity (Hofstadter):** CLEAN. Every acting verb tries cursor-free first; foreground
  raises are disclosed in result strings or documented as OS walls. Test-backed.
- **Security/policy (Nadkarni):** CLEAN. Profile buckets, deny-wins, FS sandbox (traversal/reparse),
  `UMBRIEL_CURSOR=never`, and secret redaction all enforced at traced gates.
- **Capability (Vendt, Panel B):** No real gaps with an implementable path. Remaining ideas
  (UIA Drag/DropTarget pattern, annotation/spreadsheet patterns, auto-retry on pattern-init race)
  are rare / out-of-scope / unproven and were NOT added (no reproduced failing case).
- **Perf (Watanabe):** Only candidate was hoisting per-compile scratch buffers in
  `element/condition.ts` (~1µs, one-time per find/waitFor). DECLINED — sub-µs gain vs. shared-mutable
  aliasing risk; against surgical/measure-don't-assume. Everything else already optimized
  (regex memoization, compile-once waitFor, scalar-VARIANT fast path, module-scope scratch in reads.ts).

## Adversarial verification — auditor findings DISPROVEN (constraints, re-confirmed NOT bugs)

The segfault-safety auditor (Kessler) reported 3 "correctness" findings. All disproven against source:

1. **`capture/wgc.ts:255` "malformed vcall / FFIType.void / stack misalignment" — FABRICATED.**
   `wgc.ts` defines its OWN local `vcall` (wgc.ts:65) with a 5th `returns: FFIType = FFIType.i32`
   parameter (comment: "the D3D11 readback needs void/u32 returns"). `ID3D11Texture2D::GetDesc`
   returns `void`, so `vcall(..., FFIType.void)` is CORRECT. The auditor conflated it with
   `com/com.ts`'s 4-arg `vcall` (always returns i32). `tsc` is green, so a 5th arg to the com.ts
   vcall is impossible anyway (TS2554).
2. **`capture/ocr.ts` "unchecked HRESULT → uninitialized/garbage reads / infinite wait" — NOT A BUG.**
   Every `out` buffer is `Buffer.alloc(...)` which ZERO-fills, and every downstream site guards
   `0n` handles / zero counts / empty strings, and the poll loop is deadline-bounded. A failed call
   degrades to an empty/zero OCR result — the documented intended behavior. No garbage, no hang.
3. **`com/cache.ts` builder methods ignore HRESULT — NOT clearly a bug.** If `AddProperty` fails for
   an unsupported property, silently skipping (current behavior) is MORE robust than throwing
   (a cached read then returns the not-available sentinel). Throwing would reduce robustness.

Lesson: auditor findings are hypotheses; verify against the exact source + runtime semantics
(local vs shared `vcall`; `Buffer.alloc` zero-fill) before acting. None reached main on say-so.

## Live integration sweep (184 tests) + isolation re-run

Full sweep: **164 pass / 19 fail / 1 timeout.** Re-ran the 17 fail/timeout candidates in ISOLATION
on a cleaned desktop. **6 flipped to PASS** — they were unattended-desktop / interference artifacts,
NOT umbriel regressions:

- `click-no-raise-waitstate`, `element-drag-to`, `key-state` — foreground/SendInput tests that depend
  on foreground-lock state; an idle desktop with nothing holding the lock breaks their baseline.
- `close-modal-honest` — TIMED OUT (120s) leaving a hung Notepad "save?" modal that then poisoned the
  next several Notepad-based tests (`copy-secret`, `cursor-free-*`). Root cause of the cluster.
- `launch-cold-winui-settle`, `window-events` — timing/interference; pass clean.

CONSTRAINT for future sweeps: run integration tests SERIALLY with per-test timeouts and kill leaked
GUI processes between runs. `close-modal-honest`'s teardown can't dismiss an ambiguous "Don't save"
(selector matches 2 controls) and hangs — that test needs a more robust teardown (force-kill the PID).

## Win11-Notepad coupling (constraint — tests assume classic Win10 EDIT)

Still-failing in isolation, ALL coupled to Notepad's control: `cursor-free-copy-cut`,
`cursor-free-mcp-input`, `cursor-free-undo`, `copy-secret-redacted-not-journaled`, `snapshot-leak`.
On Win11 (26200) Notepad is a packaged **WinUI/RichEditD2D** app, not the classic `EDIT` control, so
PostMessage `WM_COPY`/`WM_CUT`/`WM_CHAR`/`WM_PASTE`/`EM_UNDO` and the tree-walk shape differ from what
these tests assume. The SAFETY properties still hold (cut still shows `«redacted»`; leak-release still
passes). Other cursor-free tests on classic controls PASS (`type-cursorfree`, `cursor-free-input`,
`cursor-free-copy`), so the posting paths themselves are fine. INVESTIGATION QUEUE: retarget these
tests to a classic Win32 `EDIT` (synthetic window, like click-no-raise-waitstate does) instead of
Notepad — AND confirm whether `cursor-free-mcp-input`'s "type reports cursor-free [success]" while the
text doesn't read back is a FALSE-SUCCESS honesty bug on RichEditD2D (type should fall back to
ValuePattern/TextPattern when WM_CHAR won't land) or just a read-back artifact. Probe Win11 Notepad's
control class live before deciding.

## Investigation queue (deterministic, still failing — NOT yet classified real vs test)

- `text-cap` — `read_clipboard` of a 9000-char `set_clipboard` payload returned only 109 chars with no
  "+N more chars" note, even in isolation. Read the clipboard-cap code in mcp.ts; determine whether
  set_clipboard truncates, read caps wrong, or the note wording drifted.
- `mcp-snapshot-economy` — the test's 2nd `invoke` is called WITHOUT a `ref` and errors
  ("missing required argument: ref"); it expects a compact Δ delta. Likely a test bug (omitted ref) —
  read the test and confirm.
- `find-and-act-popup` — `find_and_act {do:expand}` matched 3 controls and refused (ambiguous). App-state
  dependent; check the target app/selector.
- `safety-floor [A]` — WGC bundle lifecycle subprocess (init→capture→uninitialize→capture ×3) exits 2.
  Could be a real WGC-rebuild-after-uninitialize bug OR no stable capturable window in the subprocess.
  Run the subprocess directly with visible output.
- `vcall-safety [A]` — subprocess fault test expected a specific clean-crash signature; got exit=1/no-signal/
  empty-output. Brittle to Bun 1.4 canary's uncatchable-segfault behavior (com.ts documents unmapped
  pointers segfault uncatchably). Likely runtime-version sensitivity, not an umbriel bug.

## Owner-scope (do NOT touch per goal — version/release sync)

`mcp.ts` `SERVER_INFO.version` is **1.9.0**, lagging `package.json` **1.9.3** — breaks
`example/instructions-readonly` (compares to package.json, correct) and `example/mcp-trace-journal`
(hardcodes `1.7.0`, itself stale — should derive from package.json). These are release-sync issues for
the owner to resolve during the next release; an autonomous agent must not version-bump or touch the
release manifest.
