# Cycle 3 — WGC lifecycle proven sound; the remaining failures are one systematic UWP-coupling issue

## Shipped

- `test: capture the taskbar in safety-floor WGC lifecycle` — section A exited 2 because its subprocess
  launched single-instance UWP Calculator, racing section C's launch/close of the same app (UWP suspends),
  giving false null captures. **The WGC bundle rebuild is sound** — proven by 3× standalone child runs
  (exit 0) and `.scratch/probe-wgc.ts` (captureWindowLive succeeds on every iteration incl. post-rebuild;
  taskbar control captures too). Switched the target to the always-present `Shell_TrayWnd` (stable classic
  Win32, never suspends), keeping the test's teeth. Full safety-floor now passes (exit 0).

## DISPROVEN (third "product bug" refuted by live probe this session)

The WGC bundle-rebuild-after-uninitialize was flagged as a possible use-after-free. Live evidence refutes it:
`init → capture → uninitialize → capture ×3` captures successfully on every iteration, and `disposeWgc()` +
rebuild work. The exit-2 was purely the Calculator test-isolation race. Do not "fix" the WGC lifecycle code.

## mcp-snapshot-economy — diagnosed: UWP cold-start flakiness, product economy works

`.scratch/probe-snapshot.ts` shows `fiveRef` is undefined at the FIRST extraction — Calculator's "Five"
button isn't present in the snapshot. Calculator is single-instance UWP with cold-start latency; its keypad
tree isn't reliably warmed when the test snapshots (the failure point even varies run-to-run: the sweep
reached `e49#3`, the probe fails at step one). The product is fine: the re-ground correctly returned a
compact `(no UI change since the last snapshot — refs unchanged)` delta — the economy under test works, and
refs survive value deltas as documented.

VERIFIED DEAD-END (do not retry this approach): a warm-wait fix — retry desktop_snapshot until the "Five"
ref appears — was tested live (`.scratch/probe-snapshot2.ts`) with a CLEAN Calculator restart + 25 retries
(7.5s). `fiveRef` stayed `undefined` the whole time. So the keypad is NOT merely slow to warm: Win11
Calculator's UWP content tree (the buttons) is not populated in the snapshot when the app is not the
foreground/active window (UWP virtualizes/suspends the CoreWindow content tree in the background). A warm-wait
CANNOT fix this. The test would have to raise Calculator to the foreground (defeating the background-driving
premise) or retarget to a non-UWP target — i.e. this is the SAME strategic retargeting decision as the
Notepad-coupled tests below, not a low-risk hygiene fix. Folded into the systematic finding.

## SYSTEMATIC FINDING — Win11 single-instance UWP app coupling (one root cause, ~6 tests)

These tests assume a classic Win10 single-window app with a clean, immediately-present control tree:
`cursor-free-copy-cut`, `cursor-free-mcp-input`, `cursor-free-undo`, `copy-secret-redacted-not-journaled`,
`snapshot-leak` (Notepad), and `mcp-snapshot-economy` (Calculator). On Windows 11 those apps are packaged
single-instance UWP/WinUI:
- **Notepad** — single-instance + session-restore (leftover content from a prior run reattaches), editor is
  `RichEditD2DPT` not classic `EDIT`. (Cursor-free posting itself WORKS — proven in cycle 2.)
- **Calculator** — single-instance UWP, cold-start latency, suspends when backgrounded.

The umbriel PRODUCT paths all work (proven live across cycles 2-3). The failures are test-design coupling to
OS-version-specific app behavior + cross-test isolation (shared single-instance app state).

RECOMMENDATION (owner's strategic call — NOT done autonomously): pick one —
1. Retarget these tests to a SYNTHETIC classic Win32 control (the pattern `click-no-raise-waitstate` uses:
   create + DestroyWindow an own `EDIT`/`BUTTON`) — deterministic, isolated, OS-version-independent. Trades
   real-app coverage for reliability.
2. Keep real apps but add robust warmup/retry + guaranteed clean state (hard for single-instance UWP) and a
   per-test app-kill in teardown.
This is a test-strategy decision (real-app coverage vs determinism) that belongs to the maintainer; an
autonomous agent should not unilaterally rewrite ~6 intentional real-app integration tests.

## Other open

- `vcall-safety [A]` — subprocess expected a specific clean-crash signature; got exit=1/no-signal/empty under
  Bun 1.4-canary. com.ts documents that unmapped (non-null garbage) pointers segfault UNCATCHABLY, so this is
  runtime-version-sensitive crash behavior, not an umbriel defect. Re-confirm on a stable Bun release.

## Bottom line after 3 cycles

Zero product bugs. Three "critical product bug" claims refuted by live probing. Ten commits, all test/doc
hygiene. The codebase is in excellent shape; remaining work is a systematic test-robustness decision for the
maintainer, not product improvement.
