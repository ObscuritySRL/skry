# FINISH.md — what's left to finish the capability lane + exit

Wind-down note for the 2026-06-27/28 build session. The **harden panel is converged and shipped**; the **capability
lane has 5 queued slices**, each design-triaged and ready to build + LIVE-verify. The full triage is in
`findings/2026-06-27-cycle3-two-panel-menu-huddle.md`.

## Shipped + pushed this session
- `78b09f3` perf(mcp): −138 wire bytes (two restated field descriptions).
- `f59cd5e` docs(findings): cycle-3 record (1 ship, 3 evidence-backed declines, 2 fabrication catches, deferred queue).
- (local-only, gitignored) ARTICLE.md version note synced 1.12.0 → 1.14.0.

## In the working tree, NOT yet wired (this session's WIP)
- **`desktop/menu.ts`** — the design-huddled classic-Win32 **HMENU read core** (`windowMenu` + `renderMenu`). tsc-clean,
  biome-formatted, but **NOT imported anywhere yet** (inert — does not affect the running server). It bakes in the
  huddle's corrections: u32 `0xFFFFFFFF` sentinels (not −1), low-byte-only flag mask (dodges the popup high-byte/count
  ambiguity), HWND-subtree menu-hunt (GetMenu on the frame is 0 for resmon/regedit — the menu often lives on a child),
  `count>0` bogus-handle rejection, `maxDepth`+visited recursion bound, never `DestroyMenu`.

## To FINISH `list_menu` (the headline read tool) — mechanical
1. **Wire the facade** (`index.ts`): `import { windowMenu, renderMenu, type MenuItem, type WindowMenu } from './desktop/menu';`
   add `windowMenu` to the `umbriel` object (near `windowTree`, line ~72) and `renderMenu`/types to the exports.
2. **Add the MCP tool** (`mcp.ts`): in `TOOLS` (near `native_tree` ~2036) add `{ name: 'list_menu', category: 'read',
   description: '<classic HMENU menu bar, cursor-free + background, that UIA can't see until opened; found:false on
   WinUI/ribbon apps>', inputSchema: { type: 'object', properties: { hWnd: { type: ['string','number'], description:
   HWND_DESC }, ref: { type: 'string', description: REF_DESC } } } }`. Import `renderMenu` (the `renderWindowTree` import
   block ~107). Handler (near `native_tree` ~3342): `list_menu: (args) => textResult(redactSecrets(renderMenu(umbriel.windowMenu(resolveHwnd(args)))))`.
3. **Live-verify** (game is closed — spawn OK; CLOSE every window in a `finally`, dispose≠close): drive a classic-menu app
   — **msinfo32** (confirmed: full static menu, `GetMenu` valid) and **resmon** (confirmed: menu on a child `WdcWindow`,
   exercises the hunt). Assert the read tree matches the visible menu. regedit/notepad-classic are secondary.
4. **Tests**: (a) `test/menu.test.ts` UNIT test (NO window) — `User32.CreateMenu()` + `AppendMenuW` a string item, a
   `MF_POPUP` submenu, a `MF_SEPARATOR`, and an `MF_GRAYED` item; assert `walkMenu` labels/ids/enabled/separator and
   EMPIRICALLY confirm the `0xFFFFFFFF` sentinel + separator heuristic (`DestroyMenu` the synthetic menu in a `finally`).
   (b) `example/list-menu.integration.test.ts` — the live read above.
5. **Docs sync** (all 6): AI.md (tool list + the new read tool), README.md (tool table + count 99→**100**, read 41→**42**,
   safe 76→**77**), prompts/BUILD.md, prompts/HARDEN.md, ARTICLE.md (gitignored — local), and **`test/tool-count.test.ts`**
   (the gated counts 99/76/41/23 → 100/77/42/23). server.json/package.json version = owner (do NOT bump).
6. `bunx tsc --noEmit` (0) + `bun test test/` (green) + the integration test; then **commit&push** one slice
   (`feat(menu): list_menu — read a classic Win32 HMENU menu bar cursor-free + background`).

## To FINISH the 4 redesign wins (each: build → live-verify → add test → docs → 1 commit&push)
1. **`find_image`/`find_color` `{click?}`** — on a hit, route the won `{x,y}` through the existing `click_point` path;
   default false = byte-identical find-only. Gate stays effectively 'input' when clicking. Removes the find→click_point
   round-trip (click_text is the one-call precedent). Live-verify on any on-screen target.
2. **`type` `{clear?}`** — `type` silently APPENDS at the caret (concatenates into a pre-filled field). Quick design
   huddle on the clear mechanism (own-HWND: `WM_SETTEXT('')` or `EM_SETSEL(0,-1)`+`WM_CLEAR`, cursor-free; no-HWND:
   Ctrl+A+overwrite, needs foreground). Add `{clear?}` default false = byte-identical, AND disclose the append semantics
   in the description regardless. Default-change → owner-flag. Live-verify on a pre-filled edit.
3. **`set_view` `{name?}`** — match the MultipleView `GetViewName` list (case-insensitive) in addition to `{id}`;
   collapses the list_views→set_view round-trip for "flip Explorer to Details". Byte-identical when `{id}` passed.
   Live-verify on an Explorer window.
4. **`manage_window` move-only / resize-only** — allow move with only `x,y` (pass `SWP_NOSIZE`) / resize with only
   `w,h` (`SWP_NOMOVE`); removes a read round-trip to nudge a window (AHK WinMove parity). Byte-identical when all four
   given. Relaxed-required-args → owner-flag. Live-verify by moving a spawned throwaway window without resizing.

## DECLINED — do NOT rebuild (re-confirm the walls still hold per the loop, don't re-raise)
- `menu_command` — fire-and-forget WM_COMMAND violates the verifiable-action doctrine; background-destructive footgun;
  bypasses WM_INITMENUPOPUP. (Live-conceded it *fires* on msinfo32 — declined on doctrine, not infeasibility.)
- generic `pattern_invoke` dispatcher — vanity (live prevalence ~0 + segfault/gate/disclosure hazards).
- CDP / `web_evaluate` — strict subset of the existing UIA-web reach + forbidden sidecar. Bun.WebView still
  `ERR_DLOPEN_FAILED`; PR #30483 CLOSED/dead → watch issue #29102.

## Owner-reserved flags (autonomous agents do NOT touch)
- **server.json** omits `UMBRIEL_TRACE_SNAPSHOTS` (implemented mcp.ts:320-325) — owner to add an `environmentVariables`
  entry or confirm the omission is intentional.
- The two open binding gaps in **TODO.md** (kernel32 `GetVolumeInformationW` `_Out_opt_`; advapi32
  `EnumServicesStatusExW` `pszGroupName` `_In_opt_`) stay owner-reserved upstream fixes.

## Exit checklist
- [x] `desktop/menu.ts` tsc-clean + biome-formatted, committed (unwired WIP).
- [x] Harden ships pushed; cycle-3 findings recorded.
- [ ] The 5 capability slices above (each ends in its own commit&push).
- Verify before any ship: `bunx tsc --noEmit` (0) · `bun test test/` (green) · the relevant `example/*.integration.test.ts`
  (CLOSE every window). Then `git commit` (Conventional Commits, 1/win) + `git push origin main`.
- Re-confirm declined items still wall before re-touching them. Spawn windows freely (game closed) but always close them.
