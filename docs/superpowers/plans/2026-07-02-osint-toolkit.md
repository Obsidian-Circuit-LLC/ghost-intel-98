# OSINT Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A metadata-driven **OSINT Toolkit** — a Win98 folder-style launcher window that groups the OSINT modules by category → subcategory as clickable tiles, giving the (currently scattered/undiscoverable) tools one home. Additive and renderer-only; touches no tool's internals.

**Architecture:** Add optional `category`/`subcategory` to the module registry descriptor, tag the OSINT modules, and add one `osint-toolkit` module whose window reads `listModules()` and renders the grouping. A pure `buildOsintDirectory()` does the grouping/sort; the `.tsx` is a thin shell. No new IPC, no egress, no settings.

**Tech Stack:** React renderer, Zustand, Vitest (node env), TypeScript strict.

## Global Constraints

- **Renderer-only, additive.** Only the registry descriptor, register-builtins tags, one new renderer module, the desktop-icon list, and the Access menu change. No main-process change, no IPC, no egress, no telemetry, no new settings.
- **Two-level nesting only** (category → subcategory). No arbitrary trees (YAGNI). The existing "Games ▸" Access submenu is NOT touched.
- **Deterministic grouping** — `buildOsintDirectory` sorts by a fixed subcategory priority then tools by title then key (no locale-dependent primary compare); identical input → identical output.
- **Commits:** persona `Dezirae-Stark <213370007+Dezirae-Stark@users.noreply.github.com>`. NEVER emit `Co-Authored-By:` / `Signed-off-by:` / `Claude-Session:` trailers. Stage only files you changed (never `git add -A`). Do not touch pre-existing dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`).
- **No release in this plan.** No version bump, no installer, no publish. This is the last of the four v3.26.0 workstreams; the release is assembled + published separately after this merges.

## Seams (confirmed on main)

- `ModuleDescriptor` — `src/renderer/state/registry.ts:4-15` `{key,title,glyph,component,builtin,defaultWidth?,defaultHeight?}`. `listModules(): ModuleDescriptor[]` at `:26-28`; `registerModule` `:19` (throws dup); `_resetRegistryForTest` `:30`.
- ModuleKey union — `src/renderer/state/store.ts:47` (currently ends `| 'x' | 'ghostscrape'`) → add `| 'osint-toolkit'`.
- Registrations + adapters — `src/renderer/modules/register-builtins.tsx` (`registerModule({...})` block; adapter fn pattern e.g. `XCollectorAdapter`).
- Desktop icons — `src/renderer/shell/Desktop.tsx:14-24` `desktopShortcutDefaults: {module:ModuleKey,label}[]`.
- Access menu — `src/renderer/shell/AccessMenu.tsx`: reads `settings.shortcuts` (`:37`); Games is a special-cased hardcoded submenu (`:19-26` + flyout); `openModule(mod,label)` at `:41-45`.
- Open a module from the renderer — `useWindows.getState().open({module, title})` (`store.ts:67,84`).
- Registration test pattern — `test/x-module-registered.test.ts` (mirror it).

## File Structure

- Modify: `src/renderer/state/registry.ts` (add `category?`/`subcategory?`).
- Create: `src/renderer/modules/osint-toolkit/directory.ts` (pure grouping).
- Modify: `src/renderer/modules/register-builtins.tsx` (tag OSINT modules + register `osint-toolkit` + adapter).
- Create: `src/renderer/modules/osint-toolkit/OSINTToolkitModule.tsx`, `osint-toolkit.css`.
- Modify: `src/renderer/state/store.ts` (ModuleKey union), `src/renderer/shell/Desktop.tsx` (desktop icon), `src/renderer/shell/AccessMenu.tsx` (pinned entry).
- Test: `test/osint-toolkit-directory.test.ts`, `test/osint-toolkit-module-registered.test.ts`.

---

## Task 1: Registry — optional category/subcategory

**Files:** Modify `src/renderer/state/registry.ts`.

- [ ] **Step 1:** Add to `ModuleDescriptor` (after `defaultHeight?`):
```ts
  /** OSINT Toolkit grouping (optional). A module with category:'osint' appears in the OSINT
   *  Toolkit launcher under its subcategory. Non-OSINT modules omit both. */
  category?: string;
  subcategory?: string;
```
- [ ] **Step 2:** `pnpm typecheck` clean (purely additive optional fields).
- [ ] **Step 3:** Commit `feat(osint-toolkit): optional category/subcategory on the module registry`.

## Task 2: Pure directory grouper

**Files:** Create `src/renderer/modules/osint-toolkit/directory.ts`; Test `test/osint-toolkit-directory.test.ts`.

**Interfaces — Produces:**
```ts
import type { ModuleDescriptor } from '../../state/registry';
export interface OsintTool { key: string; title: string; glyph: string; }
export interface OsintGroup { subcategory: string; tools: OsintTool[]; }
export function buildOsintDirectory(mods: ModuleDescriptor[]): OsintGroup[];
```
Behavior: keep only `m.category === 'osint'`; group by `m.subcategory || 'Other'`; order groups by the fixed priority `['Social Media','Geospatial','Identity','Network / Recon']` then any remaining subcategories alphabetically, `'Other'` last; within a group sort tools by `title` then `key` (plain `<` compare, deterministic). Empty input → `[]`.

- [ ] **Step 1: Failing test** — synthetic `ModuleDescriptor[]` (component can be a dummy `() => null`): assert non-osint modules are excluded; groups come back in the fixed priority order (a 'Geospatial' + 'Social Media' input returns Social Media first); tools sorted by title then key; unknown subcategory bucketed after the priority ones; `[]` for empty / all-non-osint.
- [ ] **Step 2:** Run → FAIL. `pnpm vitest run test/osint-toolkit-directory.test.ts`
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(osint-toolkit): pure category→subcategory directory grouper`.

## Task 3: Tag the OSINT modules

**Files:** Modify `src/renderer/modules/register-builtins.tsx`.

- [ ] **Step 1:** Add `category:'osint'` + a `subcategory` to each existing OSINT registration (confirm exact keys/titles in the file first):
  - `x`, `ghostscrape`, `socmint` → `subcategory:'Social Media'`
  - `geoint`, `eyespy`, `camera-view` → `subcategory:'Geospatial'`
  - `searchlight` → `subcategory:'Identity'`
  - `host-info`, `net-explorer`, `news-view` → `subcategory:'Network / Recon'`
  (Only tag modules that are actually registered in this file; skip any that don't exist. Do NOT tag the `osint-toolkit` module itself — the launcher must not list itself.)
- [ ] **Step 2:** `pnpm typecheck` clean. (No dedicated test — verified via the real-registry assertion in Task 5.)
- [ ] **Step 3:** Commit `feat(osint-toolkit): tag OSINT modules with category/subcategory`.

## Task 4: The launcher window

**Files:** Create `src/renderer/modules/osint-toolkit/OSINTToolkitModule.tsx`, `src/renderer/modules/osint-toolkit/osint-toolkit.css`. No unit test (thin `.tsx` over the tested grouper) — covered by typecheck + Task 5 registration test + manual smoke.

- [ ] **Step 1:** Implement `OSINTToolkitModule`: `const groups = buildOsintDirectory(listModules())` (import `listModules` from `../../state/registry`, `useWindows` from `../../state/store`); render a Win98 folder body — for each group a subcategory heading and a grid of tiles; each tile shows the module `glyph` + `title` (React text children) and on click calls `useWindows.getState().open({ module: tool.key, title: tool.title })`. Empty state: "No OSINT tools registered." All values are builtin (no untrusted input), but still render as text children.
- [ ] **Step 2:** `pnpm typecheck` clean.
- [ ] **Step 3:** Commit `feat(osint-toolkit): folder-style launcher window`.

## Task 5: Register the module + desktop/Access entries

**Files:** Modify `src/renderer/state/store.ts` (ModuleKey union), `src/renderer/modules/register-builtins.tsx` (import + adapter + `registerModule`), `src/renderer/shell/Desktop.tsx` (desktop icon), `src/renderer/shell/AccessMenu.tsx` (pinned entry); Test `test/osint-toolkit-module-registered.test.ts`.

**Interfaces — Consumes:** Task 2's `buildOsintDirectory`, Task 4's `OSINTToolkitModule`.

- [ ] **Step 1: Failing test** — `test/osint-toolkit-module-registered.test.ts` (mirror `test/x-module-registered.test.ts`): after importing register-builtins, `getModule('osint-toolkit')` is defined with title `'OSINT Toolkit'`; AND `buildOsintDirectory(listModules())` contains a `'Social Media'` group whose tool keys include `x`, `ghostscrape`, `socmint` (proves the Task 3 tagging), and does NOT contain `osint-toolkit` itself.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `| 'osint-toolkit'` to the ModuleKey union (`store.ts:47`); import `OSINTToolkitModule` + define an adapter fn (mirror `XCollectorAdapter`) + `registerModule({ key:'osint-toolkit', title:'OSINT Toolkit', glyph:'🧰', component:OSINTToolkitAdapter, builtin:true, defaultWidth:760, defaultHeight:560 })` (no category — it must not list itself). Add `{ module:'osint-toolkit', label:'OSINT Toolkit' }` to `desktopShortcutDefaults` (`Desktop.tsx`). In `AccessMenu.tsx`, add a pinned "OSINT Toolkit" launcher entry (special-cased like Games — a single entry that calls `open({module:'osint-toolkit', title:'OSINT Toolkit'})`).
- [ ] **Step 4:** Run test → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(osint-toolkit): register module + desktop icon + Access entry`.

## Task 6: Whole-branch verification

- [ ] **Step 1:** `pnpm typecheck` clean; `pnpm test` fully green (record the total).
- [ ] **Step 2:** Confirm `git diff main -- src/main` is EMPTY (renderer-only). Confirm no new egress/IPC/settings. Confirm the launcher lists every tagged OSINT tool and omits itself.
- [ ] **Step 3:** Commit only if a fix was needed; otherwise none.

---

## Verification (whole-branch, before proposing merge)

- `pnpm typecheck` clean; `pnpm test` fully green.
- `git diff main -- src/main` empty (renderer-only; no egress/IPC/settings/telemetry).
- `buildOsintDirectory` deterministic + tested; the launcher groups all tagged tools and never lists itself.
- Commit-author/trailer audit: all `Dezirae-Stark`, no AI trailers.
- No release: version unchanged. After this merges, all four v3.26.0 workstreams are on main and the release is assembled separately.

## Self-Review (author)

- **Coverage:** registry field (T1), pure grouper (T2), tagging (T3), window (T4), registration + surfaces (T5), verify (T6).
- **Type consistency:** `OsintGroup`/`OsintTool` (T2) consumed by the window (T4) + registration test (T5); `category`/`subcategory` (T1) set in T3, read in T2.
- **Charter:** renderer-only, additive, no egress/IPC/settings, deterministic, no release.
