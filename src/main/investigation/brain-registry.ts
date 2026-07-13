/** Holds the autonomous-run Brain supplied by a `reasoning-runtime` plugin. Core's getBrain() returns
 *  the registered brain, so installing the OSINT plugin flips run.available() true. Keyed by plugin id
 *  so teardown clears it (mirrors the schedule registry). Last-registered wins (only one brain runs). */
import type { Brain } from '../../shared/investigation-agent';
const brains = new Map<string, Brain>();
export function setRegisteredBrain(pluginId: string, b: Brain): void { brains.set(pluginId, b); }
export function getRegisteredBrain(): Brain | null {
  let last: Brain | null = null;
  for (const b of brains.values()) last = b;
  return last;
}
/** The ids of plugins that have registered a brain — so disableAllPlugins() can union them into its
 *  teardown set (mirrors schedule.ts's scheduledPluginIds): a plugin that registered ONLY a brain
 *  (no teardown, no schedule) must still be torn down, or its brain survives a non-quit disable-all
 *  and keeps run.available() true. */
export function brainRegisteredPluginIds(): string[] { return [...brains.keys()]; }
export function clearRegisteredBrain(pluginId: string): void { brains.delete(pluginId); }
export function clearAllBrains(): void { brains.clear(); }
export function _resetBrainsForTest(): void { brains.clear(); }
