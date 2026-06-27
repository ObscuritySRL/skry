import { expect, test } from 'bun:test';

// The MSAA tree walk (msaa.ts walk()) enumerates a window's IAccessible children: each VT_DISPATCH child is a
// caller-owned IDispatch (`dispatch`) QueryInterface'd to an IAccessible (`childAccessible`), then recursed into.
// The recursive walk() — and the QueryInterface vcall itself — can throw the use-after-free guard if a node is torn
// down in the live MSAA tree (msaa_tree is the legacy/owner-draw fallback over a real, mutating window). The bare
// `comRelease(childAccessible)` and `comRelease(dispatch)` that sat OUTSIDE any try/finally were then skipped on that
// throw, leaking BOTH child proxies per stack frame on the way up (the only finally in scope, msaaTree's, frees just
// the root). Same leak-on-throw class as getSelectedText/readVisibleText/readTable/elementArrayNames/walkFolder. The
// throw is a tree-timing race (not deterministically reproducible), so pin both releases structurally: each must sit
// in a finally.
const src = await Bun.file(`${import.meta.dir}/../element/msaa.ts`).text();
const start = src.indexOf('function walk(');
const body = src.slice(start, src.indexOf('\n/**', start + 1));

test('msaa walk parsed (the VT_DISPATCH child branch is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('IACC_QUERYINTERFACE'); // the per-child QueryInterface vcall that can throw
  expect(body).toContain('walk(childAccessible'); // the recursive descent that can throw on a torn-down deeper node
});

test('msaa walk releases the child IDispatch and IAccessible in a finally (no leak on a recursive-walk throw)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*comRelease\(dispatch\)/); // the VARIANT's IDispatch — RED on the old bare `comRelease(dispatch);`
  expect(body).toMatch(/}\s*finally\s*\{\s*comRelease\(childAccessible\)/); // the QueryInterface'd IAccessible — RED on the old bare `comRelease(childAccessible);`
});
