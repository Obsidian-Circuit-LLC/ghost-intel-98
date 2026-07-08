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
