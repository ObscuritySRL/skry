# Fresh 12-lane harden panel — 5 ships + earned convergence — 2026-06-27

A fresh adversarial cycle over the post-`0e69f5b` (v1.14.0) HEAD. A 12-seat read-only finder panel (one
ultracode expert per axis) measured against a re-verified live anchor — **NOT the goal prompt's stale
"102 unit tests" snapshot; HEAD actually had 113** (v1.13.0 `using`/OwnedWindow + v1.14.0 shipped past the
last convergence doc). The panel returned **2 CLEAN lanes** (Reliability, Ship-Footprint — both with traced
evidence) and a set of candidates; triaged hands-on against the live code, **5 hardening slices shipped**
(each behavior-identical or licensed-error-path, a measured axis, live-or-structurally proven, regression-
gated, committed & pushed 1/slice). A 4-seat confirming sweep then found **no cycle defect** across all
lanes. The spine remains genuinely hardened; this cycle closed real *defect-class-completeness* gaps the
prior passes left (an audit-shaping bug, an error-steer inconsistency, a slot-gate blind spot) plus two
byte-identical alloc hoists and a security-relevant doc-completeness fix.

## SHIPPED (each tsc 0 + gated + live-or-structurally proven, committed & pushed 1/slice)
- **`0a2ebeb` fix(mcp) set_clipboard** — its false branch returned `textResult('failed to set clipboard')`, a
  success-shaped result (isError unset). `auditCall`/`traceCall` both derive `ok = (isError !== true)`, so a
  failed MUTATING clipboard write was journaled **ok:true** — a write that did not happen, recorded as success
  in the forensic trail (a security feature per AGENTS.md). Its two sibling clipboard writers (`copy_image`,
  `copy_files`) already shape a failed write as `errorResult`. Now matches: success → `textResult('clipboard
  set')` (byte-identical happy path), failure → `errorResult` with an actionable reason. Live happy-path proven
  unchanged (`example/clipboard-files` set→read-back); `test/clipboard-write-error-shape.test.ts` pins the shape.
- **`6f74238` fix(mcp) ocr/click_text** — both `throw new Error('… could not capture the window (protected / no
  surface)')` on the non-minimized capture-null branch; the three sibling capture sites (`capture_window`,
  `copy_image`, `wait_visual_idle`) route the SAME WGC-capture-null failure class through `captureUnavailable(tool)`,
  which disambiguates "Windows.Graphics.Capture unavailable on this session" (a session-wide dead end) from
  "returned no frame — protected/DRM content" (window-specific), each with the right recovery step. Now both
  `return errorResult(captureUnavailable(tool))`. The throw was already wrapped by the single catch boundary into
  `errorResult(redactSecrets(msg))`; `captureUnavailable` is a static template with no secrets, so result shape /
  isError / audit-ok / trace are identical — only the error TEXT improves. Happy + minimized paths byte-identical
  (live `example/ocr-text`, `example/click-text-cursorfree`); `test/capture-null-error-consistency.test.ts` pins
  all 5 capture-null sites onto `captureUnavailable`.
- **`f98264b` test(slot-gate)** — the WGC/OCR header blocks verify the test's OWN name→slot table against the SDK
  but never read the engine source; the call-site drift guard compares only the SET of distinct called slot
  values. So a transposition of one `wgc.ts` (14 consts / 8 distinct values) or `ocr.ts` (16 / 6) const onto a
  SIBLING's in-set value (e.g. `FRAME_GET_SURFACE 6 → 7`, already `FRAMEPOOL_TRY_GET_NEXT_FRAME`) left the set
  unchanged, kept every existing slot-gate test green, and SEGFAULTED live. `msaa.ts`/`desktop.ts` are single-use-
  distinct (their transpositions change the set, already caught); `wgc.ts`/`ocr.ts` were the gap. Pins each engine
  literal to the header-verified slot (comprehensive form of the single-const TEXTRANGE_SELECT / ENUM_NEXT /
  IACC_GET_ACCNAME pins) + a completeness check. **Proven with teeth:** `FRAME_GET_SURFACE 6→7` and `LINE_GET_TEXT
  7→6` each fail ONLY the new pin (24 pass / 1 fail) while every prior slot-gate test stays green; reverted → 25/25.
  Test-only — production byte-identical. The confirming sweep independently re-derived all 30 pins against the
  real Windows SDK headers (wgc/msaa 24 verified, ocr 18 verified, 0 mismatched).
- **`1751347` perf(patterns)** — `readVisibleText` allocated `rangeOut`+`textOut` per visible range (2N
  `Buffer.alloc(8)`+`.ptr` → 2); `views` allocated `nameOut` on every probe of its fixed 0..15 loop (16 → 1).
  Both functions are SYNCHRONOUS (no await), so the out-buffers are loop-invariant scratch (written by the vcall,
  read inline before the next vcall) — hoisted above the loop, mirroring `getSelectedText`'s already-proven reuse.
  Output byte-identical (live `example/visible-text` 854-char region + 33-char terminal; `example/views` 8 modes,
  cursor-free switch). `test/patterns-loop-alloc.test.ts` structurally pins "no Buffer.alloc inside either loop"
  (teeth proven by re-bloating the loop → fail; reverted). The confirming sweep proved no aliasing/staleness/UAF.
- **`cd3451f` docs(ai)** — AI.md's "sandbox EVERY fs-category file tool (…)" parenthetical listed **7 of 9** fs
  tools (`find_files` + `stat_path` were FS_ROOT-confined in code but absent from the doc, which self-contradicted
  AI.md's own gated-tools bullet that lists all 9). A security-relevant enumeration (what `UMBRIEL_FS_ROOT`
  confines) must be complete. Added the two; `test/tool-count.test.ts` now derives the fs-category names from
  mcp.ts and asserts the sentence lists each — proven **red on the pre-fix doc, green after**. Doc + test only.

## NON-OWNER chore (separate, user-requested)
- **`bf856e4` chore(gitignore)** — ignore `scripts/chatgpt-imagegen.ts` (a local-only dev tool the owner asked
  to keep on disk but out of git + the tarball, alongside the existing ARTICLE.md / DISCORD_POST.md entries). It
  was untracked, so no `git rm` needed.

## RECORD-ONLY / owner-gated (real but out of the byte-identical-hardening mandate → do NOT re-flag without NEW evidence)
- **listVolumes hard-error modal (Bug-Hunt, MED)** — `desktop/disk.ts` `listVolumes` calls `GetDiskFreeSpaceExW`
  + `GetVolumeInformationW` unconditionally on every root including a not-ready removable/optical drive; in the
  default thread error mode this can pop the "There is no disk in the drive" hard-error dialog, which a stdio MCP
  host has no UI thread to dismiss — the exact footgun `window.ts:269`'s `recycleToBin` already guards via
  FOF_NOERRORUI. Clean fix exists with NO binding gap: wrap the enumeration in
  `Kernel32.SetThreadErrorMode(SEM_FAILCRITICALERRORS)` (save+restore the prior mode in a finally; both
  SetThreadErrorMode and SetErrorMode are in `@bun-win32/kernel32`). **NOT shipped:** unprovable in this
  environment (no controllable empty removable/optical drive to repro the modal) and it is a behavior change to the
  not-ready-drive path, so it fails the byte-identical + proven-LIVE bar by construction. Owner: apply + verify on
  hardware with an empty card-reader / optical bay.
- **release-check.ts `pkg.version as string` (Code-Hygiene, LOW)** — the tree's sole `as <primitive>` cast
  (`scripts/release-check.ts:37`). Fixable to the AGENTS-blessed annotation `const expected: string = pkg.version`
  (byte-identical, type-erased). **NOT shipped:** `test/no-error-cast.test.ts` deliberately scopes its glob to the
  shipping modules and EXCLUDES `scripts/`, so the owner appears to have intentionally exempted release-gate
  tooling (pragmatic `any`-from-JSON); the fix has no runtime axis and no regression gate without expanding that
  enforcement scope — an owner decision, not autonomous hardening.
- **Token-Economy field-desc cuts (LOW)** — `find_and_act`/`reveal` `mode` (~245 B) and `power_state`/
  `manage_process` `action` (~200 B) field descriptions restate per-enum semantics already in each tool's top-level
  description (the `select` tool leaves its `mode` a bare enum). Byte-wire-cuttable, BUT removing point-of-use param
  docs trades against the AI-Digestion axis (an agent filling the field reads it without re-scanning the whole
  description) — a deliberate-duplication judgment the owner should make, not an unambiguous win.
- **Design-Doubt hypotheses (record-only, never implement under byte-id)** — (1) `manage_window` has no
  move-only/resize-only (its `move` hard-requires all of x,y,width,height) while sibling `manage_element` splits
  move/resize/rotate; SetWindowPos natively supports SWP_NOMOVE/NOSIZE. (2) `find_image`/`find_color` force a
  find→click_point two-call dance while the symmetric `click_text` acts in one call. (3) `set_view` accepts only a
  numeric `{id}` from `list_views`, forcing a discovery round-trip for its own headline "flip to Details" use case;
  could accept `{name}`. All contract/capability changes → BUILD/owner.
- **Dead-Code (LOW)** — (1) the 4-site `swapAttached` block (mcp.ts 2602/2942/2978/3845) IS byte-identical-foldable
  across all 4 (the launch_app site's reordered `attached=window` is provably immaterial — past two independent
  module-let resets), but folding CREATES a helper, colliding head-on with AGENTS.md "No helpers unless requested";
  needs an owner waiver. (2) 4 dead Win32 flag consts in `input/input.ts` (KEYEVENTF_SCANCODE, MOUSEEVENTF_MOVE/
  ABSOLUTE/VIRTUALDESK) — but the KEYEVENTF family is a complete 4/4 table (removing SCANCODE breaks completeness),
  mixed signal → owner decides prune-vs-keep-as-Win32-reference.
- **Segfault-Safety (record/decline)** — `element/window.ts:50` `findWindow` extracts `.ptr` into a const and
  drops the backing Buffer before the synchronous FindWindowW, deviating from the codebase's own keep-alive
  discipline (clipboard.ts:133). NOT a live bug (synchronous; JSC won't GC between adjacent statements) and NOT
  regression-gateable (GC-timing UAF can't be deterministically triggered) → declined, recorded as a defensive note.
- **Doc-Fidelity server.json (record-only, owner-released)** — `server.json` env docs are stale vs mcp.ts (both fs
  lists omit `find_files`; the os list omits set_display/manage_task/power_state/registry_key; `UMBRIEL_TRACE_SNAPSHOTS`
  is honored at mcp.ts:325 but undocumented). NOT edited — `server.json` is owner-released (HARDEN/BUILD LAW).
- **Test-Integrity (LOW)** — `list_views`/`set_view`/`copy_image` still have no MCP-handler-layer test (facade
  primitives covered). A windowless `copy_image` region-path dispatch test would close it, but it mutates the
  clipboard and the gap is a known low-priority re-verification → recorded.

## CONFIRMING SWEEP + EARNED CONVERGENCE
A 4-seat adversarial confirming push over the 5-commit diff (behavior-identical · FFI/segfault/perf-safety ·
test-integrity · doc-fidelity/whole-surface) returned **all 4 lanes CLEAN-with-evidence**: `git diff` shows
EXACTLY 3 mcp.ts hunks (set_clipboard + the two capture-null lines) and zero collateral; the set_clipboard /
ocr / click_text happy paths and audit-ok fields are byte-identical (only the licensed failure-path text changed,
redaction floor intact); the patterns hoist has no aliasing/staleness/UAF (synchronous, value copied out before
reuse, comRelease ordering preserved); all 30 slot pins re-derived three ways and verified against the **real
installed Windows SDK headers** (24+18 verified, 0 mismatched — not merely self-consistent); every new test was
empirically teeth-tested (a simulated regression fails it) and none spawn a window; AI.md matches the 9 fs tools
in order with no other doc drift.

**Convergence EARNED, not asserted:** the 12-seat panel surfaced candidates → 5 real wins shipped (each
live-or-structurally proven + gated + committed/pushed), the rest declined-with-reasons or owner-gated; the
confirming sweep found no cycle defect across 4 independent lanes. Final state: **tsc 0, 121 unit tests (was 113
at cycle start: +2 clipboard-shape, +1 capture-consistency, +2 slot-gate, +2 patterns-alloc, +1 fs-list), 99
tools, biome clean, 24 test files (was 21).**

## STILL-WALLED (declined walls re-confirmed — all hold)
get_env / read_event_log / registry / file raw reads stay UNMASKED (owner-confirmed 2026-06-23). HTTP fetch
(SSRF, owner-gated), audio volume / monitor brightness (no winmm/mmdevapi/dxva2 binding — owner-reserved DLLs),
DockPattern, ItemContainer VARIANT segfault, OLE drag-drop, toast AUMID, RegisterHotKey-vs-stateless,
virtual-desktop-move E_ACCESSDENIED — unchanged. Owner-reserved binding nullability gaps remain in TODO.md
(GetVolumeInformationW out-params, EnumServicesStatusExW pszGroupName, d3d11 CreateDirect3D11DeviceFromDXGIDevice).
