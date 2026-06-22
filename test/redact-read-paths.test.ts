import { expect, test } from 'bun:test';

// Every on-screen read path must route its text through redactSecrets before it reaches the model — a
// secret-shaped token (AWS key / Bearer / JWT / PEM / high-entropy run) read off the screen is a leak into a
// persisted/loggable sink. act('read'), read_table, inspect_element's `value`, and read_clipboard already do.
// This pins the two paths that previously fenced-without-redacting: the OCR handler and inspect_element's
// TextPattern body. (redactSecrets behavior itself is covered by the trace-redaction integration test; this
// guards the WIRING — that a future edit cannot silently drop the call on these paths.)
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('ocr handler redacts both the line text and per-word text', () => {
  expect(mcp).toContain('redactSecrets(line.text)');
  expect(mcp).toContain('redactSecrets(word.text)');
  // and never emits the raw OCR text unmasked into the row/word render
  expect(mcp).not.toContain('${line.text}`');
  expect(mcp).not.toContain('JSON.stringify(word.text)');
});

test('inspect_element TextPattern body is redacted (the sibling value line already is)', () => {
  expect(mcp).toContain('redactSecrets(value)'); // pre-existing sibling, sanity
  expect(mcp).toContain('const redacted = redactSecrets(text)'); // the newly-wired TextPattern body
});
