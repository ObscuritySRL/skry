import { expect, test } from 'bun:test';

// readVisibleText and views walk a UIA collection in a SYNCHRONOUS loop, reading each element through a fixed out-buffer
// that is loop-INVARIANT scratch (written by the vcall, read inline before the next vcall — no await). Those buffers
// belong ABOVE the loop, exactly as getSelectedText already hoists its range/text buffers. A regression that moves a
// Buffer.alloc back inside either loop re-introduces N Buffer.alloc(8)+.ptr FFI registrations per call with BYTE-IDENTICAL
// output, so no correctness test would catch it. This pins the perf invariant structurally: neither hot loop allocates.
const patterns = await Bun.file(`${import.meta.dir}/../element/patterns.ts`).text();

// The body of `export function NAME` up to the next top-level export, sliced from its first `for (` onward — i.e. the
// loop body plus everything after it, where a re-introduced per-iteration alloc would land.
function loopAndAfter(fn: string): string {
  const start = patterns.indexOf(`export function ${fn}`);
  expect(start).toBeGreaterThan(-1); // the function exists (parser sanity)
  const next = patterns.indexOf('\nexport ', start + 1);
  const body = patterns.slice(start, next === -1 ? undefined : next);
  const forAt = body.indexOf('for (');
  expect(forAt).toBeGreaterThan(-1); // it has the collection-walk loop
  return body.slice(forAt);
}

for (const fn of ['readVisibleText', 'views']) {
  test(`${fn}: no Buffer.alloc inside the collection loop (loop-invariant out-buffers stay hoisted)`, () => {
    expect(loopAndAfter(fn)).not.toContain('Buffer.alloc');
  });
}
