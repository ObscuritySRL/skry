/**
 * set-display — set_display changes a monitor's mode (resolution/orientation/refresh) NATIVELY via ChangeDisplaySettingsExW
 * (User32) — the focus-free WRITE half of get_displays, no Settings UI / WMI / PowerShell. The mode is CDS_TEST-validated
 * BEFORE applying, then applied dynamically (Windows auto-reverts a bad mode); {persist} writes the registry. SECURITY:
 * os-gated AND requires {confirm:true}.
 *
 * Proof (SAFE — leaves no display changed): re-applying the CURRENT mode is a no-op that exercises the full validate+apply
 * FFI path with ZERO net change (the display config is identical before/after); an absurd 1x1 mode is REJECTED at
 * validation (DISP_CHANGE_BADMODE) so nothing changes; an unknown device errors cleanly; a write WITHOUT confirm is
 * refused; and set_display is os-gated (absent from the safe profile).
 *
 * Run: bun run example/set-display.integration.test.ts
 */
import { getDisplays, setDisplay } from 'umbriel';

import { assert, finish, skip, spawnServer } from './_harness';

const server = spawnServer({ UMBRIEL_PROFILE: 'full' });
try {
  await server.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'set-display', version: '1' } });

  const before = getDisplays();
  const primary = before.find((display) => display.primary) ?? before[0];
  if (primary === undefined) {
    skip('no display enumerable on this host');
  } else {
    // No-op apply of the CURRENT mode: exercises the validate + apply path with zero net visual change.
    const sameMode = setDisplay(primary.device, { width: primary.width, height: primary.height, refreshHz: primary.refreshHz });
    console.log(`  setDisplay(${primary.device}, current ${primary.width}x${primary.height}@${primary.refreshHz}) → ${JSON.stringify(sameMode)}`);
    assert(sameMode.ok, 'setDisplay re-applying the CURRENT mode succeeds (full validate + apply path)');
    const afterSame = getDisplays();
    const unchanged = afterSame.length === before.length && afterSame.every((display, index) => display.device === before[index].device && display.width === before[index].width && display.height === before[index].height && display.refreshHz === before[index].refreshHz);
    assert(unchanged, 'the display config is IDENTICAL after the no-op apply (no mode actually changed)');

    // An unsupported mode is REJECTED at CDS_TEST validation — nothing is applied (no black screen).
    const bad = setDisplay(primary.device, { width: 1, height: 1 });
    console.log(`  setDisplay(${primary.device}, 1x1) → ${JSON.stringify(bad)}`);
    assert(!bad.ok && /rejected at validation|BADMODE/.test(bad.message), 'an unsupported 1x1 mode is rejected at validation (CDS_TEST) — nothing changes');
    assert(getDisplays().find((display) => display.device === primary.device)?.width === primary.width, 'the rejected mode left the resolution unchanged');

    // Unknown device → clean error, no crash.
    const unknown = setDisplay('\\\\.\\NO_SUCH_DISPLAY', { width: 1920, height: 1080 });
    assert(!unknown.ok && /unknown or unconfigurable/.test(unknown.message), 'an unknown device errors cleanly (no crash)');
  }

  // confirm gate over the wire
  const noConfirm = await server.call('tools/call', { name: 'set_display', arguments: { device: primary?.device ?? '\\\\.\\DISPLAY1', width: 1920, height: 1080 } });
  assert(noConfirm.result?.isError === true && /confirm:true/.test(server.textOf(noConfirm)), 'set_display WITHOUT {confirm:true} is refused (safety gate)');

  // os-gating
  const safe = spawnServer({ UMBRIEL_PROFILE: 'safe' });
  try {
    await safe.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'set-display', version: '1' } });
    const list = await safe.call('tools/list', {});
    const names = (list.result?.tools ?? []).map((tool) => tool.name);
    assert(!names.includes('set_display'), 'set_display is NOT exposed under the safe profile (os-gated)');
  } finally {
    safe.kill();
  }
} finally {
  server.kill();
}

finish('PASS — set_display changes a monitor mode via ChangeDisplaySettingsEx (CDS_TEST-validated, confirm + os gated); proven safely with a no-op current-mode apply and a rejected bad mode.');
