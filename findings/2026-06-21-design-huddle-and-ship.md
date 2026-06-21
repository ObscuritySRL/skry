# Two-panel ship + the pre-build DESIGN HUDDLE — 8 slices shipped, CONVERGED — 2026-06-21

A full BUILD pass: a two-panel finder fleet (5 HARDEN + 4 CAPABILITY seats + adjudicator) found 5 ship-now wins +
2 de-risk-then-fold candidates; ALL 7 shipped end-to-end (live proof + gate + test + commit+push). Mid-turn the owner
amended the process — capability features now get a pre-build **DESIGN HUDDLE** (the builder brainstorms the impl with
the critic panel BEFORE coding) — which was applied to the last two features and immediately earned its keep. A
3-seat adversarial convergence sweep over the new surface then returned CLEAN (one doc-fidelity nit, fixed).

Baseline at start: HEAD `c1d64e8`, tsc 0, 51 unit tests, 88 tools. End: tsc 0, 52 unit tests, **92 tools** (70 safe /
36 readonly / 22 os-fs), tree clean, all pushed.

## Shipped (each live-proven + gated + tested)
- **`b80063e` test(slot-gate): gate firewall.ts IEnumVARIANT::Next (ENUM_NEXT=3)** — the ONE called-but-ungated COM
  vtable slot in the tree (a bare local const, direct vcall, invisible to the netfw.h block + both drift guards). Gated
  two ways mirroring TEXTRANGE_SELECT: an oaidl.h VTBL row (Next=3 verified live via the test's own parser) + a
  constValues literal pin. Teeth-checked (flip→4 = 1 fail). Test-only.
- **`ae54a76` fix(com): release the in-flight COM item proxy on the throw path** — readTable (patterns.ts),
  collectTasks (tasks.ts), listFirewallRules (firewall.ts) each released the per-item proxy with a BARE comRelease
  OUTSIDE try/finally; a torn-down-proxy vcall throw (com.ts UAF guard) skipped the release and leaked it. Wrapped each
  item body in try/finally. Success-path byte-identical (proven live: firewall 746, tasks 201, table 43×4).
- **`ae0212c` feat(registry_key): create/delete a registry KEY** (RegCreateKeyExW / RegDeleteTreeW / RegDeleteKeyExW) —
  the half registry_set lacked (it writes a VALUE on an EXISTING key). Kills `reg add`/`reg delete`. os-gated + confirm.
  **Caught a wrong finder recipe by live probe:** RegDeleteTreeW deletes the named key ITSELF (not just descendants), so
  recursive = RegDeleteTreeW ALONE (the recipe's "then RegDeleteKeyExW" would have made a success report failure).
  registry-set test migrated off its Advapi32 reach-around onto the new primitive.
- **`343f32e` feat(list_volumes): mounted-drive type/label/filesystem + free/total** (kernel32, no COM) — kills
  `wmic logicaldisk`/`Get-Volume`. 'read'. Worked around a binding nullability (GetVolumeInformationW's 3 _Out_opt_
  params typed non-nullable LPVOID) with one shared scratch buffer; flagged in TODO.md.
- **`958cbd7` feat(wait_responsive): WM_NULL hung-window probe** (SendMessageTimeout SMTO_ABORTIFHUNG + IsHungAppWindow)
  — FlaUI Wait.UntilResponsive parity; catches the frozen app wait_idle calls "settled" (its tree stops changing). 'read',
  focus-free. Live: windowResponsive(Notepad)→true in 0.9ms, foreground unchanged.
- **`99d2274` feat(set_display): change resolution/orientation/refresh** (ChangeDisplaySettingsExW) — the focus-free
  WRITE half of get_displays. os-gated + confirm; CDS_TEST-validate then apply dynamically (auto-reverts a bad mode).
  Live SAFELY: no-op current-mode apply (config identical) + a 1×1 rejected at validation; nothing left changed.
- **`9800530` perf(readCachedProperties): decode only the selector-compared fields** — the client-filter walk eagerly
  decoded all 4 matcher props/candidate, but matches() reads a field only when its selector field is set. Gate each
  decode → byte-identical (the unread field defaults to ''/0 which matches() never reads). Live on Calculator: every
  field type pinned + a negative; cached getBstr ≈1007ns/getLong ≈516ns → ≈2531 ns saved/candidate on {nameContains}.

## Process change (owner request, `4b47c17`)
BUILD.md LOOP step (a): a CAPABILITY/new-feature win FIRST gets a **DESIGN HUDDLE** — the builder brainstorms the impl
with ≥2 critic-panel seats vs PRIMARY sources, names the segfault/leak/gate/BG+FG-parity/byte-identical/token traps, and
settles the minimal GENERAL shape + the LIVE proof BEFORE building. HARDEN wins skip it. HARDEN.md unchanged (adds no
features by law). The huddle (run for wait_responsive + set_display) immediately caught: the wrong home file
(desktop/window.ts doesn't exist → desktop/events.ts), the SMTO 5-second server-block caveat + the isWindow staleness
guard, and the dmFields **OR-don't-overwrite** correction + the dmDisplayOrientation@84 union-offset confirmation.

## Convergence sweep (3 adversarial seats over the new surface) — CLEAN
- **FFI-offset/leak**: every new offset/flag/slot/signature re-verified vs wingdi.h/winuser.h/oaidl.h/winreg.h + the
  bindings + live; no .ptr-across-await (all synchronous); the 3 try/finally fixes byte-identical; registryCreateKey
  RegCloseKey's on every path; disk/display/events hold no OS handles.
- **Byte-identical/security**: the trim gating is field-by-field EXACTLY aligned with matches() (table); struct never
  escapes; subtree paths (has/labeledBy) untouched; registry_key + set_display confirm+os gated, no persisted
  black-screen, recursive delete explicit; wait_responsive/list_volumes correctly 'read'.
- **Token/doc/completeness**: 4 descriptions lean; error paths name the next step; counts reconcile 92/70/36/22 across
  tool-count.test + README + AI.md; every tool/file/export enumerated; server.json correctly NOT bumped; all GENERAL
  primitives; no leaking test (every new example closes its window / kills its server in finally).
- **One finding (fixed, `3e0b116`)**: disk.ts comment + TODO.md said the GetVolumeInformationW out-params were typed
  `LPDWORD`; the binding actually types them `LPVOID` (MS Learn: LPDWORD _Out_opt_). Corrected — doc-only, tsc 0.

## Declined / owner-deferred (re-confirmed STILL walls)
- **manage_task RUN/enable/disable** — a real shell-reach (`schtasks /run`), but the IRegisteredTask Run@12 / put_Enabled@11
  / ITaskFolder GetTask slots are COMMENT-INFERRED, not live-verified; a wrong COM slot segfaults. Cannot ship until the
  lead live-derives the slots against a benign task. Owner-deferred.
- Prior declines unchanged: DockPattern, TextEditPattern, ItemContainer/VirtualizedItem VARIANT-segfault, OLE drag-drop,
  clipboard-history, toast, SetWindowDisplayAffinity, RegisterHotKey, virtual-desktop move-window.

## CONVERGED — 2026-06-21
10 commits this turn (b80063e…3e0b116), all pushed. In one convergence pass EVERY lane CLEAN-with-evidence; tsc 0, 52
unit tests + every new integration test green, biome clean, tree clean. The strict bar (capability ships IFF a real job
+ general + gated + benchmarked + design-huddled; HARDEN ships IFF byte-identical + a measured axis + minimal diff)
produced 8 real slices and 0 speculative edits → STOP. (No version bump / server.json / MCP-registry — owner releases.)
