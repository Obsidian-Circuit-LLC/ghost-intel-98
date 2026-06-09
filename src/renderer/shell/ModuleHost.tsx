/**
 * Routes a WindowSpec.module key to the right React component via the
 * runtime ModuleRegistry (registered by registerBuiltins() in main.tsx).
 * The compile-time 27-case switch has been replaced by a registry lookup.
 */

import { getModule } from '../state/registry';
import type { WindowSpec } from '../state/store';
import { ComingSoon } from '../modules/coming-soon/ComingSoon';

/**
 * Pure selector — returns the registered component for the given key, or
 * null if nothing is registered. Used by tests (no rendering required).
 */
export function selectModuleComponent(
  key: string
): import('../state/registry').ModuleDescriptor['component'] | null {
  return getModule(key)?.component ?? null;
}

export function ModuleHost({ spec }: { spec: WindowSpec }): JSX.Element {
  const d = getModule(spec.module);
  if (!d) return <ComingSoon name={spec.module} detail="No module registered for this key." />;
  const C = d.component;
  return <C spec={spec} />;
}
