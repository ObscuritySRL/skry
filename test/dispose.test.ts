// Explicit-resource-management (`using`) coverage for umbriel's disposable COM/native resources. Mirrors the
// native-memory-safety idempotency contract pinned for Element/Window in slot-gate.test.ts: a disposable's
// release()/[Symbol.dispose]() must zero its owned pointer so a SECOND teardown — the `using` + explicit-dispose
// double-dispose path — is a harmless no-op (comRelease(0n)), never a double-Release segfault. Window-free: uses
// only the in-process CUIAutomation client, runs under `bun test`.
import { describe, expect, spyOn, test } from 'bun:test';

import { type CacheRequest, createCacheRequest, uninitialize, watchWindows } from '../index';

describe('CacheRequest explicit resource management (no window)', () => {
  test('release() zeroes the owned pointer; a second release is a no-op, not a double-Release segfault', () => {
    try {
      const request = createCacheRequest(); // a real owned IUIAutomationCacheRequest* from the in-process COM server
      expect(request.ptr).not.toBe(0n);
      request.release();
      expect(request.ptr).toBe(0n); // the owner zeroed its raw pointer — the precondition for release-once
      expect(() => request.release()).not.toThrow(); // a SECOND release is a harmless no-op (comRelease(0n))
      expect(request.ptr).toBe(0n);
    } finally {
      uninitialize();
    }
  });

  test('[Symbol.dispose]() delegates to release() and is safe after an explicit release (the `using` + dispose path)', () => {
    try {
      const request = createCacheRequest();
      request.release();
      expect(() => request[Symbol.dispose]()).not.toThrow(); // a `using` teardown after an explicit release is a no-op
      expect(request.ptr).toBe(0n);
    } finally {
      uninitialize();
    }
  });

  test('`using request = createCacheRequest()` releases the pointer at scope exit', () => {
    try {
      let captured: CacheRequest | undefined;
      {
        using request = createCacheRequest();
        captured = request;
        expect(request.ptr).not.toBe(0n);
      }
      // scope exit invoked [Symbol.dispose]() -> release()
      expect(captured.ptr).toBe(0n);
    } finally {
      uninitialize();
    }
  });
});

describe('WindowWatcher explicit resource management', () => {
  test('`using watcher = watchWindows(...)` invokes stop() once at scope exit', () => {
    const watcher = watchWindows(() => {});
    const stop = spyOn(watcher, 'stop'); // spy calls through, so the real unhook still happens on teardown
    try {
      {
        using scoped = watcher;
        expect(scoped).toBe(watcher);
        expect(stop).not.toHaveBeenCalled(); // not stopped while the watcher is in scope
      }
      expect(stop).toHaveBeenCalledTimes(1); // scope exit -> [Symbol.dispose]() -> this.stop()
    } finally {
      watcher.stop(); // safety net — idempotent (stop() guards on `running`) if the `using` teardown already ran
    }
  });

  test('[Symbol.dispose]() delegates to the (idempotent) stop() — safe after an explicit stop', () => {
    const watcher = watchWindows(() => {});
    watcher.stop();
    expect(() => watcher[Symbol.dispose]()).not.toThrow(); // the `using` teardown after an explicit stop is a no-op
    expect(() => watcher[Symbol.dispose]()).not.toThrow();
  });
});
