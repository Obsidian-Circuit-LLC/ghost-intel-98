// @vitest-environment jsdom
/**
 * T2: Host Info standalone entry.
 *
 * HostInfoModule is reachable both as a per-stream drill-down (from the EyeSpy/GeoINT
 * flow, which passes a CameraStream) AND as a standalone OSINT tool launched from the
 * Toolkit with no stream. Launched standalone it must NOT crash dereferencing an absent
 * stream — it must present a host/IP entry form (text input + Resolve) that feeds the
 * existing resolve path. Launched with a stream it must behave exactly as before.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * against a jsdom container, mirroring module-error-boundary.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HostInfoModule } from '../src/renderer/modules/hostinfo/HostInfoModule';
import { hostFromStreamUrl } from '../src/main/services/hostinfo/extract';
import type { CameraStream } from '../src/shared/post-mvp-types';

const validStream: CameraStream = {
  id: 's1',
  label: 'Front Gate Cam',
  url: 'https://cam.example.com/live.m3u8',
  kind: 'hls',
  caseId: null,
  addedAt: '2026-01-01T00:00:00.000Z',
  notes: ''
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // useHostInfo resolves via window.api.hostinfo.resolve (IPC). Stub it so no real egress
  // is attempted and the resolution view can mount without a preload bridge.
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    hostinfo: { resolve: vi.fn().mockResolvedValue(null) }
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('HostInfoModule standalone entry', () => {
  it('renders a host/IP entry form (input + Resolve) when launched without a stream, and does not throw', () => {
    expect(() => {
      act(() => root.render(<HostInfoModule />));
    }).not.toThrow();
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    const buttons = Array.from(container.querySelectorAll('button'));
    const resolve = buttons.find((b) => /resolve/i.test(b.textContent ?? ''));
    expect(resolve).toBeTruthy();
  });

  it('feeds the resolve path a parseable URL after Resolve (renderer→main seam)', () => {
    // The standalone entry stores the typed host in a synthetic stream whose `url` is later
    // parsed with `new URL(...)` in the main-process resolve path. A bare host/IP throws there
    // (errors:['bad-url']) and resolution never runs — so assert the IPC gets a parseable URL
    // that hostFromStreamUrl can turn into host+port, exercising the seam the stub used to hide.
    const resolve = (globalThis as unknown as { window: { api: { hostinfo: { resolve: ReturnType<typeof vi.fn> } } } })
      .window.api.hostinfo.resolve;
    act(() => root.render(<HostInfoModule />));
    const input = container.querySelector('input') as HTMLInputElement;
    // Drive the controlled input the way React tracks changes (native setter + 'input' event).
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(input, '203.0.113.4:554');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const resolveBtn = Array.from(container.querySelectorAll('button')).find((b) => /resolve/i.test(b.textContent ?? ''));
    act(() => { resolveBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    // The resolution view mounts open; expanding it invokes the resolve IPC.
    const details = container.querySelector('details') as HTMLDetailsElement;
    act(() => { details.dispatchEvent(new Event('toggle', { bubbles: true })); });
    expect(resolve).toHaveBeenCalledTimes(1);
    const calledUrl = resolve.mock.calls[0][0] as string;
    expect(() => new URL(calledUrl)).not.toThrow();
    expect(hostFromStreamUrl(calledUrl)).toEqual({ host: '203.0.113.4', isIpLiteral: true, port: '554' });
  });

  it('renders the existing resolution view when given a valid stream', () => {
    act(() => root.render(<HostInfoModule stream={validStream} />));
    expect(container.textContent ?? '').toContain('Host resolution');
    expect(container.textContent ?? '').toContain(validStream.label);
    // No standalone entry input in the stream flow.
    expect(container.querySelector('input')).toBeNull();
  });
});
