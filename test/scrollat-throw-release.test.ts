import { expect, test } from 'bun:test';

// scrollAt() walks up from the element under a point to the first scrollable ancestor, reading each node's scrollInfo
// (a getPattern + pattern vcalls) and .parent (a TreeWalker vcall) — both throw the use-after-free guard if a node is
// torn down mid-walk on a fast-changing tree. The per-node release sat OUTSIDE any try/finally (a bare element.release()
// before reassigning to the parent), so a scrollInfo/parent throw skipped it and leaked the walked node. Same
// leak-on-throw class as getSelectedText/elementArrayNames/walkFolder/msaa/subtreeMatches. The throw is a tree-timing
// race (not deterministically reproducible), so pin the guard structurally: the per-node release must sit in a finally.
const src = await Bun.file(`${import.meta.dir}/../input/coords.ts`).text();
const start = src.indexOf('export function scrollAt(');
const body = src.slice(start, src.indexOf('\n}', start) + 2); // scrollAt's own body only (stop at its closing brace)

test('scrollAt parsed (the scrollable-ancestor walk is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('.scrollInfo'); // the throwable getPattern read
  expect(body).toContain('.parent'); // the throwable TreeWalker read
});

test('scrollAt releases each walked node in a finally (no leak when scrollInfo/parent throws)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*node\.release\(\)/); // RED on the old bare per-node `element.release();`
});
