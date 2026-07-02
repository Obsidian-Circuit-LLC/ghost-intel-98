// @vitest-environment jsdom
/**
 * ModuleErrorBoundary contains a render/mount throw from a module's tree inside a
 * Win98 fallback panel instead of letting it white-screen (rethrow past) the shell.
 * It also resets its error state when `moduleKey` changes so a different module
 * opened in the same host slot mounts clean.
 *
 * No @testing-library here (not a dependency) — we drive React 18's createRoot
 * directly inside act(), against a jsdom container.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ModuleErrorBoundary } from '../src/renderer/shell/ModuleErrorBoundary';

function Boom(): JSX.Element {
  throw new Error('kaboom-from-child');
}

function Fine(): JSX.Element {
  return <p>i rendered fine</p>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe('ModuleErrorBoundary', () => {
  it('contains a throwing child and does not propagate to a surrounding element', () => {
    act(() => {
      root.render(
        <div>
          <div data-testid="sibling">still here</div>
          <ModuleErrorBoundary moduleKey="mod-a">
            <Boom />
          </ModuleErrorBoundary>
        </div>
      );
    });

    // The sibling stays mounted — the throw was contained, not rethrown past the boundary.
    expect(container.querySelector('[data-testid="sibling"]')?.textContent).toBe('still here');
    // Fallback text + the actual error message are shown.
    expect(container.textContent).toContain('This tool failed to load');
    expect(container.textContent).toContain('kaboom-from-child');
  });

  it('is transparent on the happy path (renders children unchanged)', () => {
    act(() => {
      root.render(
        <ModuleErrorBoundary moduleKey="mod-a">
          <Fine />
        </ModuleErrorBoundary>
      );
    });

    expect(container.textContent).toContain('i rendered fine');
    expect(container.textContent).not.toContain('This tool failed to load');
  });

  it('invokes onClose when the fallback "Close window" button is clicked', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <ModuleErrorBoundary moduleKey="mod-a" onClose={onClose}>
          <Boom />
        </ModuleErrorBoundary>
      );
    });
    // In the fallback, the real close action tears down the host window.
    const closeBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Close window');
    expect(closeBtn, 'fallback did not offer a "Close window" button when onClose provided').toBeTruthy();
    act(() => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets its error state when moduleKey changes', () => {
    act(() => {
      root.render(
        <ModuleErrorBoundary moduleKey="mod-a">
          <Boom />
        </ModuleErrorBoundary>
      );
    });
    expect(container.textContent).toContain('This tool failed to load');

    // Reopening a DIFFERENT module in the same slot must recover: new key clears the error.
    act(() => {
      root.render(
        <ModuleErrorBoundary moduleKey="mod-b">
          <Fine />
        </ModuleErrorBoundary>
      );
    });

    expect(container.textContent).toContain('i rendered fine');
    expect(container.textContent).not.toContain('This tool failed to load');
  });
});
