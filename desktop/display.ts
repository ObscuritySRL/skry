// Display configuration via User32 — enumerate each attached monitor's adapter, resolution, refresh rate, and color
// depth, and which is primary, natively (no WMI/PowerShell). Read-only. EnumDisplayDevicesW walks the adapters;
// EnumDisplaySettingsW(ENUM_CURRENT_SETTINGS) reads the live DEVMODEW mode. Complements umbriel's capture + window
// placement (coordinate scaling, "does this window fit on its monitor", which output to screenshot).

import User32 from '@bun-win32/user32';

const ENUM_CURRENT_SETTINGS = 0xffff_ffff;
const DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x0001;
const DISPLAY_DEVICE_PRIMARY_DEVICE = 0x0004;
const DISPLAY_DEVICE_SIZE = 840; // DISPLAY_DEVICEW: cb@0, DeviceName@4 (32 WCHAR), DeviceString@68 (128 WCHAR), StateFlags@324, DeviceID@328, DeviceKey@584
const DEVMODE_SIZE = 220; // DEVMODEW; dmSize@68; display fields dmBitsPerPel@168, dmPelsWidth@172, dmPelsHeight@176, dmDisplayFrequency@184

export interface DisplayInfo {
  device: string; // e.g. \\.\DISPLAY1
  adapter: string; // e.g. NVIDIA GeForce RTX 4090
  primary: boolean;
  width: number;
  height: number;
  refreshHz: number;
  bitsPerPixel: number;
}

/** Every monitor attached to the desktop: device + adapter name, current resolution / refresh / color depth, and which
 *  is primary. [] if none enumerable. Read-only — EnumDisplayDevicesW walks the adapters; EnumDisplaySettingsW reads
 *  each one's live mode. */
export function getDisplays(): DisplayInfo[] {
  const displays: DisplayInfo[] = [];
  for (let index = 0; ; index += 1) {
    const device = Buffer.alloc(DISPLAY_DEVICE_SIZE);
    device.writeUInt32LE(DISPLAY_DEVICE_SIZE, 0); // cb — required before EnumDisplayDevicesW
    if (User32.EnumDisplayDevicesW(null, index, device.ptr!, 0) === 0) break;
    const stateFlags = device.readUInt32LE(324);
    if ((stateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) === 0) continue; // skip detached / mirroring pseudo-devices
    const deviceName = device.toString('utf16le', 4, 68).split('\0')[0] ?? '';
    const adapter = device.toString('utf16le', 68, 324).split('\0')[0] ?? '';
    const devmode = Buffer.alloc(DEVMODE_SIZE);
    devmode.writeUInt16LE(DEVMODE_SIZE, 68); // dmSize — required before EnumDisplaySettingsW
    const nameWide = Buffer.from(`${deviceName}\0`, 'utf16le');
    if (User32.EnumDisplaySettingsW(nameWide.ptr!, ENUM_CURRENT_SETTINGS, devmode.ptr!) === 0) continue;
    displays.push({
      device: deviceName,
      adapter,
      primary: (stateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) !== 0,
      bitsPerPixel: devmode.readUInt32LE(168),
      width: devmode.readUInt32LE(172),
      height: devmode.readUInt32LE(176),
      refreshHz: devmode.readUInt32LE(184),
    });
  }
  return displays;
}

// ChangeDisplaySettingsExW write path (wingdi.h DM_*/DMDO_*, winuser.h CDS_*/DISP_CHANGE_*). Offsets confirmed vs the
// active _devicemodeW union branch (dmPosition POINTL@76, then dmDisplayOrientation@84) and live (orientation read 0).
const DM_PELSWIDTH = 0x0008_0000;
const DM_PELSHEIGHT = 0x0010_0000;
const DM_DISPLAYFREQUENCY = 0x0040_0000;
const DM_DISPLAYORIENTATION = 0x0000_0080;
const CDS_UPDATEREGISTRY = 0x0000_0001;
const CDS_TEST = 0x0000_0002;
const DISP_CHANGE_SUCCESSFUL = 0;
const DISP_CHANGE_RESTART = 1;
const DISP_CHANGE_NAMES: Record<number, string> = { 0: 'DISP_CHANGE_SUCCESSFUL', 1: 'DISP_CHANGE_RESTART', [-1]: 'DISP_CHANGE_FAILED', [-2]: 'DISP_CHANGE_BADMODE (the adapter/monitor does not support this mode)', [-3]: 'DISP_CHANGE_NOTUPDATED', [-4]: 'DISP_CHANGE_BADFLAGS', [-5]: 'DISP_CHANGE_BADPARAM', [-6]: 'DISP_CHANGE_BADDUALVIEW' };

export interface DisplayMode {
  width?: number;
  height?: number;
  orientation?: number; // degrees: 0 | 90 | 180 | 270 (mapped to DMDO_DEFAULT/90/180/270)
  refreshHz?: number;
  persist?: boolean; // false (default) = apply dynamically (Windows auto-reverts a bad mode); true = persist to the registry
}

/** Change a monitor's mode (resolution / orientation / refresh) natively via ChangeDisplaySettingsExW — the symmetric
 *  WRITE half of getDisplays, focus-free + BG-default (no Settings UI). `device` is a getDisplays device name (\\.\DISPLAYn).
 *  Seeds the CURRENT mode (EnumDisplaySettingsW) and ORs the changed members' bits onto the live dmFields, so unspecified
 *  fields keep their current values. VALIDATES with CDS_TEST first; only a valid mode is applied — dynamically (so
 *  Windows' confirm-timeout auto-reverts a bad confirmless mode) or, with {persist}, written to the registry. Returns
 *  ok=false (nothing changed) when the device is unknown or the mode is rejected at validation. */
export function setDisplay(device: string, mode: DisplayMode): { ok: boolean; message: string } {
  const deviceWide = Buffer.from(`${device}\0`, 'utf16le');
  const devmode = Buffer.alloc(DEVMODE_SIZE);
  devmode.writeUInt16LE(DEVMODE_SIZE, 68); // dmSize — required before EnumDisplaySettingsW
  if (User32.EnumDisplaySettingsW(deviceWide.ptr!, ENUM_CURRENT_SETTINGS, devmode.ptr!) === 0) return { ok: false, message: `unknown or unconfigurable device "${device}" (use a get_displays device name)` };
  let fields = devmode.readUInt32LE(72); // keep the live dmFields — OR the changed bits on (ChangeDisplaySettingsEx reads only flagged members)
  if (mode.width !== undefined) {
    devmode.writeUInt32LE(mode.width, 172);
    fields |= DM_PELSWIDTH;
  }
  if (mode.height !== undefined) {
    devmode.writeUInt32LE(mode.height, 176);
    fields |= DM_PELSHEIGHT;
  }
  if (mode.refreshHz !== undefined) {
    devmode.writeUInt32LE(mode.refreshHz, 184);
    fields |= DM_DISPLAYFREQUENCY;
  }
  if (mode.orientation !== undefined) {
    devmode.writeUInt32LE(mode.orientation === 90 ? 1 : mode.orientation === 180 ? 2 : mode.orientation === 270 ? 3 : 0, 84); // DMDO_DEFAULT 0 / 90 1 / 180 2 / 270 3
    fields |= DM_DISPLAYORIENTATION;
  }
  devmode.writeUInt32LE(fields, 72);
  const tested = User32.ChangeDisplaySettingsExW(deviceWide.ptr!, devmode.ptr!, 0n, CDS_TEST, null); // validate WITHOUT applying first — no black screen on a bad mode
  if (tested !== DISP_CHANGE_SUCCESSFUL) return { ok: false, message: `mode rejected at validation: ${DISP_CHANGE_NAMES[tested] ?? `code ${tested}`} — nothing changed` };
  const applied = User32.ChangeDisplaySettingsExW(deviceWide.ptr!, devmode.ptr!, 0n, mode.persist === true ? CDS_UPDATEREGISTRY : 0, null);
  if (applied === DISP_CHANGE_SUCCESSFUL) return { ok: true, message: `applied${mode.persist === true ? ' (persisted to the registry)' : ' (dynamic — not persisted; reverts on logoff/reboot)'}` };
  if (applied === DISP_CHANGE_RESTART) return { ok: true, message: 'applied — a restart is required to take full effect' };
  return { ok: false, message: `validated but apply returned ${DISP_CHANGE_NAMES[applied] ?? `code ${applied}`}` };
}
