# Two-panel pass (16-seat fleet) — 10 slices SHIPPED — 2026-06-20

A 16-seat fresh-context fleet across Panel A (HARDEN, 13 lanes) + Panel B (CAPABILITY, 3 lanes), each briefed to skip the
already-claimed + declined ground. Result: **8 lanes CLEAN-with-evidence, 8 with findings → 10 slices shipped** (each
proven LIVE, gated, tested, pushed). The two-panel design earned its keep: **A11-fabrication caught a real memory-safety
bug that A5-segfault explicitly mis-cleared** (A5 read the firewall VARIANT as a "correct 16-byte" out-param; it is 24 B
on x64).

Baseline before: tsc 0, 49 unit tests, slot-gate 145 (104+23+18). After: tsc 0, **51 unit tests** (+2 drift guards),
slot-gate 145, **86 tools** (was 85; +power_state). Biome clean.

## SHIPPED (10 slices, each live-proven + pushed)

- **`1605a73` fix(firewall): VARIANT out-param 16→24 B** — CRITICAL. `desktop/firewall.ts:84` allocated a 16-byte buffer
  for the `IEnumVARIANT::Next` [out] VARIANT, but `sizeof(VARIANT)` on x64 is 24 (8-byte header + 16-byte value union;
  the codebase's own `com/reads.ts:23` uses `scratch24` for exactly this). An 8-byte native-heap OOB write on EVERY
  firewall rule enumerated (up to MAX_RULES=5000). Byte-identical output. Live: 732 rules re-enumerated identically.
  (A5-segfault verified the SLOT indices correct but MISSED the buffer-size — A11-fabrication caught it.)
- **`15f6cf1` refactor(tasks): fold listScheduledTasks onto connectTaskService** — byte-identical, −7 lines of duplicated
  CoInitializeEx+CoCreateInstance+Connect. Live: 201 tasks enumerated identically. (A3-redundancy)
- **`fe06440` test(slot-gate): TASK_SLOT/FIREWALL_SLOT two-way drift guard** — tasks.ts/firewall.ts dispatch getters
  through helper wrappers (getLong/getBstr/getVariantBool), so the existing call-site drift guard (regex on `vcall(this,
  SLOT…)`) skipped them. New guard ties each engine's referenced `<PREFIX>_SLOT.member` set to the `.toBe(<PREFIX>_SLOT.
  member)` header-gated set (immune to its own references). Today: equal (17 task, 8 fw). +2 unit tests. (A12-tests)
- **`350c75e` fix(mcp): actionable errors** — manage_task create-without-xml (legal per schema) dead-ended on a bare
  `missing required string argument: xml`; now names the next step. list_firewall_rules with an over-narrow filter fell
  through to a bare `0 firewall rules:`; now says `no rules match the filters (match="…")`. Both byte-identical on the
  happy path (live-verified: match=Claude → "5 firewall rules (showing 2)"). (A8-digestion #1, #3)
- **`249a10e` feat(input/hold-key): chord hold** — `holdKey('Control+Shift')` fed the whole "+"-joined name to
  virtualKeyCode → threw, so a key-COMBINATION hold (documented Anthropic action) failed on BOTH the MCP hold_key tool
  and the CUA adapter. Fixed at the shared primitive: split, validate-all-before-press (no stuck key), hold, release in
  reverse; + the MCP ref path falls through to SendInput for chords. Live: Ctrl+Shift held+released via GetAsyncKeyState;
  single-key path byte-identical; bad member throws with no stuck key. New integration test. (B2.2-cua)
- **`923405c` feat(input/computer): CUA drag-path un-flatten** — `fromCuaAction` kept only path[0]/path[last] of an
  OpenAI-CUA `drag.path[]`, collapsing a curve/lasso/signature to a straight line, though dragStroke + the MCP `drag
  {path}` tool already drive the full polyline. Added a `path` field to ComputerAction; dispatch walks >1-point paths via
  dragStroke. Live: a 4-point stroke walked to the exact last waypoint (GetCursorPos). New integration test. (B2.1-cua)
- **`b7c9a9c` fix(mcp,input): clickElement + semanticClick disclose the foreground steal** — the recorded A6 follow-on.
  clickElement ran element.invoke()/toggle()/select() RAW reporting "(cursor-free)" while the invoke/toggle/select VERBS
  disclose the MSAA-bridge SetFocus steal via disclosingPatternAct. Routed all three through it (byte-identical when no
  steal; ⚠ note on a real steal). Same gap in computer.ts semanticClick (the CUA twin) → withStealNote (identical
  before/after foregroundWindow logic; mcp's disclosingPatternAct is private). Live: a synthetic classic checkbox via the
  MCP click tool routed through INVOKE and disclosed the steal (validating the decision to also fix invoke@1293, beyond
  the finder's toggle/select scope); click-winui-toggle + select-no-raise + mcp-pattern-no-raise still green. New
  click-classic-toggle-disclosed test. (A6-parity #1, #2, #3) — semanticClick's coordinate path is not deterministically
  testable on a synthetic window (its child is not ElementFromPoint-resolvable), so it rides the identical-mechanism +
  tsc proof, NOT a fragile test.
- **`2c88772` fix(capture/wgc): ensureBundle leak guard** — ensureBundle acquired the D3D11 device+context + DXGI bridge
  + 2 activation factories with NO finally; a partial-init throw (DXGI bridge / RoGetActivationFactory failure) leaked
  the heavyweight device+context on every wgcAvailable()/capture retry (bundle stays null → dispose can't reclaim). Now
  releases everything acquired (incl. the 2 factories the finder's list omitted) + pairs RoUninitialize, then re-throws.
  Happy path byte-identical (wgc-capture-no-leak: 24/24 captures, USER Δ0). The partial-init path can't be induced on a
  healthy GPU box without FFI fault-injection, so it rides the happy-path regression + null-guarded-release inspection
  (a faked trigger would be a tautology). (A4-reliability)
- **`4f70985` feat(desktop/power): power_state** — HEADLINE capability. Lock / sign-out / restart / shut down was the one
  OS-verb family with NO native tool (the leading rival Windows-MCP reaches it only through its PowerShell escape hatch),
  forcing a forbidden shell-out. ONE general primitive over the session/power state machine (User32 LockWorkStation/
  ExitWindowsEx + in-process SE_SHUTDOWN_NAME enablement via OpenProcessToken+LookupPrivilegeValueW+AdjustTokenPrivileges
  — all already-bound, no new dep, no hand-roll), os-gated + confirm-required, planned + non-forced (apps asked to close,
  not killed). 85→86 tools. Live: the FFI token dance (hand-packed TOKEN_PRIVILEGES) runs with no segfault; the tool is
  os-gated (hidden under safe) + confirm/action-gated — proven WITHOUT firing a destructive action (would shut down /
  lock the owner's live machine; the ExitWindowsEx/LockWorkStation signatures are header-verified, the disruptive trigger
  is owner-gated-to-exercise). New power-state integration test. (B1-shellreach #1)

## CLEAN-with-evidence lanes (8 — STOPPED, do not re-review)
A1-perf (hot paths optimal; new desktop allocs are noise vs cross-process round-trips), A2-tokens (tools/list measured
73577 B → ~74k at 86 tools; new tool descriptions dense, no free cut), A7-security (every new tool correctly gated;
redaction + cursor-free guards intact), A9-docs (counts + surface + source map reconcile — now updated for 86/power_state),
A10-hygiene (0 casts, 0 dead exports, biome clean, .scratch gitignored, tarball allowlist excludes strays), A13-footprint
(43→44 files, deps correct, no strays), B3-uia (pattern coverage complete; declined patterns RE-CONFIRMED walls via a
LIVE 2090-element prevalence probe: Dock 0/2090, TextEdit 125/125 also Text, TextChild 100% have a Text container/ancestor,
ItemContainer FindItemByProperty VARIANT-by-value still segfaults). A5-segfault returned CLEAN but mis-cleared the firewall
VARIANT (caught by A11); the slot indices it verified ARE correct.

## DECLINED with evidence (re-confirm before re-proposing)
- **A8.2 control_service config not-found vs access-denied collapse** — readServiceConfig returns null for both; the fix
  needs a discriminated return + the probe trick controlService uses. REAL digestion improvement BUT it changes
  services.ts output shape, and the harden-converged precedent established services.ts output-shape changes as
  OWNER-DECIDED (the control_service already-state fix). Recorded for the owner; not shipped autonomously.
- **A8.4 manage_task action-enum lacks per-value descriptions** (control_service's does) — DECLINED below-bar: adds
  tokens to every tools/list for marginal clarity the tool description already carries (A2-tokens just confirmed the
  payload is dense/lean). Sibling-consistency-only.
- **B1.2 timezone get/set** — GET is already reachable via `registry_get` (converge-2 proved it reads TimeZoneKeyName).
  SET is the real gap (needs SetDynamicTimeZoneInformation + SE_TIME_ZONE_NAME + a 172-B struct + WM_SETTINGCHANGE) but
  is lower-frequency, heavier, and disruptive to live-test; ranked below power by the finder ("if pursued AFTER"). Not
  shipped this pass; the privilege-enable helper (desktop/power.ts enableShutdownPrivilege) is reusable if pursued.

## OWNER / binding gaps (TODO.md)
- **NEW:** `powrprof` `SetSuspendState` (sleep/hibernate) — the two REMAINING session/power states power_state can't reach
  (no binding). Logged in TODO.md; `desktop/power.ts` plumbing is ready for the actions once the binding exists.
- Re-confirmed STILL walls: iphlpapi/ws2_32 (network), ntdll NtQueryInformationProcess (process cmdline), advapi32
  EnumServicesStatusExW mis-type. (all already in TODO.md)
