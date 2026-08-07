/**
 * TG — the `socmint.telegram.captureMedia` setting is HONORED end-to-end at the IPC seam.
 *
 * The setting was defined, defaulted, and merge-healed, but NO runtime code read it — a
 * dormant no-op. These tests pin the fix: the message/member capture handlers read the
 * toggle MAIN-side from persisted settings (the renderer never widens capture) and thread
 * it into the collector as the `captureMedia` dep, so flipping the setting actually changes
 * whether avatar/media resolution runs.
 *
 * The collector's message/member methods are spied so the assertion is purely on the
 * payload the handler builds — no capture window, no Tor, no store is touched. `json-fs` is
 * mocked to a settings stub, and `capture-window` is mocked so importing the handlers pulls
 * no electron.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/main/capture/capture-window', () => ({
  assertTrustedSender: vi.fn(),
}));

// The only reader of json-fs in this path is `loadTelegramCaptureMedia`'s dynamic import.
let CAPTURE_MEDIA = false;
vi.mock('../src/main/storage/json-fs', () => ({
  settingsStore: { read: async () => ({ socmint: { telegram: { engine: 'capture', captureMedia: CAPTURE_MEDIA } } }) },
}));

import {
  captureTelegramMessages,
  captureTelegramMembers,
  __resetTelegramWindowForTests,
} from '../src/main/socmint/telegram-hunter/ipc';
import { TelegramHunterCollector } from '../src/main/socmint/telegram-hunter/collector';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  __resetTelegramWindowForTests();
  vi.restoreAllMocks();
  CAPTURE_MEDIA = false;
});

describe('captureMedia is read MAIN-side and threaded to the collector', () => {
  it('message capture passes captureMedia:true when the setting is ON', async () => {
    CAPTURE_MEDIA = true;
    const spy = vi
      .spyOn(TelegramHunterCollector.prototype, 'captureMessages')
      .mockResolvedValue({ blocked: false, added: 0, skipped: 0, items: [] });

    await captureTelegramMessages({ caseId: VALID_UUID, channelId: '@t' });

    expect(spy).toHaveBeenCalledTimes(1);
    const overrides = spy.mock.calls[0][1] as { captureMedia?: boolean };
    expect(overrides.captureMedia).toBe(true);
  });

  it('message capture passes captureMedia:false when the setting is OFF (default)', async () => {
    CAPTURE_MEDIA = false;
    const spy = vi
      .spyOn(TelegramHunterCollector.prototype, 'captureMessages')
      .mockResolvedValue({ blocked: false, added: 0, skipped: 0, items: [] });

    await captureTelegramMessages({ caseId: VALID_UUID, channelId: '@t' });

    const overrides = spy.mock.calls[0][1] as { captureMedia?: boolean };
    expect(overrides.captureMedia).toBe(false);
  });

  it('member capture threads the same MAIN-side toggle', async () => {
    CAPTURE_MEDIA = true;
    const spy = vi
      .spyOn(TelegramHunterCollector.prototype, 'captureGroupMembers')
      .mockResolvedValue({ blocked: false, added: 0, captured: 0, members: [] });

    await captureTelegramMembers({ caseId: VALID_UUID });

    expect(spy).toHaveBeenCalledTimes(1);
    const overrides = spy.mock.calls[0][1] as { captureMedia?: boolean };
    expect(overrides.captureMedia).toBe(true);
  });
});
