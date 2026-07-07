// @vitest-environment jsdom
/**
 * T3: Host Info renderer — off + Tor-not-ready states, gated auto-run.
 *
 * `HostInfoView` is the single resolution view behind BOTH the stream-driven EyeSpy/GeoINT
 * drill-down and the standalone OSINT Host Info entry (W1). It must respect the Tor-only
 * host-resolution setting (settings.geoint.cctvResolveHosts):
 *
 *   - OFF: render a "turned off in Settings → GeoINT" notice. The renderer's cached setting is
 *     only a pre-run hint — main is authoritative (see hostinfo-view.test.tsx Task 1): the IPC
 *     call may still fire, but the gate (hostinfo-ipc-gate.test.ts) answers with a fast,
 *     no-network `resolve-disabled` result and never touches the resolver/Tor — that is where
 *     the real "no egress" guarantee lives, not in whether the renderer's mock got called.
 *   - ON but Tor not ready: the main-side resolve fast-fails and returns a partial HostInfo whose
 *     errors carry the `tor-not-ready` marker (see hostinfo-tor-fastfail). The view must surface a
 *     "needs Tor (bootstrapping / unavailable)" message rather than sit on an indefinite spinner.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), against a
 * jsdom container, mirroring hostinfo-standalone.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HostInfoView } from '../src/renderer/modules/hostinfo/HostInfoView';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { CameraStream, HostInfo } from '../src/shared/post-mvp-types';

const stream: CameraStream = {
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
let resolve: ReturnType<typeof vi.fn>;

function setResolveHosts(on: boolean): void {
  useSettings.setState({ settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, cctvResolveHosts: on } } });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  resolve = vi.fn().mockResolvedValue(null);
  (globalThis as unknown as { window: { api: unknown } }).window.api = { hostinfo: { resolve } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('HostInfoView — Tor-only host-resolution setting gating', () => {
  it('setting OFF: shows the off notice, driven by the gate\'s authoritative resolve-disabled result', async () => {
    setResolveHosts(false);
    resolve.mockResolvedValue({ host: 'cam.example.com', isIpLiteral: false, ips: [], errors: ['resolve-disabled'], resolvedAt: 't' });
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(container.textContent ?? '').toMatch(/turned off in Settings/i);
  });

  it('setting ON + Tor-not-ready result: shows the needs-Tor message, not a perpetual spinner', async () => {
    setResolveHosts(true);
    const torNotReady: HostInfo = {
      host: '1.2.3.4', isIpLiteral: true, ips: [], resolvedAt: '2026-02-02T00:00:00Z', errors: ['tor-not-ready']
    };
    resolve.mockResolvedValue(torNotReady);
    act(() => root.render(<HostInfoView stream={stream} defaultOpen />));
    const details = container.querySelector('details') as HTMLDetailsElement;
    await act(async () => { details.dispatchEvent(new Event('toggle', { bubbles: true })); });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(container.textContent ?? '').toMatch(/needs Tor/i);
    // Spinner text must be gone — loading resolved, we are not hanging.
    expect(container.textContent ?? '').not.toMatch(/resolving via Tor/i);
  });
});
