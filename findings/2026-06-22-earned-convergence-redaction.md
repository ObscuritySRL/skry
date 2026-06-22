# Earned convergence — adversarial self-audit closed the redaction class — 2026-06-22

After the capability/harden queue was resolved (`2026-06-21-build-final-c7-c8.md`), the BUILD loop's RESOLUTION rule —
*convergence is EARNED by a push that finds nothing, never asserted* — was honored with an adversarial sweep over THIS
session's own surface (the 25-commit diff). It was not clean; the push surfaced real defects, which were fixed and
re-verified until a sweep came back empty. End: HEAD `118fe8f`, tsc 0, **90 unit tests**, **95 tools**, tree clean, pushed.

## THE SWEEP ARC (each pass an independent adversarial auditor; fixed → re-verified until clean)
- **Sweep 1 (6 lanes over the diff):** ffi-segfault / leaks / fabrication / byte-identical returned CLEAN-with-evidence
  (the FFI lane even ran live proofs — activePowerPlan ×5, a 511-cut-point decodePNG truncation sweep). security-gate +
  doc-completeness found 4: click_text echoed raw OCR text; AI.md missed waitForVisualIdle/frameDifference/decodePNG/
  activePowerPlan. Fixed (`4dd65f3`, `9638318`).
- **Confirm 1:** fixes held, but found the BIGGER leak — the desktop snapshot tree (`refmap.ts` nodeState `value=`)
  emitted on a non-password Edit/combo's ValuePattern value unredacted, returned by EVERY withSnapshot. Fixed at the
  single `renderTree` chokepoint + find_text (`c8d5ea3`); click-position doc (`92d7d14`).
- **Confirm 2:** renderTree confirmed (masks the whole rendered string incl name/automationId), doc lane CLEAN, but
  found the SIBLING renderers the chokepoint missed: the diff fast-path (the COMMON post-action case), msaa_tree,
  java_tree/javaObservation, native_tree. Fixed (`e0b2d0d`).
- **Self-grep + Confirm 3:** the per-action `named()`/`target` echo + 6 direct control-name echoes (inspect_element,
  inspect_point, marked legend, get_focused, read-fallback, ambiguous list) (`55041ba`, `f8604ff`); then formatNoMatch's
  candidate names (fixed SYSTEMATICALLY at the dispatch catch boundary) + inspect_element helpText/itemStatus (`0c7b587`).
- **Confirm 4:** all chokepoints verified; found the desktop_snapshot {root} scope HEADER (built outside renderTree)
  echoing root.name. Fixed (`cb5a2b0`).
- **Confirm 5:** found the list_windows toast / tray-flyout `label` (a toast's announced UIA name = content, not a window
  title) — side-stepped the `.name` negative pin via the `.label` field. Fixed (`118fe8f`).
- **Confirm 6: CLEAN — 0 findings.** Exhaustively enumerated all 95 handlers + every renderer/helper; every
  on-screen-content path reaches a chokepoint or explicit mask; negative-pin test 10/10. The clean push that EARNS it.

## THE REDACTION CLASS — now closed by THREE structural chokepoints (all redactSecrets in mcp.ts; lib renderers stay pure)
1. **renderTree** (`~635`) — the single tree→string boundary (renderSnapshot has no other caller) → every
   snapshot / desktop_snapshot / withSnapshot body, redacted before the size cap.
2. **dispatch CATCH** (`~4158`) `errorResult(redactSecrets(error.message))` — every lib-thrown message that embeds live
   on-screen content (formatNoMatch candidate names, assertActionable).
3. **named()** (`~386`) + act() target — the control name echoed in every action result.
Plus explicit per-path masks on the diff path, msaa/java/native renderers, read_table cells, act(read), inspect_element
(name/value/TextPattern/helpText/itemStatus), ocr, click_text, find_text, inspect_point, marked legend, get_focused,
ambiguous-selector list, scope header, toast/tray labels, and all clipboard reads. `test/redact-read-paths.test.ts`
(10 tests, 31 assertions) pins every chokepoint + mask + a negative blacklist of raw `JSON.stringify(<x>.name|.label)`.
**By-design unmasked** (verified, not leaks): window TITLES + process/service/adapter/volume names + automationId/className
(structural identity); the agent's OWN echoed args; explicit OS DATA reads (run_program stdout, registry/env/file/event-log).

## SESSION TOTAL (all findings files)
**25 commits.** HARDEN (7): sendKeys, casts, OCR+TextPattern redaction, GDI-leak, COM-proxy-leak, token-trims.
CAPABILITY (6): C1 computer-use WGC, C5 battery+power-plan, C4 find_image/find_color+decodePNG, C3 wait_visual_idle,
C8 select-mode, C7 click position. EARNED-CONVERGENCE REDACTION HARDENING (8 commits, 11 on-screen-content paths +
3 chokepoints). MACHINE GUARDS: handlers-align + the redact-read-paths negative pin. DECLINED w/ evidence: H7, C6
(live-refuted), server.json. DEFERRED: C2 (no blanking surface). 92→95 tools, 52→90 unit tests, tsc 0, biome clean,
tree clean. **Every lane CLEAN-with-evidence in an independent adversarial push → convergence is EARNED, not asserted.**
