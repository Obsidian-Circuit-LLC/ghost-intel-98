import type React from 'react';
import type { WindowSpec } from './store';

export interface ModuleDescriptor {
  key: string;
  title: string;
  glyph: string;
  component: React.ComponentType<{ spec: WindowSpec }>;
  builtin: boolean;
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
