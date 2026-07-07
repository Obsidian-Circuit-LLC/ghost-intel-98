// @vitest-environment jsdom
/**
 * Task 6: Settings checkbox + ack + clearnet warning + clarified labels.
 *
 * Charter: `geoint.cctvResolveClearnet` is opt-in and off by default; the checkbox that
 * enables it is disabled while `cctvResolveHosts` (the Tor-only host-resolution gate) is
 * off; the FIRST enable requires an explicit real-IP-exposure acknowledgement via
 * `confirmDialog` (mirroring the X clearnet-consent pattern) and only patches
 * `cctvResolveClearnet` (+ `cctvResolveClearnetAck`) if confirmed — declining leaves the
 * setting off and patches nothing. Once acknowledged, later toggles patch directly with no
 * modal. Separately, HostInfoView must show a persistent "resolved over CLEARNET — real IP
 * exposed" warning whenever a lookup result carries `via: 'clearnet'`, and never for `via:
 * 'tor'`.
 *
 * No @testing-library — React 18 createRoot inside act(), mirroring settings-x-session.test.tsx
 * and hostinfo-view.test.tsx. confirmDialog is mocked so no DialogHost is needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSettings } from '@shared/types';
import type { AppSettings } from '@shared/types';
import type { CameraStream, HostInfo } from '../src/shared/post-mvp-types';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  alertDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { GeoINTPane } from '../src/renderer/modules/settings/SettingsModule';
import { confirmDialog } from '../src/renderer/state/dialogs';
import { HostInfoView } from '../src/renderer/modules/hostinfo/HostInfoView';
import { useSettings } from '../src/renderer/state/store';

let container: HTMLDivElement;
let root: Root;

function installGeoApi(): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    geoint: {
      hasLayerKey: vi.fn().mockResolvedValue(false),
      setLayerKey: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function settingsWith(geoint: Partial<AppSettings['geoint']>): AppSettings {
  return { ...defaultSettings, geoint: { ...defaultSettings.geoint, ...geoint } };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

async function renderPane(s: AppSettings, patch = vi.fn().mockResolvedValue(undefined)): Promise<ReturnType<typeof vi.fn>> {
  await act(async () => { root.render(<GeoINTPane s={s} patch={patch} />); });
  await flush();
  return patch;
}

function clearnetCheckbox(): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) => /CLEARNET/.test(l.textContent ?? ''));
  if (!label) throw new Error('no clearnet-resolve label rendered');
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) throw new Error('no checkbox inside clearnet-resolve label');
  return input as HTMLInputElement;
}

beforeEach(() => {
  installGeoApi();
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
  vi.mocked(confirmDialog).mockReset();
});

describe('GeoINTPane — clearnet host-resolve checkbox', () => {
  it('is disabled when cctvResolveHosts is off', async () => {
    await renderPane(settingsWith({ cctvResolveHosts: false, cctvResolveClearnet: false, cctvResolveClearnetAck: false }));
    expect(clearnetCheckbox().disabled).toBe(true);
  });

  it('is enabled (not disabled) when cctvResolveHosts is on', async () => {
    await renderPane(settingsWith({ cctvResolveHosts: true, cctvResolveClearnet: false, cctvResolveClearnetAck: false }));
    expect(clearnetCheckbox().disabled).toBe(false);
  });

  it('enabling when ack is false opens confirmDialog; confirming patches both flags', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    const patch = await renderPane(settingsWith({ cctvResolveHosts: true, cctvResolveClearnet: false, cctvResolveClearnetAck: false }));

    await act(async () => { clearnetCheckbox().click(); });
    await flush();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ geoint: { cctvResolveClearnet: true, cctvResolveClearnetAck: true } });
  });

  it('declining the ack dialog patches nothing and leaves it off', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    const patch = await renderPane(settingsWith({ cctvResolveHosts: true, cctvResolveClearnet: false, cctvResolveClearnetAck: false }));

    await act(async () => { clearnetCheckbox().click(); });
    await flush();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it('once acknowledged, toggling again patches directly with no modal', async () => {
    const patch = await renderPane(settingsWith({ cctvResolveHosts: true, cctvResolveClearnet: true, cctvResolveClearnetAck: true }));

    await act(async () => { clearnetCheckbox().click(); });
    await flush();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({ geoint: { cctvResolveClearnet: false } });
  });
});

describe('HostInfoView — clearnet real-IP warning', () => {
  const stream: CameraStream = {
    id: 's1',
    label: 'Front Gate Cam',
    url: 'https://cam.example.com/live.m3u8',
    kind: 'hls',
    caseId: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    notes: ''
  };

  beforeEach(() => {
    useSettings.setState({ settings: { ...defaultSettings, geoint: { ...defaultSettings.geoint, cctvResolveHosts: true } } });
  });

  afterEach(() => {
    useSettings.setState({ settings: null });
  });

  it('shows the CLEARNET real-IP warning when info.via is clearnet', async () => {
    const info: HostInfo = { host: 'x', isIpLiteral: false, ips: ['1.2.3.4'], errors: [], resolvedAt: 't', via: 'clearnet' };
    const resolve = vi.fn().mockResolvedValue(info);
    (globalThis as unknown as { window: { api: unknown } }).window.api = { hostinfo: { resolve } };
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(container.textContent ?? '').toMatch(/CLEARNET.*real IP exposed/i);
  });

  it('does NOT show the warning when info.via is tor', async () => {
    const info: HostInfo = { host: 'x', isIpLiteral: false, ips: ['1.2.3.4'], errors: [], resolvedAt: 't', via: 'tor' };
    const resolve = vi.fn().mockResolvedValue(info);
    (globalThis as unknown as { window: { api: unknown } }).window.api = { hostinfo: { resolve } };
    await act(async () => { root.render(<HostInfoView stream={stream} defaultOpen />); });
    expect(container.textContent ?? '').not.toMatch(/real IP exposed/i);
  });
});
