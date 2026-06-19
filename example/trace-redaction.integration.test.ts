/**
 * trace-redaction — REGRESSION for the Panel-A security finding: set_env/get_env/registry_get echoed the value on
 * result line 1, and traceCall journals only `text.split('\n',1)[0]` — so a secret-valued env var or registry value
 * leaked VERBATIM into the UMBRIEL_TRACE journal, defeating the `value` arg-masking. Fix: the value now lives on line 2
 * (off the journaled line-1 sample), set_env doesn't echo it at all, and traceCall runs the observation through
 * redactSecrets() as defense-in-depth.
 *
 * Proof: drive the real server with UMBRIEL_TRACE on, set a SECRET_SHAPE value into PROCESS scope (transient — no
 * registry write, no persistence), read it back, then assert the secret appears in NEITHER the trace journal NOR the
 * args (which were already masked). Process scope only, throwaway var, temp trace file — all cleaned up.
 *
 * Run: bun run example/trace-redaction.integration.test.ts
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const SECRET = 'AKIAIOSFODNN7EXAMPLE'; // a SECRET_SHAPE token redactSecrets would catch if it ran
const VAR = '__UMBRIEL_TRACE_PROBE__';
const traceDir = mkdtempSync(join(tmpdir(), 'umbriel-trace-'));
const tracePath = join(traceDir, 'trace.jsonl');

const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'full', UMBRIEL_TRACE: tracePath } });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buffer = '';
const pending = new Map<number, (m: Rpc) => void>();
void (async () => {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      try {
        const m = JSON.parse(line) as Rpc;
        if (typeof m.id === 'number' && pending.has(m.id)) {
          pending.get(m.id)!(m);
          pending.delete(m.id);
        }
      } catch {}
    }
  }
})();
let nextId = 1;
const call = (method: string, params: unknown): Promise<Rpc> => {
  const id = nextId++;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  proc.stdin.flush();
  return new Promise((resolve) => pending.set(id, resolve));
};
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';

try {
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'trace', version: '1' } });
  await call('tools/call', { name: 'set_env', arguments: { scope: 'process', name: VAR, value: SECRET } });
  const read = textOf(await call('tools/call', { name: 'get_env', arguments: { scope: 'process', name: VAR } }));
  await call('tools/call', { name: 'set_env', arguments: { scope: 'process', name: VAR, delete: true } });
  await Bun.sleep(300); // let the async trace appends flush

  // the model still gets the real value (on line 2) — the fix protects the JOURNAL, not the answer
  assert(read.split('\n')[1] === SECRET, 'get_env still returns the real value to the model (line 2)');

  const journal = readFileSync(tracePath, 'utf8');
  assert(journal.length > 0 && /"tool":"get_env"/.test(journal), 'the trace journal recorded the env calls');
  assert(!journal.includes(SECRET), 'the SECRET value does NOT appear anywhere in the trace journal (leak closed)');
  assert(/"value":"<\d+ chars>"/.test(journal), 'the set_env value ARG was masked to a length in the journal');
} finally {
  proc.kill();
  rmSync(traceDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nPASS — secret env/registry values never reach the UMBRIEL_TRACE journal (off line 1 + redacted observation).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
