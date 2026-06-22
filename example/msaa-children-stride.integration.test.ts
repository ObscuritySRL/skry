/**
 * msaa-children-stride — regression gate for the x64 sizeof(VARIANT) used to size + stride the AccessibleChildren
 * output array in element/msaa.ts. A VARIANT is 24 bytes on x64 (8-byte header: vt + 3×WORD reserved; 16-byte value
 * union: DECIMAL / __tagBRECORD). AccessibleChildren WRITES `count` full VARIANTs, so sizing the buffer at the old
 * VARIANT_SIZE=16 overflowed it by 8·count bytes AND strided the decode at 16 — reading the middle of each real
 * stride-24 element. The finder's live probe (Shell_TrayWnd, 6 children) showed the 16-byte stride decoded only
 * [0]=vt9(ok) [1]=vt0 [2]=garbage [3]=vt9 [4]=vt0 — i.e. any many-child container collapses to ~1-2 decoded
 * entries, and a garbage vt==VT_DISPATCH with a mid-pointer value would feed vcall(QueryInterface) an unmapped
 * pointer → uncatchable segfault (the com.ts:32 hazard).
 *
 * Proof (live): Character Map's glyph grid exposes a large single-node MSAA child array. With the stride-24 fix
 * one node decodes far more than the stride-16 bug ever could (which caps a container at ~1-2). We assert the
 * deepest fan-out is ≥ 10 — impossible under the bug, comfortable under the fix (the grid is ~200 cells).
 * Character Map is closed in teardown (closeWindow, not dispose).
 *
 * APIs demonstrated:
 * - umbriel.msaaTree (the oleacc IAccessible fallback walk; AccessibleChildren array decode)
 * - umbriel.launch / closeWindow (charmap.exe is a classic owner-draw app with a rich MSAA tree)
 *
 * bun test is broken repo-wide for FFI — runnable harness (charmap.exe):
 * Run: bun run example/msaa-children-stride.integration.test.ts
 */
import { closeWindow, type MsaaNode, umbriel } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function countNodes(node: MsaaNode): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

function maxFanout(node: MsaaNode): number {
  let max = node.children.length;
  for (const child of node.children) max = Math.max(max, maxFanout(child));
  return max;
}

umbriel.initialize();
const charmap = await umbriel.launch(['charmap.exe'], { title: 'Character Map' }).catch(() => null);
try {
  if (charmap === null) console.log('  skip: Character Map did not launch');
  else {
    await Bun.sleep(900); // let the glyph grid render its MSAA children
    const tree = umbriel.msaaTree(charmap.hWnd, 8);
    assert(tree !== null, 'msaaTree returned a tree for Character Map');
    if (tree !== null) {
      const total = countNodes(tree);
      const fanout = maxFanout(tree);
      console.log(`  total MSAA nodes: ${total}, deepest single-node fan-out: ${fanout}`);
      // The stride-16 bug collapses any AccessibleChildren array to ~1-2 decoded entries; a fan-out ≥ 10 proves
      // one node's child array decoded correctly at the real 24-byte stride. Character Map's grid is ~200 cells.
      assert(fanout >= 10, `a single MSAA node decoded ≥10 children (deepest fan-out ${fanout}) — the stride-16 bug caps this at ~1-2`);
    }
  }
} finally {
  if (charmap !== null) {
    closeWindow(charmap.hWnd);
    charmap.dispose();
  }
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — AccessibleChildren decodes the full child array at the correct x64 24-byte VARIANT stride.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
