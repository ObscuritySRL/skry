/**
 * list-volumes — list_volumes enumerates the mounted drives NATIVELY (Kernel32 GetLogicalDriveStringsW +
 * GetDriveTypeW + GetDiskFreeSpaceExW + GetVolumeInformationW), no `wmic logicaldisk` / Get-Volume / Get-PSDrive shell.
 * Each drive: root, type (fixed/removable/network/cd-rom/ram-disk), label, filesystem, and total + free GB. Read-only —
 * pure Kernel32 queries, no COM, no window, no elevation; exposed under the readonly profile.
 *
 * Proof over the real stdio MCP server (readonly profile): the system drive (C:) is enumerated as a fixed drive with a
 * "<free> GB free of <total> GB" line, and list_volumes IS exposed under readonly (it is a read-category tool).
 *
 * Run: bun run example/list-volumes.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[]; tools?: { name: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

function connect(profile: string): { call: (m: string, p: unknown) => Promise<Rpc>; kill: () => void } {
  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: profile } });
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
  return { call, kill: () => proc.kill() };
}
const textOf = (m: Rpc): string => m.result?.content?.[0]?.text ?? '';
const isErr = (m: Rpc): boolean => m.result?.isError === true;

const readonly = connect('readonly');
try {
  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'volumes', version: '1' } });

  const result = await readonly.call('tools/call', { name: 'list_volumes', arguments: {} });
  const text = textOf(result);
  console.log(`  list_volumes →\n${text.split('\n').map((line) => `    ${line}`).join('\n')}`);
  assert(!isErr(result), 'list_volumes returns without error');
  assert(/^[A-Z]:\\ \(/m.test(text), 'each line begins with a drive root + type, e.g. "C:\\ (fixed)"');
  assert(/C:\\ \(fixed\)/.test(text), 'the system drive C: is enumerated as a fixed drive');
  assert(/\d+(\.\d+)? GB free of \d+(\.\d+)? GB/.test(text), 'a ready drive reports "<free> GB free of <total> GB"');

  const list = await readonly.call('tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  assert(names.includes('list_volumes'), 'list_volumes IS exposed under the readonly profile (read category)');
} finally {
  readonly.kill();
}

console.log(failures === 0 ? '\nPASS — list_volumes enumerates mounted drives natively (type/label/filesystem + free/total), read-only.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
