/**
 * owned-window — a `using` declaration that CLOSES a launched app (OwnedWindow + launchOwned).
 *
 * launchOwned() returns an OwnedWindow whose [Symbol.dispose] PostMessage-closes the launched window (WM_CLOSE)
 * and then releases the COM element ref — so `using owned = await umbriel.launchOwned(...)` cleans up a spawned
 * app at scope exit with no try/finally. Plain launch()/attach() Windows are UNCHANGED: their dispose() releases
 * the COM ref only and NEVER closes the window (the dispose() != close() invariant). Proves the launched window
 * is open while the binding is in scope and actually gone after the block.
 *
 * APIs demonstrated:
 *  - umbriel.launchOwned(argv, target)
 *  - OwnedWindow[Symbol.dispose] via `using` -> closeWindow + release
 *  - isWindow (liveness probe)
 *
 * bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/owned-window.integration.test.ts
 */
import { closeWindow, isWindow, umbriel } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
let hWnd = 0n;
try {
  {
    using calc = await umbriel.launchOwned(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });
    hWnd = calc.hWnd;
    assert(isWindow(hWnd), 'the launched window is open while the `using` binding is in scope');
  }
  // scope exit -> OwnedWindow[Symbol.dispose] -> closeWindow(hWnd) + release()
  let closed = false;
  for (let i = 0; i < 60; i += 1) {
    if (!isWindow(hWnd)) {
      closed = true;
      break;
    }
    await Bun.sleep(100);
  }
  assert(closed, 'WM_CLOSE actually closed the launched app at scope exit (not just released the COM ref)');
} finally {
  if (hWnd !== 0n && isWindow(hWnd)) closeWindow(hWnd); // safety net if OwnedWindow disposal is broken — never leak Calculator
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — launchOwned + OwnedWindow[Symbol.dispose] closes the launched window via `using`.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
