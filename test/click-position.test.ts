import { expect, test } from 'bun:test';

// C7: the click tool's position:{x,y} (element-local offset) lets an agent click a SPECIFIC interior point of a
// single-Element canvas/map/video-timeline/seek-bar cursor-free, via the already-proven postClickToHwnd own-window
// path — unlike click_point (absolute coords, hits the topmost window at the pixel). This pins the clickElement offset
// handling: validate the offset against bounds (THROW, no silent clamp), skip the semantic invoke/toggle/select
// activation (a positioned click is a TRUE coordinate click), and target bounds.{x,y}+offset on BOTH the cursor-free
// and cursor:true paths. The posted-click landing is the same primitive every cursor-free click in the suite proves.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();
const start = mcp.indexOf('function clickElement(');
const body = mcp.slice(start, mcp.indexOf('\nfunction ', start + 1));

test('clickElement takes an element-local offset and targets bounds.{x,y} + offset', () => {
  expect(body).toContain('offset?: { x: number; y: number }');
  expect(body).toContain('positioned = { x: bounds.x + offset.x, y: bounds.y + offset.y }');
});

test('a positioned click validates the offset against bounds (throws, no silent clamp) and skips semantic activation', () => {
  expect(body).toContain('offset.x >= bounds.width || offset.y >= bounds.height'); // out-of-bounds → throw, not clamp
  expect(body.split('positioned === undefined').length - 1).toBeGreaterThanOrEqual(2); // the doubleClick + left-click semantic blocks are both guarded
  expect(body.split('positioned ?? clickPoint(element)').length - 1).toBe(2); // both the cursor-free and the cursor:true coordinate paths honor the offset
});

test('the click tool wires position through to clickElement without a cast', () => {
  expect(mcp).toContain('const position = record(args.position)');
  expect(mcp).toContain('clickElement(element, button, args.doubleClick === true, args.cursor === true, offset)');
});
