// @vitest-environment jsdom
/**
 * T3: News standalone viewer.
 *
 * NewsViewModule backs the GeoINT LiveNewsPanel pop-out (⧉), which hands it a selected
 * NewsStream. It is ALSO reachable as a standalone OSINT tool launched from the Toolkit
 * with no props — and there the `stream` prop is absent. Launched standalone it must NOT
 * crash dereferencing an absent stream (`stream.label`/`stream.kind`); it must fall back to
 * a sensible DEFAULT feed and render the same shared viewer (<NewsStreamView/>). Launched
 * with a stream it must behave exactly as before.
 *
 * With the store's settings null (the test default) NewsStreamView renders only its
 * network-off placeholder — no HLS chunks, no iframe, no egress — so no window.api stub is
 * needed. We assert on the header (feed label + kind) which the module renders directly.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * against a jsdom container, mirroring hostinfo-standalone.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NewsViewModule } from '../src/renderer/modules/geoint/NewsViewModule';
import { DEFAULT_NEWS_STREAM, type NewsStream } from '../src/renderer/modules/geoint/NewsStreamView';

const stream: NewsStream = { label: 'Al Jazeera English', url: 'https://www.youtube.com/watch?v=gCNeDWCI0vo', kind: 'youtube' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('NewsViewModule standalone entry', () => {
  it('renders the viewer against the default feed when launched without a stream, and does not throw', () => {
    expect(() => {
      act(() => root.render(<NewsViewModule />));
    }).not.toThrow();
    // Header shows the default feed's label + kind.
    expect(container.textContent ?? '').toContain(DEFAULT_NEWS_STREAM.label);
    expect(container.textContent ?? '').toContain(`(${DEFAULT_NEWS_STREAM.kind})`);
    // The shared NewsStreamView mounted (network off ⇒ its offline placeholder is present).
    expect(container.textContent ?? '').toContain('Enable the GeoINT network');
  });

  it('renders the given stream unchanged when launched with a stream', () => {
    act(() => root.render(<NewsViewModule stream={stream} />));
    expect(container.textContent ?? '').toContain(stream.label);
    expect(container.textContent ?? '').toContain(`(${stream.kind})`);
    // The default feed label must NOT leak into the stream flow.
    expect(container.textContent ?? '').not.toContain(DEFAULT_NEWS_STREAM.label);
  });
});
