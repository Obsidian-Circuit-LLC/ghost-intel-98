// @vitest-environment jsdom
/**
 * Wiring coverage: ModuleHost must render every module INSIDE ModuleErrorBoundary, or a
 * single module's render throw white-screens the whole desktop again. The per-boundary and
 * per-module tests can all stay green even if the wrapper is silently removed from
 * ModuleHost — this test closes that gap by mounting a deliberately-throwing module through
 * the real ModuleHost path and asserting the boundary's fallback appears (which can only
 * happen if ModuleHost actually wraps the component).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ModuleHost } from '../src/renderer/shell/ModuleHost';
import { registerModule, _resetRegistryForTest } from '../src/renderer/state/registry';
import type { WindowSpec } from '../src/renderer/state/store';

function Boom(): JSX.Element {
  throw new Error('module-boom');
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  _resetRegistryForTest();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // React logs caught boundary errors to console.error; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  _resetRegistryForTest();
  vi.restoreAllMocks();
});

describe('ModuleHost wires modules through ModuleErrorBoundary', () => {
  it('contains a throwing module in the boundary fallback (proves the wrapper is present)', () => {
    registerModule({ key: 'test-throw', title: 'Throw', glyph: 'x', component: Boom, builtin: false });
    const spec: WindowSpec = { id: 'w-throw', module: 'test-throw', title: 'Throw' };

    // The throw must be caught by the boundary, not propagate to the caller.
    expect(() => {
      act(() => { root.render(createElement(ModuleHost, { spec })); });
    }).not.toThrow();

    const alert = container.querySelector('[role="alert"]');
    expect(alert, 'ModuleHost did not wrap the module in ModuleErrorBoundary').not.toBeNull();
    expect(container.textContent).toContain('This tool failed to load');
    expect(container.textContent).toContain('module-boom');
  });
});
