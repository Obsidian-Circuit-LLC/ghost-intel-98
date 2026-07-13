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
export function clearRegisteredBrain(pluginId: string): void { brains.delete(pluginId); }
export function clearAllBrains(): void { brains.clear(); }
export function _resetBrainsForTest(): void { brains.clear(); }
