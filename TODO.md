# TODO — owner action queue

Action items for the **owner** (not autonomous agents) — primarily **Win32 binding gaps** to
wrap or fix in **`@bun-win32`** (`D:\Projects\bun-win32`), the upstream FFI layer umbriel stands on.

Per [`AGENTS.md`](AGENTS.md): umbriel composes the installed `@bun-win32/*` bindings and never
declares new FFI symbols **when a binding already exposes them**. The one exception is a genuine
gap — a symbol/DLL **no** installed binding covers — which may be hand-rolled as a last resort
**only if it is logged here**, so the owner can wrap it upstream and the local hand-roll is later
removed.

## How to use
- A finder/fixer that must hand-roll a missing symbol, or that hits a mis-typed/blocked binding,
  appends an entry below before shipping.
- Each entry: the **DLL + symbol(s)**, **why** umbriel needs it, **status** (`GAP` = blocked or
  worked-around; `HAND-ROLLED` = declared locally, with `file:line`), and the **fix** (which
  `@bun-win32` package + the exact change).
- When you wrap/fix it upstream: bump umbriel's pinned dep, replace any local hand-roll with the
  binding, delete the entry.

## Open

### advapi32 · `EnumServicesStatusExW` · `pszGroupName` mis-typed non-nullable — `GAP` (binding fix)
- **Need:** the Ex enumerate variant carries the owning **pid per row**, so `list_services` could
  return each service's pid directly, dropping `control_service`'s per-service `QueryServiceStatusEx`
  round-trip.
- **Blocker:** `@bun-win32/advapi32` types `pszGroupName` as non-nullable `LPCWSTR` (the generator
  missed its `_In_opt_`). `NULL` is REQUIRED for "all services" — an empty string returns only
  ungrouped services (measured 252 vs 301 live) — and casts are forbidden, so the Ex variant is
  unusable for a full enumeration today.
- **Workaround in umbriel:** `desktop/services.ts` uses the non-Ex `EnumServicesStatusW` (no group
  arg, correctly nullable) and recovers the pid on demand via `QueryServiceStatusEx`.
- **Fix:** mark `pszGroupName` `_In_opt_` → `LPCWSTR | NULL` in `@bun-win32/advapi32`; then
  `list_services` can carry the pid per row and drop the per-service round-trip.

### WindowsAccessBridge-64.dll · Java Access Bridge (~9 symbols) · no binding — `HAND-ROLLED` (`element/jab.ts:34-43`)
- **Need:** drive Swing/AWT/JavaFX windows, which expose nothing to UIA/MSAA (only their top-level
  frame). Powers `java_tree` / `java_invoke` / `java_set_text`.
- **Status:** `element/jab.ts` hand-rolls the DLL via raw `dlopen` (lazy + fault-tolerant — the DLL
  is absent without a JAB-enabled JDK/JRE, so a missing bridge degrades to `isJavaWindow()=false`,
  never a throw at import). Symbols: `Windows_run`, `isJavaWindow`, `getAccessibleContextFromHWND`,
  `getAccessibleContextInfo`, `getAccessibleChildFromContext`, `getAccessibleActions`,
  `doAccessibleActions`, `setTextContents`, `releaseJavaObject`. This predates the
  hand-roll-and-flag policy; recorded now for visibility.
- **Fix (optional, owner decision):** wrap WindowsAccessBridge-64.dll as `@bun-win32/windowsaccessbridge`
  (only ~9 read/act exports are used). It is an "internal alternate engine," so upstreaming is a
  nice-to-have for consistency, not a blocker — keep the lazy/fault-tolerant `dlopen` behavior either way.

### ~~iphlpapi / ws2_32 · network enumeration~~ — CORRECTION: the bindings EXIST; being built in-repo
- **PRIOR CLAIM WAS WRONG (a fabrication):** an earlier entry said "NO installed `@bun-win32/*` binding exposes
  `iphlpapi` or `ws2_32`." A finder verified only that they were absent from umbriel's *installed* deps and that was
  written up as "no binding exists." **Both are published** — `@bun-win32/iphlpapi` (npm 1.0.5) and `@bun-win32/ws2_32`
  (npm 1.0.6), present in the upstream `packages/`, with `GetAdaptersAddresses`/`GetExtendedTcpTable`/`GetExtendedUdpTable`
  etc. → NOT an owner gap. Network read tools are buildable now by adding the dep; tracked as a capability build, not a
  binding gap. (Remove this note once shipped.)

