// @vitest-environment jsdom
/**
 * CameraViewModule launched standalone (no `stream` prop) must NOT crash — it renders a minimal
 * entry surface: a "stream URL (rtsp/http/hls)" field + Open button, plus a hint to launch from
 * EyeSpy / GeoINT. With a stream it is unchanged (header + Viewer + HostInfoView).
 *
 * The heavy children (Viewer → hls.js/store/Tor, HostInfoView → useHostInfo) are mocked so this
 * test exercises only CameraViewModule's own branching, not the media stack.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against jsdom.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CameraStream } from '../src/shared/post-mvp-types';

vi.mock('../src/renderer/modules/eyespy/Viewer', () => ({
  Viewer: ({ stream }: { stream: CameraStream }) => <div data-testid="viewer">viewer:{stream.url}</div>
}));
vi.mock('../src/renderer/modules/hostinfo/HostInfoView', () => ({
  HostInfoView: ({ stream }: { stream: CameraStream }) => <div data-testid="hostinfo">hostinfo:{stream.url}</div>
}));

// Imported after the mocks are registered (vi.mock is hoisted above imports anyway).
import { CameraViewModule } from '../src/renderer/modules/cameraview/CameraViewModule';

function cam(over: Partial<CameraStream> = {}): CameraStream {
  return { id: 'c1', label: 'A40 Cam', url: 'http://x/a.mjpg', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', ...over };
}

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

describe('CameraViewModule standalone (no stream)', () => {
  it('does not throw and renders a stream-URL entry field', () => {
    expect(() => {
      act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        root.render(<CameraViewModule stream={undefined as any} />);
      });
    }).not.toThrow();

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(container.textContent).toContain('stream URL (rtsp/http/hls)');
    // No stream ⇒ the media Viewer is not mounted yet.
    expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
  });

  it('hints that a stream can be launched from EyeSpy / GeoINT', () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(<CameraViewModule stream={undefined as any} />);
    });
    expect(container.textContent).toMatch(/EyeSpy/);
    expect(container.textContent).toMatch(/GeoINT/);
  });

  it('opens a pasted URL by constructing the stream shape the Viewer expects', () => {
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      root.render(<CameraViewModule stream={undefined as any} />);
    });
    const input = container.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'https://cam.example/live.m3u8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const button = container.querySelector('button') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const viewer = container.querySelector('[data-testid="viewer"]');
    expect(viewer).not.toBeNull();
    expect(viewer?.textContent).toContain('https://cam.example/live.m3u8');
  });
});

describe('CameraViewModule with a stream (unchanged)', () => {
  it('renders the header, the Viewer, and HostInfoView — no entry field', () => {
    act(() => {
      root.render(<CameraViewModule stream={cam({ city: 'London', country: 'United Kingdom' })} />);
    });
    expect(container.textContent).toContain('A40 Cam — London · United Kingdom');
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toContain('http://x/a.mjpg');
    expect(container.querySelector('[data-testid="hostinfo"]')).not.toBeNull();
    // The standalone entry field must NOT appear when a stream is present.
    expect(container.querySelector('input')).toBeNull();
  });
});
