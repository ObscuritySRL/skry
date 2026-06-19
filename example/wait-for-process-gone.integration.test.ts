/**
 * wait-for-process-gone — wait_for_process gained a {gone} edge. Before, every wait tool had a "negative" edge
 * EXCEPT process exit: wait_for {gone}, wait_for_window {gone} both wait for a thing to DISAPPEAR, but
 * wait_for_process only waited for a process to APPEAR. So "wait until this installer/build/conversion/launched-app
 * FINISHES" forced a hand-rolled poll over list_processes (a full toolhelp32 enumeration of 400+ processes) each
 * tick — and wait_for_window {gone} is NOT a substitute: a windowless process owns no visible window, so it resolves
 * IMMEDIATELY (a false "done"). waitForProcessGone re-polls the toolhelp snapshot (listProcesses) each tick — image-name
 * presence is observable across EVERY integrity level, so it honestly confirms an elevated/protected job (an installer)
 * is gone where an OpenProcess(SYNCHRONIZE) handle gets ACCESS_DENIED — and it excludes the host's own pid.
 *
 * Proof, fully self-contained (spawns a windowless ~3s `ping -n 4`, which exits on its own — nothing to close):
 *   (1) waitForWindowGone on the windowless process returns ≈immediately — the false-positive being fixed;
 *   (2) waitForProcessGone BLOCKS until ping actually exits (waited > 1.5s);
 *   (3) once gone, a second waitForProcessGone returns ≈immediately.
 * Use a SPECIFIC image name ("ping.exe", not "ping") — the needle is a substring match (so "ping" also matches
 * "SnippingTool.exe"), exactly like wait_for_process / list_processes.
 *
 * bun test is broken repo-wide — runnable harness:
 * Run: bun run example/wait-for-process-gone.integration.test.ts
 */
import { umbriel, waitForProcessGone, waitForWindowGone } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
try {
  const child = Bun.spawn(['C:\\Windows\\System32\\PING.EXE', '-n', '4', '127.0.0.1'], { stdout: 'ignore', stderr: 'ignore' });
  await Bun.sleep(400); // let it register in the process table

  const windowGoneStart = Bun.nanoseconds();
  await waitForWindowGone({ title: 'PING.EXE' }, { timeout: 8000 }).catch(() => {});
  const windowGoneMs = (Bun.nanoseconds() - windowGoneStart) / 1e6;
  assert(windowGoneMs < 500, `waitForWindowGone returns ≈immediately for a windowless process (the false "done" being fixed) — ${Math.round(windowGoneMs)}ms`);

  const goneStart = Bun.nanoseconds();
  await waitForProcessGone('ping.exe', { timeout: 12000 });
  const goneMs = (Bun.nanoseconds() - goneStart) / 1e6;
  assert(goneMs > 1500, `waitForProcessGone BLOCKED until ping actually exited (waited for the real exit, not a false-immediate) — ${Math.round(goneMs)}ms`);

  const idempotentStart = Bun.nanoseconds();
  await waitForProcessGone('ping.exe', { timeout: 5000 });
  const idempotentMs = (Bun.nanoseconds() - idempotentStart) / 1e6;
  assert(idempotentMs < 800, `waitForProcessGone returns ≈immediately when nothing matches is running — ${Math.round(idempotentMs)}ms`);

  // (4) An ELEVATED/protected process (lsass.exe — always running, ACCESS_DENIED to OpenProcess from a medium-integrity
  // host) must NOT be falsely reported "gone". The original handle approach treated access-denied (OpenProcess→0n) as
  // exited and resolved immediately — a false success on the headline installer use case. The toolhelp poll sees it
  // still listed across integrity levels and keeps waiting (times out) instead of lying.
  let falselyGone = false;
  try {
    await waitForProcessGone('lsass.exe', { timeout: 1000 });
    falselyGone = true; // resolved = WRONG (lsass is still running, just unopenable)
  } catch {
    // timed out = correct (it kept waiting for a process it can see but cannot open)
  }
  assert(!falselyGone, 'a still-running ELEVATED/access-denied process (lsass.exe) is NOT falsely reported gone — it times out, the old OpenProcess-handle bug would have resolved instantly');

  void child;
} finally {
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — wait_for_process {gone} waits for a windowless process to actually exit; an elevated/access-denied process is never falsely reported gone.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
