# Cycle 5 — the "Notepad-coupled strategic" cluster was mostly a fixable ref bug

CORRECTION of the cycle-2/3 narrative. I had classified ~5 tests as "strategic Win11-Notepad coupling
requiring synthetic-control retargeting (owner decision)." Live investigation (the lesson that keeps paying
off) shows that was WRONG for most of them: they shared one surgical, fixable bug. The products all work.

## Fixed this cycle (live-verified, pushed)

- **vcall-safety** — was NOT a "Bun-canary crash signature" (my earlier guess). The subprocess imported `vcall`
  from `${import.meta.dir}/../com.ts`, but after the monorepo→folders refactor `vcall` is at `com/com.ts`
  (root `com.ts` absent). The child failed to IMPORT → exit 1, empty stdout → the catchability proof never ran.
  Fixed the path; child now catches the zeroed-interface fault and exits 0. Stale path, not a runtime issue.

- **cursor-free-mcp-input, cursor-free-undo, cursor-free-copy-cut** — the SAME delta-reground ref bug as
  mcp-snapshot-economy, NOT strategic coupling. Each re-resolved the editor ref via a FRESH `desktop_snapshot`
  after a value change (type/cut), but that reground returns a compact Δ / "no UI change" that omits the
  `[ref=]` line → the ref helper returned `undefined` → the tool ran with NO ref (generic SendInput path:
  Ctrl+C "no selection", Ctrl+Z "pressed", or type-to-nothing) instead of the ref-gated cursor-free path.
  Refs survive value deltas ("other refs unchanged"), so the fix is to cache the last resolved ref and fall
  back to it. Verified LIVE on Win11 Notepad's `RichEditD2DPT`: WM_CHAR, WM_PASTE, WM_COPY, WM_CUT, EM_SETSEL,
  EM_UNDO all land and read back. The product's cursor-free posting was always correct.

## Net correction

The umbriel PRODUCT has no defect in any of these — cursor-free input/clipboard/undo work on Win11's
RichEditD2DPT (foreground AND minimized), proven across cycles 2-5. The earlier "must retarget ~5 real-app
tests to synthetic controls (owner decision)" conclusion was largely WRONG; 4 were ordinary fixable test bugs
(a stale import path + the delta-reground ref pattern). Investigate live before classifying.

## Genuinely open (the only 1 left from the original 20 sweep failures)

- **copy-secret-redacted-not-journaled — OWNER DECISION (security-surface format), NOT a leak.** Verified the
  security floor HOLDS: `redactSecrets` is applied on every copy/cut path; the copied AKIA secret never appears
  raw in the echo or the trace observation. The test fails only on a *positive* `«redacted»`-presence proxy:
  `copy` uses a MULTI-LINE `fenceUntrusted` (preamble line 1, `«redacted»` line 2 — matching `read_clipboard`),
  while `cut` is single-line; the test slices the first line (correct for cut), and the trace observation is
  also the first line (the fence preamble for copy). So copy's observation is uninformative (preamble only),
  not leaky. Making it green needs an OWNER call: either make `copy`'s echo single-line (consistent with `cut`,
  informative trace — but breaks its `read_clipboard` consistency) OR relax the test's positive check to the
  security-critical `!includes(SECRET)`. I will not change the security-surface output format or weaken a
  security test autonomously.

- **snapshot-leak — FIXED (was stale instrumentation; I over-cautiously called this "deeper investigation").**
  The test hooked `Element.prototype.cachedChildren` to count materialized children, but `walk()` (refmap.ts)
  materializes children via the cached control-view walker — `firstChildCached` / `nextSiblingCached` — not that
  getter, so `materialized` counted 0 (and the broken hook on cold state TMO'd). Re-anchored the instrumentation
  to the methods `walk()` actually uses. Verified live: 5 children materialized, 6 released (no leak), fault
  fires at controlType read #6, 1s. The leak-safety property was always correct — the instrumentation was stale
  after the per-child-navigation refactor.

## Tally

Session: deterministic sweep failures resolved — selector-controltype, text-cap, find-and-act-popup,
safety-floor, mcp-snapshot-economy, vcall-safety, cursor-free-mcp-input, cursor-free-undo, cursor-free-copy-cut,
snapshot-leak (10 fixed). The ONLY remaining sweep failure is copy-secret (owner security-format decision — the
redaction floor HOLDS, not a leak). Owner-only items: SERVER_INFO version sync (1.9.0→1.9.3, unblocks the two
version tests); Dock / TableItem-Spreadsheet capability candidates. Still zero product bugs across the session.
