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
