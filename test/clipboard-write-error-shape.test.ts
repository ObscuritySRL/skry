import { expect, test } from 'bun:test';

// A failed clipboard WRITE must be an errorResult (isError:true), never a success-shaped textResult: auditCall + traceCall
// both derive ok = (isError !== true), so a textResult on a failed MUTATING call is journaled ok:true — a corrupt forensic
// trail (a write that did NOT happen, recorded as success). set_clipboard's false branch was textResult('failed to set
// clipboard') while its two siblings copy_image / copy_files correctly used errorResult. Pin the corrected shape so the
// divergence cannot silently return. Static-source pin — the repo idiom (handlers-align / no-gating-boilerplate).
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('set_clipboard reports a failed write as an error (errorResult), not a success-shaped textResult', () => {
  expect(mcp).not.toContain('failed to set clipboard'); // the old success-shaped failure string is gone
  // success → textResult('clipboard set') (byte-identical happy path); failure → errorResult (matching copy_image / copy_files)
  expect(mcp).toContain("? textResult('clipboard set') : errorResult('set_clipboard:");
});

test('all three clipboard WRITE tools shape a failed write as an errorResult', () => {
  // copy_image / copy_files already used errorResult on a failed write; this keeps all three writers consistent.
  expect(mcp).toContain("errorResult('copy_image: could not set the clipboard image')");
  expect(mcp).toContain("errorResult('copy_files: could not set the clipboard file drop')");
});
