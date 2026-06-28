// Classic Win32 HMENU introspection — the menu bar that lives in the USER menu object, INVISIBLE to the UIA
// a11y tree until a human physically opens it. GetMenu/GetSubMenu/GetMenuItemCount/GetMenuStringW/
// GetMenuItemID/GetMenuState read the WHOLE menu tree cursor-free + in the BACKGROUND (no foreground, no
// open, works minimized/occluded/locked) for classic-Win32 / MFC apps (regedit, msinfo32, mmc, PuTTY, older
// Notepad) where the UIA tree shows 0 MenuItem nodes. Read-only: never DestroyMenu (the HMENU is owned by the
// window, not us). Zero new bindings — every symbol is in @bun-win32/user32.

import User32 from '@bun-win32/user32';

const MF_BYPOSITION = 0x0000_0400;
const MF_GRAYED = 0x0000_0001;
const MF_DISABLED = 0x0000_0002;
const MF_CHECKED = 0x0000_0008;
const NO_ID = 0xffff_ffff; // GetMenuItemID / GetMenuState return UINT — the documented -1 sentinel arrives as 0xFFFFFFFF, never -1
const GW_HWNDNEXT = 2;
const GW_CHILD = 5;

export interface MenuItem {
  label: string;
  /** Command id (for WM_COMMAND), or -1 for a popup, separator, or item with no command id. */
  id: number;
  enabled: boolean;
  checked: boolean;
  separator: boolean;
  /** null = not a popup; [] = a popup whose items did not read statically (owner-draw or populated on open). */
  submenu: MenuItem[] | null;
}

export interface WindowMenu {
  /** false when the window has no classic HMENU menu bar (a WinUI/UWP/ribbon app — its menu is in the UIA tree). */
  found: boolean;
  items: MenuItem[];
}

/** The text of the menu item at a position, or '' (separator / owner-draw / bitmap item). */
function itemLabel(hMenu: bigint, position: number): string {
  const buffer = Buffer.alloc(1024); // 512 WCHAR; GetMenuStringW's cchMax is inclusive of the NUL, so this holds <=511 chars + NUL exactly
  const length = User32.GetMenuStringW(hMenu, position, buffer.ptr!, 512, MF_BYPOSITION);
  return length > 0 ? buffer.subarray(0, length * 2).toString('utf16le') : '';
}

/** Recursively walk an HMENU. `visited` breaks AppendMenu cycles / DAG-shared submenus; `maxDepth` bounds nesting. */
function walkMenu(hMenu: bigint, depth: number, maxDepth: number, visited: Set<bigint>): MenuItem[] {
  const items: MenuItem[] = [];
  const count = User32.GetMenuItemCount(hMenu);
  if (count < 0) return items; // -1 => not a valid menu handle
  for (let position = 0; position < count; position += 1) {
    const rawState = User32.GetMenuState(hMenu, position, MF_BYPOSITION);
    const flags = rawState === NO_ID ? 0 : rawState & 0xff; // low byte only — a popup packs its item count into the high byte
    const submenuHandle = User32.GetSubMenu(hMenu, position);
    const isPopup = submenuHandle !== 0n;
    const rawId = User32.GetMenuItemID(hMenu, position);
    const label = itemLabel(hMenu, position);
    let submenu: MenuItem[] | null = null;
    if (isPopup) {
      if (depth < maxDepth && !visited.has(submenuHandle)) {
        visited.add(submenuHandle);
        submenu = walkMenu(submenuHandle, depth + 1, maxDepth, visited);
      } else {
        submenu = [];
      }
    }
    items.push({
      label,
      id: rawId === NO_ID ? -1 : rawId,
      enabled: (flags & (MF_GRAYED | MF_DISABLED)) === 0,
      checked: (flags & MF_CHECKED) !== 0,
      separator: !isPopup && rawId === NO_ID && label === '',
      submenu,
    });
  }
  return items;
}

/** Find the HMENU of a window's classic menu bar: GetMenu on the window, else the first descendant HWND that has
 *  one (some apps, e.g. resmon, host the menu bar on a child window). 0n if no valid classic menu exists. A bogus
 *  handle from GetMenu-on-a-child is rejected by the GetMenuItemCount > 0 guard (it returns -1 for a non-menu). */
function findMenu(hWnd: bigint, depth: number, maxDepth: number): bigint {
  const own = User32.GetMenu(hWnd);
  if (own !== 0n && User32.GetMenuItemCount(own) > 0) return own;
  if (depth >= maxDepth) return 0n;
  let child = User32.GetWindow(hWnd, GW_CHILD);
  while (child !== 0n) {
    const found = findMenu(child, depth + 1, maxDepth);
    if (found !== 0n) return found;
    child = User32.GetWindow(child, GW_HWNDNEXT);
  }
  return 0n;
}

/** Read a window's classic Win32 menu bar (HMENU) as a tree — the whole thing, cursor-free + background,
 *  including submenus the UIA tree never exposes until opened. `found:false` when there is no classic HMENU. */
export function windowMenu(hWnd: bigint, maxDepth = 12): WindowMenu {
  const hMenu = findMenu(hWnd, 0, 4);
  if (hMenu === 0n) return { found: false, items: [] };
  return { found: true, items: walkMenu(hMenu, 0, maxDepth, new Set([hMenu])) };
}

/** Render a window menu to compact indented text (separators as a rule, #id for command items, ✓/disabled state). */
export function renderMenu(menu: WindowMenu): string {
  if (!menu.found) return '(no classic HMENU menu bar — this window has none, or its menu is in the UIA tree: try desktop_snapshot, or it is a ribbon/UWP surface)';
  return menu.items.length > 0 ? renderItems(menu.items, 0) : '(empty menu)';
}

function renderItems(items: MenuItem[], depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  for (const item of items) {
    if (item.separator) {
      lines.push(`${indent}- ----`);
      continue;
    }
    const id = item.id >= 0 ? ` #${item.id}` : '';
    const checked = item.checked ? ' [x]' : '';
    const disabled = item.enabled ? '' : ' (disabled)';
    const arrow = item.submenu !== null ? (item.submenu.length > 0 ? ' >' : ' > (empty — owner-draw or populated on open)') : '';
    lines.push(`${indent}- ${JSON.stringify(item.label)}${id}${checked}${disabled}${arrow}`);
    if (item.submenu !== null && item.submenu.length > 0) lines.push(renderItems(item.submenu, depth + 1));
  }
  return lines.join('\n');
}
