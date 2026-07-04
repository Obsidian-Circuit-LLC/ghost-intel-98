import type { TransformDescriptor, EntityType } from '@shared/investigation-types';

const registry = new Map<string, TransformDescriptor>();

export function registerTransform(d: TransformDescriptor): void {
  if (registry.has(d.id)) throw new Error(`Transform already registered: ${d.id}`);
  registry.set(d.id, d);
}
export function getTransform(id: string): TransformDescriptor | undefined { return registry.get(id); }
export function listTransforms(): TransformDescriptor[] { return [...registry.values()]; }
export function transformsForType(t: EntityType): TransformDescriptor[] {
  return [...registry.values()].filter((d) => d.inputTypes.includes(t));
}
export function __clearRegistryForTest(): void { registry.clear(); }
