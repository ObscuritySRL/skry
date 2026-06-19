/**
 * get-displays — get_displays enumerates the live display configuration NATIVELY (User32 EnumDisplayDevicesW +
 * EnumDisplaySettingsW(ENUM_CURRENT_SETTINGS), DEVMODEW decoded by hand), no WMI/PowerShell. Each attached monitor:
 * device + adapter name, current resolution (W×H), refresh rate (Hz), color depth (bpp), and which is primary —
 * for coordinate scaling, window-fit checks, and choosing which monitor to capture. category 'read'.
 *
 * Proof over the real stdio MCP server (read-only): at least one display renders in
 * "\\.\DISPLAYn (primary): W×H @ NHz, B-bit — adapter" form with exactly one primary, and get_displays is available
 * under the readonly profile.
 *
 * bun test is broken repo-wide; runnable harness:
 * Run: bun run example/get-displays.integration.test.ts
 */
type Rpc = { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } };
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

const readonly = connect('readonly');
try {
  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'disp', version: '1' } });

  const displays = textOf(await readonly.call('tools/call', { name: 'get_displays', arguments: {} }));
  console.log(`  get_displays → ${JSON.stringify(displays)}`);
  assert(/: \d+×\d+ @ \d+Hz, \d+-bit — \S/.test(displays), 'get_displays renders a monitor as "W×H @ NHz, B-bit — adapter"');
  assert(displays.split('\n').filter((line) => /\(primary\)/.test(line)).length === 1, 'exactly one display is marked (primary)');
  assert(displays.split('\n').every((line) => /\\\\\.\\/.test(line)), 'every line names a \\\\.\\DISPLAY device');

  const list = await readonly.call('tools/list', {});
  const names = ((list as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
  assert(names.includes('get_displays'), 'get_displays IS exposed under the readonly profile (category read)');
} finally {
  readonly.kill();
}

console.log(failures === 0 ? '\nPASS — get_displays reports each monitor\'s resolution / refresh / depth + primary natively (read-only).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
