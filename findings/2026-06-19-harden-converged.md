# HARDEN+OPTIMIZE pass — CONVERGED — 2026-06-19

First dedicated HARDEN run (prior `findings/` were BUILD/ease/critic cycles that grew 61→83 tools). Goal: make what
EXISTS faster/leaner/clearer/safer at ZERO external-behavior change — every tool output / public signature / policy
gate byte-identical (proven by diff), every win moving a MEASURED axis, proven LIVE + regression-gated.

10 parallel lane-finder seats, 3-4 convergence rounds. **Baseline & end state: HEAD c646ac6 → 150fe7d; tsc 0;
48 unit tests green; slot-gate 104+22+18 verified, 0 mismatched; 83 tools (65 safe / 31 readonly / 18 os-fs) unchanged.**

## Shipped (9 slices, each behavior-proven-identical LIVE + pushed)

Performance / Redundancy:
1. `1705c3b` perf(desktop/tasks) — folded tasks.ts `getBstrField`/`getLongField` onto the existing reads.ts
   `getBstr`/`getLong` (byte-identical vcall+decode; tasks.ts is synchronous so sharing reads.ts scratch8/4 is
   alias-safe). −12 lines, ~5k transient `Buffer.alloc` eliminated per `list_scheduled_tasks` call. Proof:
   listScheduledTasks() output diffed before/after = byte-identical (201 tasks); scheduled-tasks integration passes.
2. `8bfba35` perf(desktop/registry) — hoisted RegEnum* length buffers (`nameLength`/`typeOut`/`dataLength`) out of
   both enumerate loops to function scope (each reset-to-capacity or API-overwritten before every read → byte-identical;
   registryList synchronous). Proof: registryList output across 4 keys incl. the >16KB MORE_DATA path = byte-identical;
   registry / registry-large-value / env-var integration pass.
3. `ad1eddf` perf(element/window) — hoisted the per-window `readWindowText`/`readClassName`/`readProcessId` decode
   buffers (1024/512/4 B) out of the EnumWindows hot loop to module scratch (distinct sizes → no sibling alias; each
   value copied out before next call; window.ts synchronous). ~51% faster per-window decode (1568→760 ns), ~340µs on a
   419-window desktop. Proof: listWindows() dump (titled + includeUntitled) diffed = byte-identical; popup-windows
   integration passes. FFI-re-verified point-by-point (round 3).

Token-Economy (model-paid tokens/session, measured on the REAL wire — spawn server → tools/list, full profile):
4. `4b304c9` perf(mcp) — trimmed 4 inlined field descriptions (ELEMENT_DESC ×23, REF_DESC ×31, HWND_DESC ×10,
   SELECTOR_SCHEMA.description ×3), redundant filler only, meaning intact. tools/list 70190 → 69512 B (−678).
5. `35cc6bd` perf(mcp) — dropped redundant "policy" from the os/fs gate tail (` policy category` → ` category`,
   18 occurrences). tools/list 69512 → 69393 B (−119). Lock-checked: no test greps the phrase; runtime refusal emits
   the raw category value, not this string.

Code-Hygiene:
6. `fd84d93` refactor — removed 3 zero-reference dead symbols (mcp.ts `quote()`, wgc.ts `RPC_E_CHANGED_MODE`,
   patterns.ts unused `type Pointer` import). tsc 0, biome clean, package loads.

Doc-Fidelity (AI.md, doc-only, zero runtime):
7. `7f2be60` — added the missing `select_option` tool (only tool absent from the "complete surface" doc) + 3 source
   files (display/eventlog/tasks) + 3 exports (readEventLog/getDisplays/listScheduledTasks) + registrySet/types.
8. `ace5d56` — added `jab.ts` to the source map.
9. `150fe7d` — fixed stale bin name `umbriel-mcp` → `umbriel` (contradicted package.json + AI.md's own next clause).

## CLEAN lanes — CONSTRAINTS (next HARDEN run can SKIP these; evidence on file)

- **Reliability** — CLEAN. Every OpenProcess/SCM/RegOpenKey/OpenEventLog/toolhelp/CoCreateInstance/COM-iface/BSTR in
  the 22 OS-control tools freed in `finally` on every path; denied/not-found honest (decided via toolhelp/SCM probe,
  NOT the FFI-unreliable GetLastError); no throw escapes the request loop (dispatch wraps → errorResult); enumerations
  bounded; teardown idempotent. (CoInitializeEx in tasks.ts deliberately NOT paired with CoUninitialize — apartment
  owned by com/automation.ts.)
- **Segfault-Safety** — CLEAN. All new struct offsets/strides verified vs source (DEVMODEW, DISPLAY_DEVICEW,
  EVENTLOGRECORD, ENUM_SERVICE_STATUSW, SERVICE_STATUS_PROCESS); tasks.ts COM slots header-gated (slot-gate). The two
  round-1 FFI changes (tasks/registry) and the round-2 window.ts change each independently FFI-re-verified
  point-by-point: fully synchronous → no stale-.ptr-across-await, distinct/non-aliased buffers, `.ptr` read inline.
  Note: tasks.ts input VARIANTs are `Buffer.alloc(16)` (established convention for scalar [in] VT_EMPTY/VT_I4 — not a
  defect). `Number(x) as Pointer` is the sanctioned FFI handle→pointer idiom.
- **Code-Hygiene** — CLEAN after slice 6. 0 removable casts (all `Number()→Pointer` / `(error as Error)` / keyof are
  unavoidable boundary idioms); 342 exports all have an importer (0 dead); no `private` keyword; abbreviations are
  Win32/idiomatic. DELIBERATELY KEPT: input/input.ts 4 unused SendInput flag consts (complete reference table).
- **Redundancy** — CLEAN after slice 1. Fully converged onto com/reads.ts. REPORT-ONLY (do NOT consolidate — would
  need a NEW abstraction AGENTS.md forbids): ~108 example/*.integration.test.ts re-implement the stdio MCP harness
  inline (~3200 dup lines; _harness.ts header documents the partial adoption as intentional); GetWindowTextW/
  GetClassNameW decoders dup'd across window.ts/spy.ts/events.ts (no existing primitive); "get interface-pointer
  out-param" shape ~40 sites (reads.ts has no getInterface). tasks.ts getDateField NOT foldable onto getDouble
  (NaN→throws).
- **Ship-Footprint** — CLEAN. Real tarball: 42 files / 246 KB, no stray artifacts (folder entries ship only .ts). All
  12 @bun-win32/* deps have a shipped importer; no under-declared binding (taskschd/jab/terminal mentions are comments).
  `@bun-win32/core` has no direct import but is a mandatory transitive of all 11 other bindings → removing its
  declaration moves NO footprint axis (source-only tarball) → correctly NOT a win.
- **Test-Integrity** — CLEAN. tasks.ts is the only new vtable user; all 13 TASK_SLOT slots gated vs taskschd.h
  (incl. the get+put_Enabled@11 shift). The 22 new integration tests assert real observed behavior (no tautology); no
  GUI-window leak (ping sleepers self-exit / killed in finally; MCP subprocesses killed in finally). tool-count.test.ts
  derives 83/65/31/18 live and fails on drift.
- **Performance** — CLEAN after slices 1-3. Remaining FFI/decode/snapshot surface already optimal. REJECTED below-bar:
  events.ts window-decode hoist (sparse WinEventHook + reentrancy risk); reads.ts argTypes hoist (~5-11ns noise);
  com.ts vcall walk (a correctness guard); diff.ts second-pass fold (refactor, ~1% of per-action). REJECTED UNSAFE:
  reads.ts BSTR `toBuffer` (−52ns but SEGFAULTS under GC in Bun 1.4 canary — keep `Buffer.from(toArrayBuffer(...))`).
- **Token-Economy** — CLEAN after slices 4-5. tools/list ≈ 69393 B (full, 83 tools). Remaining payload is dense +
  load-bearing. REJECTED (meaning-risk): omitting spec-default `destructiveHint:true`/`openWorldHint:true` annotations
  (−1373 B) — load-bearing security signal (AI.md:126 drives confirmation off destructiveHint). Per-call Δ/observation
  labels are load-bearing ("refs unchanged"), not session metadata.
- **Doc-Fidelity** — CLEAN after slices 7-9. Source map / exports / 83 tool names / sampled params all reconcile.
  DECIDED-OMISSIONS (pre-existing since initial release, below bar — do NOT re-flag): 4 value exports (cropBitmap,
  gridItemPosition, needsSubtreeFilter, postButtonClick) + ~21 minor type exports not enumerated; index.ts absent from
  the "which one file to open" map.

## Declined — flagged for owner, NOT shipped (out of scope for a byte-identical HARDEN pass)

- **AI-Digestion: control_service mislabels ERROR_SERVICE_ALREADY_RUNNING / ERROR_SERVICE_NOT_ACTIVE as
  "access-denied"** (services.ts:104-108). A genuine denied-vs-not-denied message inversion, BUT (a) the fix CHANGES
  tool output (violates the byte-identical bar — this is a correctness bug fix, not a hardening optimization), and
  (b) the proposed fix reads `GetLastError()` after the failed control call — and this codebase already established
  (os-control findings; kill/services) that GetLastError is UNRELIABLE across the bun:ffi trampoline (returned 0 for a
  bad pid), which is exactly why control_service decides denied-vs-not-found via an SCM re-probe instead. Shipping an
  output change resting on an unreliable mechanism is the unproven change this goal cuts. OWNER DECISION: if desired,
  distinguish via QueryServiceStatusEx state (current vs target) rather than GetLastError, and accept the output change.

## Method note

Every fix proven LIVE before push: tool output captured before vs after and diffed = byte-identical (tasks/registry/
window via direct in-proc capture; descriptions via real spawned-server tools/list byte measurement); the relevant
headless integration tests (scheduled-tasks, registry, registry-large-value, env-var, popup-windows) re-run green.
No version bump / server.json / MCP-registry touched (owner-reserved). bun test FFI-spawning suite avoided during the
parallel find phase to keep the desktop clean; unit `bun test test/` + targeted headless integration used throughout.
