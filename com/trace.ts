// Flush-before-call FFI tracer (diagnostic, opt-in). When UMBRIEL_FFI_TRACE names a file, every traced native call
// writes one line to that file and FLUSHES it to the OS *before* the call is made — so after an UNCATCHABLE crash
// (a cross-process UIA marshaling fault or a use-after-free that Bun cannot turn into a JS throw) the LAST line in the
// file names the exact call that died. Off (env unset/empty) → `ffiTraceEnabled` is false and callers skip building
// the label, so the hot path pays a single boolean branch and zero syscalls.
//
// Why this survives a segfault: the write is fs.writeSync(fd) to a file opened in append mode — a synchronous write()
// reaches the kernel page cache BEFORE the native call runs, and a process crash does not lose kernel-buffered file
// writes (the kernel owns the data once write() returns). So the trail is intact after the fault, unlike a buffered
// stream that would lose its last lines. Pair it with UMBRIEL_TRACE (per-tool JSONL) to map the crashing vcall to the
// MCP tool call that issued it.

import { openSync, writeSync } from 'node:fs';

const tracePath = Bun.env.UMBRIEL_FFI_TRACE;

/** True when UMBRIEL_FFI_TRACE is set — gate the (string-building) trace call sites on this so they cost nothing when off. */
export const ffiTraceEnabled = tracePath !== undefined && tracePath.length > 0;

let fd = -1;
let seq = 0;
if (tracePath !== undefined && tracePath.length > 0) {
  try {
    fd = openSync(tracePath, 'a');
    // Header per process so restarts (a crash-then-respawn re-fault) are delimited in one appended file.
    writeSync(fd, `# umbriel FFI trace — pid ${process.pid} — ${new Date().toISOString()}\n`);
  } catch {
    fd = -1; // a bad/locked path must NEVER break the server — tracing silently disables itself
  }
}

/**
 * Append one FLUSHED trace line immediately BEFORE the native call it labels. No-op when tracing is off or the log
 * failed to open. Keep `label` cheap and allocation-light — it runs on every traced FFI call.
 */
export function ffiTrace(label: string): void {
  if (fd < 0) return;
  seq += 1;
  try {
    writeSync(fd, `${seq} ${label}\n`);
  } catch {
    // a failed write must not perturb (or fault) the call it is tracing
  }
}

/** Mark a clean shutdown so a trailing un-paired line is unambiguously a crash, not the last successful call. */
export function ffiTraceClose(reason: string): void {
  if (fd < 0) return;
  try {
    writeSync(fd, `# clean exit: ${reason}\n`);
  } catch {
    // best-effort
  }
}
