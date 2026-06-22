/**
 * list-modules — the list_modules tool / umbriel.listModules(pid): enumerate a process's loaded modules (its .exe +
 * every DLL) the way Process Explorer's "DLLs" pane does, via K32EnumProcessModulesEx + K32GetModuleBaseNameW /
 * K32GetModuleFileNameExW / K32GetModuleInformation over an OpenProcess(QUERY_LIMITED_INFORMATION | VM_READ) handle.
 * Single-pass (the binding types lphModule LPVOID with no | NULL, so a NULL sizing pass won't type-check), bounded at
 * MAX_MODULES, CloseHandle in finally (the enumerated HMODULEs are pseudo-handles — never closed).
 *
 * Proof (live, no window spawned — always-present processes): (1) self (this bun process) enumerates its own
 * modules with kernel32.dll carrying a real on-disk path, non-zero mapped size, and hex base address — proves the
 * FFI + MODULEINFO decode; (2) explorer.exe (a real CROSS-process target, found via list_processes) enumerates a
 * large module table — proves OpenProcess across processes works. Negative: listModules(4) (the System process)
 * returns [] with no crash (graceful deny — OpenProcess === 0n).
 *
 * APIs demonstrated:
 * - umbriel.listModules (K32EnumProcessModulesEx + per-module base name / file path / MODULEINFO size)
 * - umbriel.listProcesses (to find the explorer.exe pid)
 *
 * bun test is broken repo-wide for FFI — runnable harness (no window — pure introspection):
 * Run: bun run example/list-modules.integration.test.ts
 */
import { listModules, umbriel } from 'umbriel';

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
  // (1) self — proves the FFI path + MODULEINFO decode without any cross-process permission question.
  const self = listModules(process.pid);
  console.log(`  self (pid ${process.pid}): ${self.length} modules`);
  assert(self.length > 5, `listModules(self) enumerates this process's modules (${self.length} > 5)`);
  const kernel32 = self.find((module) => module.baseName.toLowerCase() === 'kernel32.dll');
  assert(kernel32 !== undefined, 'kernel32.dll is present in the self module list');
  if (kernel32 !== undefined) {
    console.log(`  sample: ${kernel32.baseName} ${kernel32.baseAddress} ${Math.round(kernel32.sizeBytes / 1024)}KB ${kernel32.filePath}`);
    assert(/\\kernel32\.dll$/i.test(kernel32.filePath) && kernel32.sizeBytes > 0 && /^0x[0-9a-f]+$/.test(kernel32.baseAddress), 'kernel32.dll carries a real path, mapped size, and hex base address');
  }

  // (2) explorer.exe — a real CROSS-process target (always running on an interactive desktop).
  const explorer = umbriel.listProcesses().find((entry) => entry.name.toLowerCase() === 'explorer.exe');
  if (explorer === undefined) console.log('  skip: explorer.exe not running (headless session?) — cross-process proof skipped');
  else {
    const modules = listModules(explorer.processId);
    console.log(`  explorer.exe (pid ${explorer.processId}): ${modules.length} modules`);
    assert(modules.length > 50, `cross-process listModules(explorer) enumerates the full table (${modules.length} > 50)`);
    assert(modules.some((module) => module.baseName.toLowerCase() === 'kernel32.dll'), 'explorer.exe loads kernel32.dll (cross-process read works)');
  }

  // negative — the System process is protected; the handle is denied and we degrade to [] without crashing.
  assert(listModules(4).length === 0, 'listModules(4) (the System process) returns [] — graceful deny, no crash');
} finally {
  umbriel.uninitialize();
}

console.log(failures === 0 ? '\nPASS — list_modules enumerates a process\'s loaded DLLs (the Process Explorer "DLLs" view).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
