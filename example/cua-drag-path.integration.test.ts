/**
 * cua-drag-path — fromCuaAction flattened an OpenAI-CUA drag.path[] to a straight 2-point line (kept only path[0] and
 * path[last]), and ComputerAction had no `path` field, so a curved / lasso / signature / slider-arc / node-connector
 * stroke collapsed to from→to even though dragStroke (multi-waypoint) and the MCP `drag {path}` tool already drive the
 * full polyline. fromCuaAction now carries the whole path through, and dispatch's left_click_drag walks it via dragStroke
 * when >1 point is supplied (real cursor, foreground-gated — exactly the MCP drag {path} behavior).
 *
 * Proof: (1) PURE — fromCuaAction({type:'drag', path:[4 pts]}) yields action.path of length 4 with start/coordinate =
 * first/last (the un-flatten). (2) LIVE — dispatch a 4-point zig-zag inside a spawned Notepad and assert the result
 * reports a "4-point stroke" AND the real cursor ends at the LAST waypoint (dragStroke walked the polyline). Notepad is
 * only drag-selected (never typed into) so it closes with no save prompt; window closed + disposed in teardown.
 *
 * bun test is broken repo-wide — runnable harness (spawned Notepad):
 * Run: bun run example/cua-drag-path.integration.test.ts
 */
import { closeWindow, dispatch, fromCuaAction, umbriel } from 'umbriel';
import User32 from '@bun-win32/user32';

const cursor = (): { x: number; y: number } => {
  const point = Buffer.alloc(8);
  User32.GetCursorPos(point.ptr!);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
};

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// (1) PURE — the un-flatten: a 4-point CUA drag keeps every waypoint, with start/coordinate as the endpoints.
const curved = fromCuaAction({ type: 'drag', path: [{ x: 10, y: 20 }, { x: 40, y: 80 }, { x: 90, y: 30 }, { x: 130, y: 110 }] });
assert(curved.action === 'left_click_drag', 'a CUA drag maps to left_click_drag');
assert(curved.path?.length === 4, `the full 4-point path is preserved (got ${curved.path?.length ?? 0})`);
assert(curved.startCoordinate?.[0] === 10 && curved.coordinate?.[0] === 130, 'start/coordinate remain the first/last points (2-point fallback intact)');
// A degenerate 1-point drag carries no multi-point path (so dispatch uses the 2-point fallback, not dragStroke).
assert(fromCuaAction({ type: 'drag', path: [{ x: 5, y: 5 }] }).path === undefined, 'a 1-point drag carries no multi-point path');

// (2) LIVE — dispatch the polyline and confirm the real cursor walked to the LAST waypoint.
umbriel.initialize();
const notepad = await umbriel.launch(['notepad.exe'], { title: 'Untitled - Notepad' }, 6000).catch(() => umbriel.launch(['notepad.exe'], { className: 'Notepad' }, 6000).catch(() => null));
try {
  if (notepad === null) {
    console.log('  skip(live): Notepad did not launch');
  } else {
    await Bun.sleep(700);
    const bounds = notepad.boundingRectangle;
    // A 4-point zig-zag fully inside the editor's client area (drag-select only — harmless, no text typed).
    const px = (fraction: number): number => Math.round(bounds.x + bounds.width * fraction);
    const py = (fraction: number): number => Math.round(bounds.y + bounds.height * fraction);
    const path = [{ x: px(0.2), y: py(0.35) }, { x: px(0.45), y: py(0.7) }, { x: px(0.7), y: py(0.35) }, { x: px(0.85), y: py(0.7) }];
    User32.SetCursorPos(7, 7); // park the real cursor far from the path
    await Bun.sleep(80);
    const result = await dispatch(notepad, { action: 'left_click_drag', path });
    await Bun.sleep(80);
    const after = cursor();
    const last = path[path.length - 1]!;
    console.log(`  dispatch -> ${JSON.stringify(result.output ?? result.error)}; cursor ${after.x},${after.y} vs last ${last.x},${last.y}`);
    assert(result.ok && /4-point stroke/.test(result.output ?? ''), `dispatch walked the 4-point stroke (got: ${JSON.stringify(result.output ?? result.error)})`);
    assert(Math.abs(after.x - last.x) <= 3 && Math.abs(after.y - last.y) <= 3, `the real cursor ended at the LAST waypoint (${after.x},${after.y} ≈ ${last.x},${last.y}) — dragStroke walked the polyline, not a 2-point flatten`);
  }
} finally {
  if (notepad !== null) {
    closeWindow(notepad.hWnd);
    notepad.dispose();
  }
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — fromCuaAction preserves the full drag path and dispatch walks it via dragStroke (no more 2-point flatten).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
