// @vitest-environment jsdom
/**
 * Task 18: Settings UI "Boot screen image: Choose…/Clear" row (mirrors the wallpaper row) +
 * SplashScreen/LockScreen render the custom bootSplashImage when set, falling back to the
 * bundled boot-splash.jpg when null.
 *
 * No @testing-library — React 18 createRoot inside act(), mirroring
 * settings-clearnet-resolve-ui.test.tsx and bgconn-lockscreen.test.ts. Sound is disabled in the
 * SplashScreen fixture settings so playBoot()/AudioContext never runs under jsdom, and fake
 * timers stand in for the splash's real auto-dismiss hold so no timer outlives the test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSettings } from '@shared/types';
import type { AppSettings } from '@shared/types';

import { ThemePane } from '../src/renderer/modules/settings/SettingsModule';
import { SplashScreen } from '../src/renderer/shell/SplashScreen';
import { LockScreen } from '../src/renderer/shell/LockScreen';
import { useSettings, useAuth } from '../src/renderer/state/store';
import splash from '../src/renderer/assets/boot-splash.jpg';

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

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

describe('ThemePane — boot screen image row (mirrors the wallpaper row)', () => {
  function installPickBootSplashApi(uri: string | null): ReturnType<typeof vi.fn> {
    const pickBootSplash = vi.fn().mockResolvedValue(uri);
    (globalThis as unknown as { window: { api: unknown } }).window.api = {
      settings: { pickBootSplash }
    };
    return pickBootSplash;
  }

  function bootRow(): HTMLElement {
    const label = Array.from(container.querySelectorAll('label'))
      .find((l) => /Boot screen image/.test(l.textContent ?? ''));
    if (!label) throw new Error('no "Boot screen image" label rendered');
    return label.parentElement as HTMLElement;
  }

  function chooseButton(): HTMLButtonElement {
    const btn = Array.from(bootRow().querySelectorAll('button')).find((b) => /Choose/.test(b.textContent ?? ''));
    if (!btn) throw new Error('no Choose… button in the boot screen image row');
    return btn as HTMLButtonElement;
  }

  it('renders a "Boot screen image" row with a Choose… button, "none" when unset, no Clear button', async () => {
    installPickBootSplashApi(null);
    const patch = vi.fn().mockResolvedValue(undefined);
    await act(async () => { root.render(<ThemePane s={{ ...defaultSettings, bootSplashImage: null }} patch={patch} />); });
    await flush();

    const row = bootRow();
    expect(row.textContent).toMatch(/none/);
    expect(Array.from(row.querySelectorAll('button')).some((b) => /Clear/.test(b.textContent ?? ''))).toBe(false);
    expect(chooseButton()).toBeTruthy();
  });

  it('Choose… calls settings.pickBootSplash and patches bootSplashImage with the returned data URI', async () => {
    const uri = 'data:image/png;base64,AAAA';
    const pickBootSplash = installPickBootSplashApi(uri);
    const patch = vi.fn().mockResolvedValue(undefined);
    await act(async () => { root.render(<ThemePane s={{ ...defaultSettings, bootSplashImage: null }} patch={patch} />); });
    await flush();

    await act(async () => { chooseButton().click(); });
    await flush();

    expect(pickBootSplash).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ bootSplashImage: uri });
  });

  it('shows "image set" + a Clear button once bootSplashImage is set; Clear patches it back to null', async () => {
    installPickBootSplashApi(null);
    const patch = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(<ThemePane s={{ ...defaultSettings, bootSplashImage: 'data:image/png;base64,AAAA' }} patch={patch} />);
    });
    await flush();

    const row = bootRow();
    expect(row.textContent).toMatch(/image set/);
    const clearBtn = Array.from(row.querySelectorAll('button')).find((b) => /Clear/.test(b.textContent ?? ''));
    if (!clearBtn) throw new Error('no Clear button once bootSplashImage is set');

    await act(async () => { (clearBtn as HTMLButtonElement).click(); });
    await flush();

    expect(patch).toHaveBeenCalledWith({ bootSplashImage: null });
  });
});

describe('SplashScreen — uses the custom boot splash image when set, falls back when null', () => {
  const quietSettings: AppSettings = { ...defaultSettings, soundEnabled: false, startupSoundEnabled: false };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    useSettings.setState({ settings: null });
  });

  it('falls back to the bundled boot-splash.jpg when settings.bootSplashImage is null', async () => {
    useSettings.setState({ settings: { ...quietSettings, bootSplashImage: null } });
    await act(async () => { root.render(<SplashScreen onDone={() => {}} />); });

    const el = container.querySelector('.ga98-splash') as HTMLElement;
    expect(el.style.background).toContain(splash);
  });

  it('uses settings.bootSplashImage as the background when set', async () => {
    const uri = 'data:image/png;base64,BBBB';
    useSettings.setState({ settings: { ...quietSettings, bootSplashImage: uri } });
    await act(async () => { root.render(<SplashScreen onDone={() => {}} />); });

    const el = container.querySelector('.ga98-splash') as HTMLElement;
    expect(el.style.background).toContain(uri);
    expect(el.style.background).not.toContain(splash);
  });
});

describe('LockScreen — uses the custom boot splash image when set, falls back when null', () => {
  beforeEach(() => {
    useAuth.setState({ status: { locked: true } as never });
    (globalThis as unknown as { window: { api: unknown } }).window.api = {
      bgconn: { status: vi.fn().mockResolvedValue([]), stop: vi.fn().mockResolvedValue(undefined) }
    };
  });

  afterEach(() => {
    useSettings.setState({ settings: null });
  });

  it('falls back to the bundled boot-splash.jpg when settings.bootSplashImage is null', async () => {
    useSettings.setState({ settings: { ...defaultSettings, bootSplashImage: null } });
    await act(async () => { root.render(<LockScreen />); });
    await flush();

    const el = container.querySelector('.ga98-lock-overlay') as HTMLElement;
    expect(el.style.background).toContain(splash);
  });

  it('uses settings.bootSplashImage as the background when set', async () => {
    const uri = 'data:image/png;base64,CCCC';
    useSettings.setState({ settings: { ...defaultSettings, bootSplashImage: uri } });
    await act(async () => { root.render(<LockScreen />); });
    await flush();

    const el = container.querySelector('.ga98-lock-overlay') as HTMLElement;
    expect(el.style.background).toContain(uri);
    expect(el.style.background).not.toContain(splash);
  });
});
