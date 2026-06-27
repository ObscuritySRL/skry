/**
 * Discord / Chromium cross-process UIA invoke-path segfault — repro harness
 *
 * Description:
 *   Reproduces (or rules out) the Bun-FFI segfault reported when `find_and_act {do:"invoke"}` targets a
 *   Discord (Electron/Chromium) Hyperlink. Mirrors the MCP find_and_act selector→invoke path against the
 *   LIVE Discord window in a tight loop, compressing the ~89s of sporadic agent calls that preceded the
 *   reported crash into thousands of iterations:
 *       findAll({controlType: Hyperlink})  →  per-match cross-process property reads + InvokePattern
 *       acquire/release (the first half of Element.invoke())  →  release.
 *   Non-destructive by DEFAULT (it does NOT call Invoke, so it never navigates the user's live Discord).
 *   Pass --invoke to additionally fire the real InvokePattern (destructive — only for a throwaway target).
 *
 *   The try/catch distinguishes the two use-after-free signatures:
 *     • a CATCHABLE com.ts vcall guard throw ("null vtable … use-after-free") ⇒ proxy freed-but-ZEROED;
 *     • a hard process exit (code 3, "Segmentation fault") ⇒ freed-and-REUSED memory or a Bun-FFI fault —
 *       i.e. the reported uncatchable crash.
 *
 * APIs demonstrated:
 *   - umbriel.attach / Window.findAll / Element.release / Window.webRoots
 *   - vcall(GetCurrentPattern) + comRelease (raw InvokePattern acquire/release across the FFI/COM line)
 *
 * Run: bun run example/discord-chromium-invoke-segfault.ts [iterations] [--invoke] [--title=Discord]
 */

import { FFIType } from 'bun:ffi';

import { comRelease, vcall } from '../com/com';
import { ControlType, PatternId, S_OK, SLOT } from '../com/constants';
import type { Element } from '../element/element';
import { processImagePath } from '../element/window';
import { umbriel } from '../index';

const args = Bun.argv.slice(2);
const iterations = Number(args.find((part) => /^\d+$/.test(part)) ?? 1000);
const doInvoke = args.includes('--invoke');
const titleArg = args.find((part) => part.startsWith('--title='));
const title = titleArg !== undefined ? titleArg.slice('--title='.length) : 'Discord';

umbriel.initialize();
// Resolve robustly (FindWindowW needs an exact title; Discord's window is "@User - Discord"). Prefer a window whose
// PROCESS image matches the target (Discord.exe) so the terminal window that merely has "Discord" in its title bar is
// never picked; fall back to a title substring match excluding the terminal host class.
const windowsList = umbriel.windows({ includeUntitled: true });
const needle = title.toLowerCase();
const byProcess = windowsList.find((window) => {
  try {
    return processImagePath(window.processId).toLowerCase().includes(needle);
  } catch {
    return false;
  }
});
const byTitle = windowsList.find((window) => window.title.toLowerCase().includes(needle) && window.className !== 'CASCADIA_HOSTING_WINDOW_CLASS');
const hit = byProcess ?? byTitle;
if (hit === undefined) {
  console.log(`[repro] no window whose title contains ${JSON.stringify(title)}. Open windows:`);
  for (const window of umbriel.windows({ includeUntitled: true })) console.log(`  - 0x${window.hWnd.toString(16)} ${JSON.stringify(window.title)} [${window.className}]`);
  process.exit(2);
}
const win = umbriel.attach(hit.hWnd);
console.log(`[repro] attached to ${JSON.stringify(win.name)} hWnd=0x${win.hWnd.toString(16)} class=${win.className}`);
console.log(`[repro] iterations=${iterations} invoke=${doInvoke} bun=${Bun.version} (${Bun.revision})`);

const patternOut = Buffer.alloc(8);

// Mirror invokeSmart()/isClassicButton()'s cross-process reads + Element.invoke()'s getPattern(Invoke)
// acquisition for every Hyperlink under `scope`, hammering the exact FFI/COM boundary find_and_act uses.
function stress(scope: Element, label: string): { links: number; guardThrows: number } {
  let guardThrows = 0;
  const matches = scope.findAll({ controlType: ControlType.Hyperlink });
  for (const match of matches) {
    try {
      void match.nativeWindowHandle; // isClassicButton read #1
      void match.className; //            isClassicButton read #2
      void match.controlTypeName; //      act()'s named-result read
      void match.name; //                 act()'s named-result read
      if (vcall(match.ptr, SLOT.GetCurrentPattern, [FFIType.i32, FFIType.ptr], [PatternId.Invoke, patternOut.ptr!]) === S_OK) {
        const pattern = patternOut.readBigUInt64LE(0);
        if (pattern !== 0n) {
          if (doInvoke) vcall(pattern, SLOT.Invoke, [], []); // actually fire it — DESTRUCTIVE
          comRelease(pattern);
        }
      }
    } catch (error) {
      guardThrows += 1;
      if (guardThrows <= 3) console.log(`[repro]   caught guard throw (${label}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const match of matches) match.release();
  return { links: matches.length, guardThrows };
}

let mode: 'window' | 'webroots' = 'window';
let totalLinks = 0;
let totalGuardThrows = 0;
const start = Bun.nanoseconds();

for (let i = 0; i < iterations; i += 1) {
  let links = 0;
  let guardThrows = 0;

  if (mode === 'window') {
    const result = stress(win, 'window');
    links = result.links;
    guardThrows = result.guardThrows;
    if (i === 0 && links === 0) {
      console.log('[repro] window-scope FindAll found 0 Hyperlinks — switching to webRoots (Chromium render-widget) mode');
      mode = 'webroots';
    }
  }

  if (mode === 'webroots') {
    const roots = win.webRoots();
    for (const root of roots) {
      const result = stress(root, 'webroot');
      links += result.links;
      guardThrows += result.guardThrows;
    }
    for (const root of roots) root.release();
  }

  totalLinks += links;
  totalGuardThrows += guardThrows;
  if (i % 50 === 0 || i === iterations - 1) {
    const seconds = ((Bun.nanoseconds() - start) / 1e9).toFixed(1);
    console.log(`[repro] iter ${i}/${iterations} mode=${mode} links=${links} cumLinks=${totalLinks} guardThrows=${totalGuardThrows} elapsed=${seconds}s`);
  }
}

console.log(`[repro] SURVIVED ${iterations} iterations — ${totalLinks} cumulative link visits, ${totalGuardThrows} caught guard throws, NO segfault`);
umbriel.uninitialize();
