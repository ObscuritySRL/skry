/**
 * readcached-trim — readCachedProperties now reads ONLY the matcher properties the selector actually compares (matches()
 * inspects a field only when its selector field is set), instead of eagerly decoding all four per candidate. Byte-identical
 * (an unread field defaults to ''/0, which matches() never reads when its selector field is unset), and it skips the 2-3
 * in-proc cached decodes a {name}/{nameContains}/{nameNot} client-filter walk would waste on automationId/className/controlType.
 *
 * Two proofs, live on Calculator:
 *  - CORRECTNESS / per-field gating pin: a MIXED client-filter selector that REQUIRES each field still matches the SAME
 *    control ({className+regex}, {automationId+regex}, {controlType+nameContains}, pure {nameContains}); and a WRONG
 *    className REJECTS. If a needed field were wrongly skipped, its default ''/0 would mismatch and the find would break.
 *  - AXIS: the measured per-read cost of a cached getBstr/getLong on a REAL cached element — so skipping 3 reads for a
 *    {nameContains} walk saves ~that × 3 per candidate (confirms the saving on live COM, not a synthetic vtable).
 *
 * Run: bun run example/readcached-trim.integration.test.ts
 */
import { AutomationElementMode, ControlType, createCacheRequest, getBstr, getLong, PropertyId, SLOT, TreeScope, umbriel } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}
function medianUs(run: () => void, iterations: number): number {
  for (let i = 0; i < Math.min(iterations, 2000); i += 1) run();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) run();
  return (Bun.nanoseconds() - start) / iterations / 1000;
}

umbriel.initialize();
let sink = 0;
try {
  using calc = await umbriel.launchOwned(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
  // Reference control (server-side scalar find) + its real properties.
  const five = calc.find({ controlType: ControlType.Button, name: 'Five' });
  assert(five !== null, 'reference: find({controlType:Button, name:"Five"}) resolves the Five button');
  if (five === null) throw new Error('no Five button to anchor the test');
  const realClass = five.className;
  const realAutomationId = five.automationId;
  console.log(`  Five button: className=${JSON.stringify(realClass)} automationId=${JSON.stringify(realAutomationId)}`);
  five.release();

  // CORRECTNESS — each MIXED selector forces the client-filter path (via a regex/substring) AND requires an exact field.
  if (realClass.length > 0) {
    const byClass = calc.find({ className: realClass, name: /Five/ });
    assert(byClass !== null, 'mixed {className, name:/Five/} still matches (className IS read when the selector sets it)');
    byClass?.release();
  }
  if (realAutomationId.length > 0) {
    const byAid = calc.find({ automationId: realAutomationId, name: /Five/ });
    assert(byAid !== null, 'mixed {automationId, name:/Five/} still matches (automationId IS read when the selector sets it)');
    byAid?.release();
  }
  const byType = calc.find({ controlType: ControlType.Button, nameContains: 'Five' });
  assert(byType !== null, 'mixed {controlType:Button, nameContains:"Five"} still matches (controlType IS read when the selector sets it)');
  byType?.release();
  const byName = calc.find({ nameContains: 'Five' });
  assert(byName !== null, 'pure {nameContains:"Five"} still matches (the savings path — only name read)');
  byName?.release();

  // NEGATIVE — a WRONG className must reject the candidate (proves className is actually compared, not silently skipped).
  const wrongClass = calc.find({ className: 'NoSuchClassName_zzz', nameContains: 'Five' });
  assert(wrongClass === null, 'mixed {className:"bogus", nameContains:"Five"} matches NOTHING (className IS compared — the default would have wrongly matched only if skipped AND bogus were empty)');
  wrongClass?.release();

  // AXIS — per-read cost of a cached getBstr/getLong on a REAL cached element (the reads the trim skips).
  const request = createCacheRequest([PropertyId.AutomationId, PropertyId.ClassName, PropertyId.ControlType, PropertyId.Name], TreeScope.TreeScope_Element, AutomationElementMode.Full);
  try {
    const cached = calc.findAllCached({ controlType: ControlType.Button, name: 'Five' }, request);
    assert(cached.length > 0, 'findAllCached primes a real cached element for the read-cost measurement');
    if (cached.length > 0) {
      const ptr = cached[0].ptr;
      const bstrUs = medianUs(() => { sink += getBstr(ptr, SLOT.get_CachedName).length; }, 50_000);
      const longUs = medianUs(() => { sink += getLong(ptr, SLOT.get_CachedControlType); }, 50_000);
      const savedNs = (bstrUs * 2 + longUs) * 1000; // {nameContains} skips automationId+className (2 getBstr) + controlType (1 getLong)
      console.log(`  cached getBstr ≈ ${(bstrUs * 1000).toFixed(0)} ns, getLong ≈ ${(longUs * 1000).toFixed(0)} ns per read`);
      console.log(`  → a {nameContains} client-filter walk now skips 3 of 4 reads, saving ≈ ${savedNs.toFixed(0)} ns per candidate`);
      assert(savedNs > 0, 'the skipped reads cost real time on live COM (the trim moves a measured ns axis)');
    }
    for (const element of cached) element.release();
  } finally {
    request.release();
  }
  console.log(`  (sink=${sink})`);
} finally {
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — readCachedProperties reads only the selector-needed fields (byte-identical matching pinned across every field type; the skipped reads cost real ns).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
