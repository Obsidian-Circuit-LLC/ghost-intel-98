import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSettings, wireSettingsChanged } from '../src/renderer/state/store';
import { defaultSettings, type AppSettings } from '../src/shared/types';

/**
 * Task 2: settings:changed main->renderer push.
 *
 * The renderer's settings cache (useSettings) is only ever refreshed by an explicit
 * load()/patch() call from THIS window — if another code path (a background service, a
 * main-side settingsStore.update from a different handler) changes settings.json, the
 * cache silently lags disk until the user happens to trigger a re-read. wireSettingsChanged()
 * subscribes to the main->renderer `settings:changed` push (preload's window.api.settings.
 * onChanged) and folds every pushed AppSettings straight into the store, so the cache can't lag.
 *
 * No DOM needed — this is a plain store/wiring unit test (node environment), not a component
 * render. window.api is stubbed directly on globalThis.
 */

describe('wireSettingsChanged — settings:changed push updates the renderer cache', () => {
  beforeEach(() => {
    useSettings.setState({ settings: null });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    useSettings.setState({ settings: null });
  });

  it('folds a pushed AppSettings into useSettings on onChanged', () => {
    let captured: ((s: AppSettings) => void) | undefined;
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        settings: {
          onChanged: (cb: (s: AppSettings) => void) => {
            captured = cb;
            return () => { captured = undefined; };
          }
        }
      }
    };

    const dispose = wireSettingsChanged();
    expect(captured).toBeTypeOf('function');

    const next: AppSettings = { ...defaultSettings, geoint: { ...defaultSettings.geoint, cctvResolveHosts: true } };
    captured!(next);

    expect(useSettings.getState().settings).toEqual(next);
    dispose();
  });
});
