import { expect, test } from 'bun:test';

// reveal() checks each candidate via realized(), which reads boundingRectangle (getRect vcall) + isOffscreen
// (getPropertyValue vcall) — both throw the use-after-free guard if the candidate is torn down before the read on a
// fast-changing virtualized list. At two sites (the up-front `direct` find and the per-step `found` in the scan loop)
// the candidate was freed by a BARE release AFTER the realized() read: a throw skipped it and leaked the candidate.
// These must use try/CATCH (not finally) because the realized()==true path RETURNS the candidate to the caller, who
// then owns it (must NOT be released) — so the guard frees the candidate only on a throw (catch → release → rethrow)
// and on the realized==false fall-through, never on the owned return. Same leak-on-throw class as the prior fixes;
// the throw is a tree-timing race (not deterministically reproducible), so pin both guards structurally.
const src = await Bun.file(`${import.meta.dir}/../element/element.ts`).text();
const start = src.indexOf('reveal(selector: Selector');
const body = src.slice(start, src.indexOf('\n  /**', start));

test('reveal parsed (the realized() candidate checks are present)', () => {
  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('realized(direct)'); // up-front find
  expect(body).toContain('realized(found)'); // per-scan-step find
});

test('reveal frees the direct candidate on a realized() throw (catch → release → rethrow, not on the owned return)', () => {
  expect(body).toMatch(/catch \(error\) \{\s*direct\.release\(\);[\s\S]{0,160}?throw error;/);
});

test('reveal frees the per-step found candidate on a realized() throw (catch → release → rethrow)', () => {
  expect(body).toMatch(/catch \(error\) \{\s*found\.release\(\);[\s\S]{0,160}?throw error;/);
});
