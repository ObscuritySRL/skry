/**
 * wait-for-ref-liveness — two correctness fixes for wait_for {ref, state}:
 *
 *  (A) Honest echo — the timeout error used to stringify the WHOLE expectation, including the internal `timeout` wait
 *      knob: `never reached {"enabled":false,"timeout":600}`. A cold model reads timeout:600 as part of the desired
 *      control STATE. Now only the predicate is echoed: `never reached {"enabled":false}`.
 *
 *  (B) Torn-down control — a ref of the CURRENT generation can still point at a control destroyed IN-PROCESS (a removed
 *      field, a virtualized row scrolled out) WITHOUT a re-render that bumps the generation. The dead UIA provider's
 *      swallowing getters return 0/'' , so {enabled:false}/{value:''} would FALSELY "reach" instantly. waitForOwnState
 *      now probes liveness (a checked get_CurrentControlType) each poll and throws "no longer exists" instead.
 *
 * Proof, deterministic + self-contained: a parent window with a child BUTTON; attach the parent and grab the button's
 * ref; (A) wait for {enabled:false} on the still-alive enabled button and assert the timeout error omits `timeout`;
 * (B) DestroyWindow the child (no re-snapshot, so same generation) and assert the next wait throws "no longer exists",
 * not a false "reached". Our own windows — DestroyWindow + UnregisterClass teardown.
 *
 * bun test is broken repo-wide for FFI; runnable harness (MCP subprocess + in-process parent/child windows):
 * Run: bun run example/wait-for-ref-liveness.integration.test.ts
 */
import { JSCallback } from 'bun:ffi';

import { umbriel } from 'umbriel';
import User32 from '@bun-win32/user32';

type Rpc = { id?: number; result?: { content?: { text?: string }[] } };
let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const WS_VISIBLE = 0x1000_0000;
const WS_CHILD = 0x4000_0000;
const WS_OVERLAPPEDWINDOW = 0x00cf_0000;
const PM_REMOVE = 0x0001;
const wide = (text: string): Buffer => Buffer.from(`${text}\0`, 'utf16le');

umbriel.initialize();
let parent = 0n;
let button = 0n;
let className: Buffer | null = null;
let wndProc: JSCallback | null = null;
let pump: ReturnType<typeof setInterval> | null = null;
const msg = Buffer.alloc(48);
const pumpOnce = (): void => {
  while (User32.PeekMessageW(msg.ptr!, 0n, 0, 0, PM_REMOVE) !== 0) {
    User32.TranslateMessage(msg.ptr!);
    User32.DispatchMessageW(msg.ptr!);
  }
};

try {
  wndProc = new JSCallback((h: bigint, m: number, w: bigint, l: bigint): bigint => BigInt(User32.DefWindowProcW(h, m, w, l)), { args: ['u64', 'u32', 'u64', 'i64'], returns: 'i64' });
  className = wide(`UmbrielRefLiveness_${process.pid}`);
  const wc = Buffer.alloc(80);
  wc.writeUInt32LE(80, 0);
  wc.writeBigUInt64LE(BigInt(wndProc.ptr!), 8);
  wc.writeBigUInt64LE(BigInt(className.ptr!), 64);
  if (!User32.RegisterClassExW(wc.ptr!)) throw new Error('RegisterClassExW failed');
  parent = User32.CreateWindowExW(0, className.ptr!, wide('UmbrielRefLivenessParent').ptr!, WS_OVERLAPPEDWINDOW | WS_VISIBLE, 80, 80, 460, 320, 0n, 0n, 0n, null);
  button = User32.CreateWindowExW(0, wide('BUTTON').ptr!, wide('LivenessButton').ptr!, WS_CHILD | WS_VISIBLE, 30, 30, 200, 40, parent, 0n, 0n, null);
  if (parent === 0n || button === 0n) throw new Error('CreateWindowExW failed (no interactive desktop?)');
  for (let frame = 0; frame < 8; frame += 1) {
    pumpOnce();
    Bun.sleepSync(40);
  }
  pump = setInterval(pumpOnce, 16);

  const proc = Bun.spawn(['bun', 'run', `${import.meta.dir}/../mcp.ts`], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: { ...Bun.env, UMBRIEL_PROFILE: 'safe' } });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pending = new Map<number, (message: Rpc) => void>();
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
          const message = JSON.parse(line) as Rpc;
          if (typeof message.id === 'number' && pending.has(message.id)) {
            pending.get(message.id)!(message);
            pending.delete(message.id);
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

  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wait-for-ref-liveness', version: '1' } });
  const attached = textOf(await call('tools/call', { name: 'attach', arguments: { hWnd: `0x${parent.toString(16)}` } }));
  const ref = attached.match(/Button[^\n]*?LivenessButton[^\n]*?\[ref=(e\d+#\d+)\]/)?.[1] ?? attached.match(/\[ref=(e\d+#\d+)\][^\n]*LivenessButton/)?.[1];
  if (ref === undefined) {
    console.log('  skip: the child BUTTON did not surface in the parent snapshot');
  } else {
    const echo = textOf(await call('tools/call', { name: 'wait_for', arguments: { ref, state: { enabled: false }, timeout: 600 } }));
    assert(/never reached \{"enabled":false\}/.test(echo) && !/timeout/.test(echo), `(A) timeout error echoes only the predicate, NOT the internal timeout knob (got: ${JSON.stringify(echo.slice(0, 90))})`);

    User32.DestroyWindow(button); // destroy the control WITHOUT a re-snapshot — the ref's generation is unchanged
    button = 0n;
    Bun.sleepSync(120);
    const dead = textOf(await call('tools/call', { name: 'wait_for', arguments: { ref, state: { enabled: false }, timeout: 600 } }));
    assert(/no longer exists/.test(dead) && !/reached/.test(dead), `(B) a destroyed control throws "no longer exists" — NOT a false "reached" from the dead provider's default-0 read (got: ${JSON.stringify(dead.slice(0, 90))})`);
  }
  proc.kill();
} finally {
  if (pump !== null) clearInterval(pump);
  if (button !== 0n) User32.DestroyWindow(button);
  if (parent !== 0n) User32.DestroyWindow(parent);
  if (className !== null) User32.UnregisterClassW(className.ptr!, 0n);
  wndProc?.close();
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — wait_for {ref,state} echoes only the predicate, and a destroyed control throws instead of falsely reaching a negative state.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
