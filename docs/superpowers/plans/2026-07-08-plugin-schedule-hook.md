# Core `ctx.schedule` Hook + `background-tasks` Capability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a host-managed background-timer platform hook `ctx.schedule(intervalMs, fn): Disposable`, gated behind a new `background-tasks` capability, so a signed plugin (the OSINT forager) can run bounded self-directed work with the *host* owning the timer lifecycle (min-interval clamp, per-plugin dispose on teardown, clear-all on app quit). No behavior change to the shipped public app — no core plugin holds `background-tasks`.

**Architecture:** Follows the exact capability-gating pattern of `ctx.vectors`/`vector-recall`. A new `src/main/plugins/schedule.ts` owns a per-plugin timer registry; `context.ts` exposes `ctx.schedule` only when the cap is held; `wire-deps.ts` supplies the host impl; `index.ts` (will-quit) + `loader.ts` (disablePlugin) clear timers so none orphan.

**Tech Stack:** Electron 33 + TypeScript, vitest (fake timers). Repo `/dcs98`, branch `feat/plugin-schedule-hook`.

## Global Constraints

- **No new dependency; no public-app behavior change** (no shipped plugin declares `background-tasks`). Core suite stays green.
- **Determinism/safety:** the scheduled `fn` is wrapped in try/catch so a throwing task never crashes the host event loop; a **min-interval clamp** (`MIN_SCHEDULE_MS = 60_000`) prevents a plugin busy-spinning the host.
- **No orphaned timers** — every timer is tracked by plugin id and cleared on per-plugin teardown AND on app quit (mirrors the `getPluginTor()?.killNow()` will-quit backstop at `index.ts:438`).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`).
- **Commands:** `pnpm test` (vitest), `pnpm typecheck` (both configs).

## File Structure

**New:** `src/main/plugins/schedule.ts`, `test/plugin-schedule.test.ts`.
**Modified:** `src/shared/plugin-types.ts` (add cap), `src/main/plugins/context.ts` (ContextDeps + PluginContext + gate), `src/main/plugins/wire-deps.ts` (host impl), `src/main/plugins/loader.ts` (disablePlugin clears), `src/main/index.ts` (will-quit clears). Tests: `test/plugin-context.test.ts`, and the CAPABILITIES closed-set snapshot test (wherever it lives — grep).

**Sequencing:** Task 1 (cap) + Task 2 (registry) independent → Task 3 (wire ctx.schedule, needs both) → Task 4 (lifecycle cleanup, needs Task 2).

---

### Task 1: Add the `background-tasks` capability

**Files:** Modify `src/shared/plugin-types.ts`; update the CAPABILITIES closed-set snapshot test.

- [ ] **Step 1: Failing test.** Find the closed-set snapshot test for `CAPABILITIES` (grep `background-tasks`/`CAPABILITIES`/`vector-recall` in `test/`). Add `'background-tasks'` to its expected set (this asserts the frozen contract surface is intentional). Run → FAIL (snapshot mismatch: cap not yet present).

- [ ] **Step 2: Implement.** In `plugin-types.ts:3-7`, add `'background-tasks'` to the `CAPABILITIES` tuple (e.g. after `'investigation'`). `Capability` type derives automatically.

- [ ] **Step 3: Run test + typecheck** → PASS/clean.
- [ ] **Step 4: Commit** — `feat(plugins): add background-tasks capability to the frozen contract set`.

---

### Task 2: Host-owned timer registry `schedule.ts`

**Files:** Create `src/main/plugins/schedule.ts`, `test/plugin-schedule.test.ts`.

**Interfaces:**
- Produces: `schedulePluginTask(pluginId: string, intervalMs: number, fn: () => void): { dispose(): void }`; `disposePluginSchedules(pluginId: string): void`; `disposeAllSchedules(): void`; `_resetSchedulesForTest(): void`; `const MIN_SCHEDULE_MS = 60_000`.

- [ ] **Step 1: Failing test** `test/plugin-schedule.test.ts` (vitest `vi.useFakeTimers()`):
  - `schedulePluginTask('p', 60_000, fn)` → `vi.advanceTimersByTime(180_000)` calls `fn` 3 times.
  - The returned `dispose()` stops further calls (advance more → no additional calls).
  - `intervalMs` below `MIN_SCHEDULE_MS` is clamped up to `MIN_SCHEDULE_MS` (schedule at 1000 → fn does NOT fire at 1s; fires at 60s).
  - A `fn` that throws does not propagate (the interval keeps firing on later ticks; no unhandled rejection).
  - `disposePluginSchedules('p')` clears all of p's timers (two tasks for 'p' → after dispose, none fire); a second plugin 'q' is unaffected.
  - `disposeAllSchedules()` clears every plugin's timers.

- [ ] **Step 2: Run → FAIL** (module absent).

- [ ] **Step 3: Implement** `schedule.ts`:
  ```ts
  /** Host-owned background-timer registry for plugins holding the `background-tasks` cap.
   *  Timers are keyed by plugin id so they can be cleared on teardown / app quit — nothing orphans. */
  export const MIN_SCHEDULE_MS = 60_000;
  const registry = new Map<string, Set<NodeJS.Timeout>>();

  export function schedulePluginTask(pluginId: string, intervalMs: number, fn: () => void): { dispose(): void } {
    const ms = Math.max(MIN_SCHEDULE_MS, Math.floor(intervalMs) || MIN_SCHEDULE_MS);
    const t = setInterval(() => { try { fn(); } catch (e) { console.error(`[plugin:${pluginId}] scheduled task threw`, e); } }, ms);
    const set = registry.get(pluginId) ?? new Set<NodeJS.Timeout>();
    set.add(t); registry.set(pluginId, set);
    return { dispose() { clearInterval(t); registry.get(pluginId)?.delete(t); } };
  }
  export function disposePluginSchedules(pluginId: string): void {
    const set = registry.get(pluginId); if (!set) return;
    for (const t of set) clearInterval(t);
    registry.delete(pluginId);
  }
  export function disposeAllSchedules(): void {
    for (const set of registry.values()) for (const t of set) clearInterval(t);
    registry.clear();
  }
  export function _resetSchedulesForTest(): void { disposeAllSchedules(); }
  ```

- [ ] **Step 4: Run test + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(plugins): host-owned background-timer registry (min-interval clamp, per-plugin dispose)`.

---

### Task 3: Expose `ctx.schedule` behind the capability

**Files:** Modify `src/main/plugins/context.ts`, `src/main/plugins/wire-deps.ts`; Test: `test/plugin-context.test.ts`.

**Interfaces:**
- `ContextDeps.schedule?: (pluginId: string, intervalMs: number, fn: () => void) => { dispose(): void }`.
- `PluginContext.schedule?: (intervalMs: number, fn: () => void) => { dispose(): void }` (id pre-bound).
- Consumes Task 1 (cap) + Task 2 (`schedulePluginTask`).

- [ ] **Step 1: Failing test** in `test/plugin-context.test.ts` (mirror the existing `vector-recall` gating cases): a context built WITHOUT `background-tasks` has `ctx.schedule === undefined`; a context WITH `background-tasks` and a `deps.schedule` spy exposes `ctx.schedule`, and calling `ctx.schedule(ms, fn)` calls `deps.schedule('<id>', ms, fn)` (id bound). Run → FAIL.

- [ ] **Step 2: Implement.**
  - `context.ts`: add to `ContextDeps` (after `vectorRecall?`): `schedule?: (pluginId: string, intervalMs: number, fn: () => void) => { dispose(): void };`. Add to `PluginContext` (after `vectors?`): `schedule?: (intervalMs: number, fn: () => void) => { dispose(): void };`. In `createPluginContext`, after the `vector-recall` gate (line ~111-115): `if (has('background-tasks') && deps.schedule) { ctx.schedule = (intervalMs, fn) => deps.schedule!(id, intervalMs, fn); }`.
  - `wire-deps.ts`: `import { schedulePluginTask } from './schedule';` and add to the returned `ContextDeps` object: `schedule: (pluginId, intervalMs, fn) => schedulePluginTask(pluginId, intervalMs, fn),`.

- [ ] **Step 3: Run tests + typecheck** → PASS/clean.
- [ ] **Step 4: Commit** — `feat(plugins): expose ctx.schedule() gated behind background-tasks`.

---

### Task 4: Lifecycle cleanup (teardown + app quit)

**Files:** Modify `src/main/plugins/loader.ts`, `src/main/index.ts`; Test: extend `test/plugin-schedule.test.ts` or a loader test.

**Interfaces:** Consumes Task 2 (`disposePluginSchedules`, `disposeAllSchedules`).

- [ ] **Step 1: Failing test.** Assert `disablePlugin(id)` clears that plugin's scheduled timers: schedule a task for `'p'`, call `disablePlugin('p')`, advance fake timers → `fn` not called. (In `loader.ts`, `disablePlugin` runs teardowns; we add the schedule-clear there.) Run → FAIL (disablePlugin doesn't clear timers yet).

- [ ] **Step 2: Implement.**
  - `loader.ts` `disablePlugin(pluginId)` (line ~119): at the top, `disposePluginSchedules(pluginId);` (add `import { disposePluginSchedules } from './schedule';`). This ensures a disabled plugin's background work stops with its handlers.
  - `index.ts` will-quit (line 438): add `disposeAllSchedules()` to the sync backstop list, e.g. `app.on('will-quit', () => { localAi.stop(); getBgTor()?.killNow(); getPluginTor()?.killNow(); killXSidecar(); disposeAllSchedules(); });` (add `import { disposeAllSchedules } from './plugins/schedule';`).

- [ ] **Step 3: Run tests + typecheck** → PASS/clean.
- [ ] **Step 4: Commit** — `feat(plugins): clear scheduled timers on plugin disable + app quit (no orphans)`.

---

## Post-tasks (controller, after all 4 green + whole-branch review)

- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run) — confirm no public-app behavior change (no shipped plugin holds the cap).
- [ ] Merge `feat/plugin-schedule-hook` → `/dcs98` main (`--no-ff`); push (this is a core platform add the plugin forager depends on — Plan 2 builds against it).
- [ ] Note: this unblocks Plan 2 (the OSINT forager, `/dcs98-osint-plugin`), which declares `background-tasks` and calls `ctx.schedule`.

## Self-Review

- **Coverage:** cap (T1), registry (T2), exposure (T3), cleanup (T4) — the full `ctx.schedule` platform hook.
- **Type consistency:** `ContextDeps.schedule(pluginId,...)` vs `PluginContext.schedule(intervalMs, fn)` (id bound in the gate) — matches T3; `schedulePluginTask`/`disposePluginSchedules`/`disposeAllSchedules` names stable across T2/T3/T4.
- **Charter:** capability-gated (opt-in surface), no public-app change, no new dep, host-owned lifecycle prevents orphaned timers, min-interval clamp, throwing task isolated.
- **Placeholder scan:** none. Uses the real `ctx.vectors` gate site and the real `will-quit` backstop line.
