# Cycle 2 — live triage of the deterministic failures (2026-06-19)

Followed up the deterministic failures from `2026-06-19-panel-audit-live-sweep.md` with hands-on live
probing (`.scratch/probe-richedit.ts`) on Windows 11 build 26200. Two test fixes shipped; one alleged
"product bug" DISPROVEN; the cursor-free-test cluster traced to a Win11 Notepad environment constraint.

## Shipped (2 commits, pushed)

- `test: use a prose corpus in text-cap …` — `'X'.repeat(9000)` matches the base64 secret-shape regex
  (`/\b[A-Za-z0-9+/]{40,}={0,2}\b/`), so `read_clipboard` redacts it to `«redacted»` BEFORE the length
  cap — the test asserted a cap note that never appeared (returned ~109 chars). Swapped to a prose corpus
  (words+spaces, no 40+ alnum run). Verified live: returns 4208 chars WITH the "+N more chars" note.
- `test: narrow find-and-act-popup selector to the Font combobox` — Character Map exposes THREE
  comboboxes ("Character set :" aid 130, "Group by :" aid 202, "Font :" aid 105); the bare
  `{controlType:'ComboBox'}` matched all 3 and hit the (correct) ambiguous-target refusal. Narrowed to
  `nameContains:'Font'`. Verified live: expands `ComboBox "Font :"` → ComboLBox popup hWnd.

## DISPROVEN — `type`/`paste` "false-success" is NOT a bug (do not "fix" it)

An auditor claimed `type` (mcp.ts:2277) and `paste` (mcp.ts:3051) report cursor-free success without
verifying the post landed, and that Win11 Notepad's `RichEditD2DPT` silently drops posted `WM_CHAR` —
a "false-success honesty violation." **Live probe refutes this.** On Win11 build 26200, Notepad's editor
is class `RichEditD2DPT` (controlType 50030 Document, nativeWindowHandle non-zero), and:

- `postText` (WM_CHAR) FOREGROUND → text LANDED (read back via ValuePattern).  ✅
- `postText` (WM_CHAR) MINIMIZED  → text LANDED.                                ✅
- `setValue` (ValuePattern)       → value LANDED.                               ✅

So the cursor-free `WM_CHAR` path works on RichEditD2DPT, foreground AND minimized. `type` is NOT lying.
CONSTRAINT: do NOT add a read-back/ValuePattern-fallback to the `type` hot path — `WM_CHAR` is async-posted,
an immediate read-back would race and report false failures, and an auto-fallback changes semantics
(insert→replace) and can steal foreground. The path is correct as-is; leave it.

## CONSTRAINT — Win11 Notepad single-instance + session-restore breaks 5 tests (retarget, not a product bug)

`cursor-free-copy-cut`, `cursor-free-mcp-input`, `cursor-free-undo`, `copy-secret-redacted-not-journaled`,
`snapshot-leak` all launch `notepad.exe` and assume a FRESH, isolated classic-Notepad `EDIT`. On Win11:
- Notepad is a packaged single-instance app — `launch(['notepad.exe'])` reattaches to the EXISTING instance.
- It restores the prior session: the probe's `value0` was a previous run's leftover
  `"STALE_MARKER_1781879853716UNDO-ME-7421"` — so the editor is NOT clean, and the tab/window the test
  attaches to may not be the one it thinks.
- The editor is `RichEditD2DPT`, not the classic `EDIT` these tests' tree-shape/selection assumptions target.

The product paths themselves work (proven above + `type-cursorfree`, `cursor-free-input`, `cursor-free-copy`
PASS). RETARGETING PLAN (next cycle): rewrite these 5 to create a SYNTHETIC classic Win32 `EDIT` child
window (the pattern `click-no-raise-waitstate` uses for a `BUTTON`) instead of launching Notepad —
deterministic, isolated, OS-version-independent, and self-destroying (DestroyWindow in finally).

## Still open (next cycle)

- `mcp-snapshot-economy` — the re-ground regex `/"Five" \[ref=(e\d+(?:#\d+)?)\]/` returns undefined so the
  2nd `invoke` sends no `ref`. Root cause unconfirmed (delta/prune format? value-delta ref survival?). Likely
  the test should re-use the ORIGINAL ref (refs survive cheap value deltas per AI.md) instead of re-grounding.
  Needs a live run with the actual `desktop_snapshot` output captured.
- `safety-floor [A]` WGC bundle-rebuild subprocess (exit 2) — run the subprocess directly with visible output;
  could be a real rebuild-after-uninitialize bug or just no stable capturable window in the child.
- `vcall-safety [A]` — subprocess expected a specific clean-crash signature; got exit=1/no-signal/empty. Likely
  Bun 1.4-canary uncatchable-segfault behavior (com.ts documents unmapped pointers segfault uncatchably).

## Method note (for future cycles)

Auditor findings are hypotheses, not facts. This cycle an auditor's confidently-argued "marquee product bug"
was disproven by a 60-second live probe; acting on it would have degraded a working hot path. Always probe
live before changing product code, especially input/FFI paths.
