// @vitest-environment jsdom
/**
 * Task 1: Fix the "resolved but says off" contradiction + auto-run gap.
 *
 * Bug: the "Host resolution is turned off" notice was driven off the renderer's CACHED
 * settings snapshot (`useSettings`), not off the actual resolve result. If that cache lags
 * main (see settings:changed, Task 2) a stream can be resolved successfully while the panel
 * still claims resolution is off, or vice versa — a resolve-disabled result renders as a
 * generic Tor error instead of the "turned off" notice.
 *
 * Fix: once a result exists, the "turned off" branch is driven by `info.errors.includes(
 * 'resolve-disabled')` (the main-process's authoritative answer), not by the cached
 * `resolveHosts` flag; the cached flag is only a pre-run hint. Also: `<details open>` never
 * fires `onToggle` on initial mount, so `defaultOpen` must auto-run the lookup itself.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * mirroring hostinfo-states.test.tsx.
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

describe('HostInfoView — result-driven "off" message + auto-run', () => {
  it('divergence: cached setting says ON but the result says resolve-disabled -> shows the "turned off" notice, not a generic Tor error', async () => {
    setResolveHosts(true);
    const disabled: HostInfo = { host: 'x', isIpLiteral: false, ips: [], errors: ['resolve-disabled'], resolvedAt: 't' };
    resolve.mockResolvedValue(disabled);
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(container.textContent ?? '').toMatch(/turned off in Settings/i);
    expect(container.textContent ?? '').not.toMatch(/Couldn't fully resolve via Tor \(resolve-disabled\)/i);
  });

  it('normal: result with IPs and no errors -> shows the IP, no "turned off", no "(resolve-disabled)"', async () => {
    setResolveHosts(true);
    const ok: HostInfo = { host: 'x', isIpLiteral: false, ips: ['1.2.3.4'], errors: [], resolvedAt: 't' };
    resolve.mockResolvedValue(ok);
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(container.textContent ?? '').toMatch(/1\.2\.3\.4/);
    expect(container.textContent ?? '').not.toMatch(/turned off in Settings/i);
    expect(container.textContent ?? '').not.toMatch(/resolve-disabled/i);
  });

  it('auto-run: rendering with defaultOpen triggers window.api.hostinfo.resolve on mount (once)', async () => {
    setResolveHosts(true);
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
