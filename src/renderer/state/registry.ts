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
