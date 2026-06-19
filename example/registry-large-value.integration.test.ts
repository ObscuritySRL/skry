/**
 * registry-large-value — REGRESSION for the Panel-A finding: registryList reused one 16KB data buffer and decoded it
 * even on ERROR_MORE_DATA, where RegEnumValueW leaves the NAME buffer + lpcchValueName STALE — so any value larger than
 * the cap was emitted as the PREVIOUS value's name + 16KB of NUL padding, LOSING the real name/data (and HKLM\…\Session
 * Manager\Environment\Path is commonly > 16KB, so get_env machine would have dropped the real PATH). Fix: on MORE_DATA,
 * re-query name+type only (lpData/lpcbData = null) to recover the true name and mark the value oversized, never decode
 * the stale buffer.
 *
 * Proof: create a throwaway HKCU subkey with small + >16KB + small values, then registryList must surface ALL THREE
 * real names in order, decode the two small values, mark the big one oversized (not a corrupt duplicate). Everything is
 * created under a DELETEME subkey and removed in finally.
 *
 * Run: bun run example/registry-large-value.integration.test.ts
 */
import Advapi32, { HKEY_CURRENT_USER, RegKeyAccessRights, RegType } from '@bun-win32/advapi32';
import { registryList } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

const SUBKEY = 'umbriel_probe_largeval_DELETEME';
const subkeyWide = Buffer.from(`${SUBKEY}\0`, 'utf16le');
const setValue = (handle: bigint, name: string, value: string): void => {
  const nameWide = Buffer.from(`${name}\0`, 'utf16le');
  const dataWide = Buffer.from(`${value}\0`, 'utf16le');
  Advapi32.RegSetValueExW(handle, nameWide.ptr!, 0, RegType.REG_SZ, dataWide.ptr!, dataWide.length);
};

const created = Buffer.alloc(8);
Advapi32.RegCreateKeyExW(HKEY_CURRENT_USER, subkeyWide.ptr!, 0, null, 0, RegKeyAccessRights.KEY_SET_VALUE | RegKeyAccessRights.KEY_READ, null, created.ptr!, null);
const writeHandle = created.readBigUInt64LE(0);
try {
  setValue(writeHandle, 'alpha_small', 'hello');
  setValue(writeHandle, 'beta_big', 'X'.repeat(40_000)); // > the 16KB list cap → forces ERROR_MORE_DATA
  setValue(writeHandle, 'zeta_small', 'world');
  Advapi32.RegCloseKey(writeHandle);

  const listing = registryList('HKCU', SUBKEY);
  const values = listing?.values ?? [];
  const names = values.map((entry) => entry.name);
  console.log(`  registryList names → ${JSON.stringify(names)}`);

  assert(names.includes('alpha_small') && names.includes('beta_big') && names.includes('zeta_small'), 'all three real value names are surfaced (the >16KB value keeps its OWN name)');
  assert(names.filter((name) => name === 'alpha_small').length === 1, 'the value before the big one is NOT duplicated (no stale-name corruption)');
  assert(values.find((entry) => entry.name === 'alpha_small')?.value === 'hello' && values.find((entry) => entry.name === 'zeta_small')?.value === 'world', 'the small values decode correctly');
  const big = values.find((entry) => entry.name === 'beta_big');
  assert(typeof big?.value === 'string' && /too large to list/.test(big.value), 'the >16KB value is marked oversized (steered to registry_get), not decoded as garbage');
} finally {
  const reopen = Buffer.alloc(8);
  if (Advapi32.RegOpenKeyExW(HKEY_CURRENT_USER, subkeyWide.ptr!, 0, RegKeyAccessRights.KEY_SET_VALUE, reopen.ptr!) === 0) {
    const cleanupHandle = reopen.readBigUInt64LE(0);
    for (const name of ['alpha_small', 'beta_big', 'zeta_small']) {
      const nameWide = Buffer.from(`${name}\0`, 'utf16le');
      Advapi32.RegDeleteValueW(cleanupHandle, nameWide.ptr!);
    }
    Advapi32.RegCloseKey(cleanupHandle);
  }
  Advapi32.RegDeleteKeyW(HKEY_CURRENT_USER, subkeyWide.ptr!);
}

console.log(failures === 0 ? '\nPASS — registryList recovers the real name of a >16KB value and marks it oversized (no stale-buffer corruption).' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
