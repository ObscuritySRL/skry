import { expect, test } from 'bun:test';

// elementArrayNames() walks an IUIAutomationElementArray (e.g. a grid's column headers), reading each element's name
// and releasing it. The per-element name read goes through getBstr → a vcall that throws the use-after-free guard if
// the element proxy is torn down (the array was captured moments earlier, but a fast-changing tree can invalidate an
// entry before the read). The bare `comRelease(element)` that sat OUTSIDE any try/finally was then skipped and the
// element proxy leaked. Same leak-on-throw class as the sibling range/cell walks already fixed — getSelectedText,
// readVisibleText, readTable (patterns.ts), collectTasks (tasks.ts); this was the last per-element walk in patterns.ts
// still carrying the bare release. The throw is a tree-timing race (not deterministically reproducible), so pin the
// guard structurally: the per-element release must sit in a finally.
const src = await Bun.file(`${import.meta.dir}/../element/patterns.ts`).text();
const start = src.indexOf('function elementArrayNames(');
const body = src.slice(start, src.indexOf('\nfunction ', start + 1));

test('elementArrayNames parsed (the element-array name walk is present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('SLOT.get_CurrentName'); // the per-element name read that can throw via getBstr's vcall
});

test('elementArrayNames releases each element proxy in a finally (no leak when getBstr throws mid-walk)', () => {
  expect(body).toMatch(/}\s*finally\s*\{\s*comRelease\(element\)/); // RED on the old bare `comRelease(element);`
});
