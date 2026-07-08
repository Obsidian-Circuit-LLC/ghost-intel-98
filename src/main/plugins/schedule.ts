/** Host-owned background-timer registry for plugins holding the `background-tasks` cap.
 *  Timers are keyed by plugin id so they can be cleared on teardown / app quit — nothing orphans. */
export const MIN_SCHEDULE_MS = 60_000;
/** Node/Electron TIMEOUT_MAX (2^31-1). setInterval coerces any delay above this — or Infinity — to
 *  1ms, which would busy-spin the host loop; clamp the high end so a long/oversized cadence can't. */
export const MAX_SCHEDULE_MS = 2_147_483_647;
const registry = new Map<string, Set<NodeJS.Timeout>>();

export function schedulePluginTask(pluginId: string, intervalMs: number, fn: () => void): { dispose(): void } {
  const ms = Math.min(MAX_SCHEDULE_MS, Math.max(MIN_SCHEDULE_MS, Math.floor(intervalMs) || MIN_SCHEDULE_MS));
  const t = setInterval(() => {
    // Isolate BOTH failure modes: a synchronous throw (try/catch) and an async callback whose
    // returned promise rejects (the .catch below). An unhandled rejection on the Electron main
    // event loop terminates the host process (Node >=15 default) — exactly what this wrapper exists
    // to prevent. Log-and-continue in every case; the interval must keep firing on later ticks.
    try {
      const r = fn() as unknown;
      if (r && typeof (r as { then?: unknown }).then === 'function') {
        (r as Promise<void>).catch((e) => console.error(`[plugin:${pluginId}] scheduled task rejected`, e));
      }
    } catch (e) { console.error(`[plugin:${pluginId}] scheduled task threw`, e); }
  }, ms);
  const set = registry.get(pluginId) ?? new Set<NodeJS.Timeout>();
  set.add(t); registry.set(pluginId, set);
  return { dispose() { clearInterval(t); registry.get(pluginId)?.delete(t); } };
}
export function disposePluginSchedules(pluginId: string): void {
  const set = registry.get(pluginId); if (!set) return;
  for (const t of set) clearInterval(t);
  registry.delete(pluginId);
}
export function scheduledPluginIds(): string[] { return [...registry.keys()]; }
export function disposeAllSchedules(): void {
  for (const set of registry.values()) for (const t of set) clearInterval(t);
  registry.clear();
}
export function _resetSchedulesForTest(): void { disposeAllSchedules(); }
