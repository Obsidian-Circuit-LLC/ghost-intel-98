import type React from 'react';
import type { WindowSpec } from './store';

export interface ModuleDescriptor {
  key: string;
  title: string;
  glyph: string;
  component: React.ComponentType<{ spec: WindowSpec }>;
  builtin: boolean;
  /** Preferred initial window size when opened without an explicit width/height.
   *  Lets a module (e.g. the Jukebox) declare a sensible default once, instead of
   *  every launch site repeating it. Falls back to the global 760×520 if unset. */
  defaultWidth?: number;
  defaultHeight?: number;
  /** OSINT Toolkit grouping (optional). A module with category:'osint' appears in the OSINT
   *  Toolkit launcher under its subcategory. Non-OSINT modules omit both. */
  category?: string;
  subcategory?: string;
  /** SINGLETON (Finding 3): only ONE window of this module may be open at a time. A module that
   *  drives a process-global native resource (e.g. Ghost Social's per-account view manager — one
   *  overlay host, one cache, one teardown) must be singleton, or a second window shares and
   *  cross-composites/tears down the first's views. When set, the window store's `open()` FOCUSES
   *  the existing window instead of creating a second. */
  singleton?: boolean;
}

const registry = new Map<string, ModuleDescriptor>();

export function registerModule(d: ModuleDescriptor): void {
  if (registry.has(d.key)) throw new Error(`module key already registered: ${d.key}`);
  registry.set(d.key, d);
}
export function getModule(key: string): ModuleDescriptor | undefined {
  return registry.get(key);
}
export function listModules(): ModuleDescriptor[] {
  return [...registry.values()];
}
/** test-only */
export function _resetRegistryForTest(): void {
  registry.clear();
}
