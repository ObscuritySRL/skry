<div align="center">

<img src="./assets/hero.png" alt="Umbriel" width="100%" />

# Umbriel · A set of hands for your AI agent — and Playwright for the Windows desktop

Drive any Windows app through four layers: fall back to OCR and pixel-matching when there's no other way in, see and manage windows even when they're hidden, send cursor-free synthetic input, and target controls by name and role. Built by Claude, for Claude — but any AI agent over MCP can use it.

[![npm](https://img.shields.io/npm/v/umbriel?color=8b5cf6&label=umbriel)](https://www.npmjs.com/package/umbriel)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)](#requirements)
[![runtime](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.1-black)](https://bun.sh)
[![deps](https://img.shields.io/badge/native%20deps-zero-22c55e)](#why-umbriel)

</div>

## What is it?

Umbriel drives the Windows desktop the way a person would — through whatever channel actually works for the app in front of it:

1. **Pixels & OCR** — when an app exposes no tree at all (canvas, custom-draw, games), fall back to full-screen capture, template matching, and text recognition.
2. **Semantic control** — read the UI Automation tree an app exposes and target controls by *name* and *role*, not coordinates. Survives the DPI, layout, and theme changes that shatter pixel scripts.
3. **Sight & window control** — capture the *live* pixels of any window (even fully GPU-composited or occluded), inspect raw HWND hierarchies, and move, raise, or size windows.
4. **Synthetic input** — cursor-free clicks, keystrokes, and text that land on background, locked, minimized, or occluded windows without stealing focus.

Underneath it's a few kilobytes of TypeScript on Bun's built-in FFI — no Appium server, no `.NET`, no `node-gyp`, no prebuilt binaries.

## Install

```bash
bun add umbriel
```

That's the entire install story. No build step, nothing to compile.

## Built for AI agents

This is what Umbriel is *for*. Hand the whole desktop to an agent with one line:

```bash
claude mcp add umbriel -- bunx umbriel
```

Any MCP-speaking agent then drives Windows cursor-free, ~15 ms per step, even on a background, locked, minimized, or occluded window. No mouse hijacking, no screenshots required. It was built by Claude, for Claude, but nothing about it is Claude-specific — any AI over MCP works.

Why it's fast where screenshot agents are slow: frontier computer-use agents ground their actions in screenshots, which the research calls fragile, slow, and token-hungry. Microsoft's UFO2 and the OSWorld-Human benchmark both point to the same fix — read the structure first, vision second. But building that structured snapshot the usual way takes 3–26 seconds and thousands of tokens per step. Umbriel serves it fast and in-process:

```ts
umbriel.tree(app, { agentProfile: true });
// → one cached round-trip → { role, name, automationId, bounds, children }
```

| Operation | Result |
| --- | --- |
| Agent-grounding snapshot build | ~13 ms · ~2.95k tokens |
| Single property read (cross-process) | ~58 µs |
| vs. OSWorld snapshot build (3–26 s) | ~230–2000× faster |

<sub>Measured on Windows 11, Bun 1.4 — reproduce with `bun run example/benchmark.ts`.</sub>

The MCP server exposes snapshot-first tools behind a deployer policy you control:

```bash
UMBRIEL_PROFILE=readonly   # observe only
UMBRIEL_PROFILE=safe       # default — observe + cursor-free control + window management
UMBRIEL_PROFILE=full       # everything, including launch/run/file tools
```

`desktop_snapshot` returns a ref-keyed view — `Button "Five" [ref=e49#3]` — and every action replies with the smallest faithful update: a compact delta when little changed, a pruned snapshot when more did. The model re-grounds without drowning in tokens.

## Use it from your code

Umbriel is also a first-class library for E2E tests and desktop automation — find by name → wait → act → assert, just like `getByRole` on the web:

```ts
import { ControlType, umbriel } from 'umbriel';

const app  = await umbriel.launch(['notepad.exe'], { className: 'Notepad' });
const edit = await app.waitFor({ controlType: ControlType.Document });

edit.focus().type('nothing native compiles, and it just works');
console.log(edit.text()); // → nothing native compiles, and it just works
```

```ts
// Drive Calculator to 5 + 3 = 8 — by name, not pixels:
const calc = await umbriel.launch(['cmd', '/c', 'start', 'calc'], { title: 'Calculator' });

for (const name of ['Five', 'Plus', 'Three', 'Equals'])
  calc.find({ controlType: ControlType.Button, name })?.invoke();

console.log(calc.find({ automationId: 'CalculatorResults' })?.name); // → "Display is 8"
```

## Why Umbriel?

The Windows desktop-automation corner of npm is a minefield of native-addon build failures, paywalls, and abandoned daemons. There has been no zero-install, typed, in-process Windows-automation client for Node or Bun — until this.

Because Umbriel is plain TypeScript over Bun's own FFI, it:

- **Can't be paywalled** — there's no compiled binary to gate behind a subscription registry.
- **Has no build step** — no ABI matrix, no `MSVC` or Python toolchain, no `node-gyp`.
- **Talks to Windows in-process** — no `127.0.0.1:4723` round-trip, no Appium daemon, no Developer Mode, no `WinAppDriver`.

<details>
<summary><b>How the alternatives compare</b> (npm weekly downloads, week of 2026-06-05)</summary>

| Tool | Weekly dl | The catch |
| --- | --- | --- |
| FlaUI / pywinauto / AutoIt | n/a | A whole foreign runtime (`.NET` / Python / bespoke EXE) to install and ship. |
| `@bright-fish/node-ui-automation` | 33 | The only real npm UIA wrapper — dead since 2022. |
| `@nut-tree-fork/nut-js` | 32,360 | Fork of a now-paywalled original. Pixel/image-match only — no semantic model. |
| `appium-windows-driver` | 30,749 | Needs an Appium server plus a separate `WinAppDriver.exe` Microsoft hasn't maintained in years. |
| `robotjs` / `@jitsi/robotjs` | 11,375 / 15,333 | `node-gyp` C++ compile — the #1 documented install failure. Blind pixels + keystrokes, no element model. |
| `uiohook-napi` | 21,965 | Healthy, but global hooks run on a foreign thread and can segfault. |

</details>

## Highlights

🌐 **Reach into Chromium & Electron** — read and drive the in-page web DOM of Chrome, Edge, and every Electron app (Discord, Slack, Spotify, VS Code) as real semantic elements, not pixels — through the same `find` / `invoke` / `waitFor` API as any native control.

📋 **Clipboard done right** — reliable large-text paste with no per-keystroke corruption, plus copy-and-read from any app.

🌑 **Drive in the dark** — `invoke`, `scroll`, `setValue`, and `toggle` move no real cursor and work on windows that are hidden, minimized, occluded, or on a locked session. No focus theft.

🖼️ **Pixel & OCR fallback** — coordinate clicks, full-screen capture, template matching, and text recognition for canvases and games with nothing else to grab onto.

🔎 **Reads everything** — MSAA trees for legacy windows, bounding boxes, data-grid cells, enabled/checked state, native HWND hierarchies (Spy++ style), text, and values.

🌍 **Real Unicode input** — Japanese, Korean, accented Latin, and emoji round-trip correctly through three independent input paths. Proven by a regression test, not promised.

👁️ **See the unseen** — capture the *live* pixels of a window even when it's fully GPU-composited or occluded (Chromium, Edge, Electron, games) via `Windows.Graphics.Capture` — the same surface Alt+Tab previews use.

🎯 **Semantic targeting** — find controls by `automationId`, name, or role. Exact matches are filtered inside the target app for speed; regex and substring match on your side.

🧩 **Works across the stack** — Electron/Chromium, Java, Qt (KDE, OBS, Telegram, VLC), WPF, Win32, WinForms, and WinUI/UWP — each pinned by its own regression test.

⏳ **`waitFor`, the Playwright way** — auto-retry for flaky native UIs, with timeouts that quote the nearest candidates and your selector. No other Windows-desktop npm tool has it.

## Requirements

- **Semantic first, pixels where there's no structure** — custom-draw, games, and WebGL surfaces fall back to the built-in pixel + OCR layer; everything with a tree gets exact semantic targeting.
- **Synthetic typing and real clicks need an unlocked desktop** — `invoke`, reads, and `setValue` work even on a locked session, so prefer them.
- **Windows 10 or 11, Bun ≥ 1.1** — Windows-only and Bun-only, the owned trade-off for zero dependencies and in-process speed.

## Going deeper

The complete API surface lives in [AI.md](./AI.md) — written so thoroughly that an agent (or a developer) never needs to read the source. Runnable demos are in [`example/`](./example).

---

<div align="center">

MIT Licensed · Built on [`bun:ffi`](https://bun.sh/docs/api/ffi) with zero native dependencies

</div>
