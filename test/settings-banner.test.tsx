// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSettings } from '../src/shared/types';
import { SettingsModule } from '../src/renderer/modules/settings/SettingsModule';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    settings: {
      read: () => Promise.resolve(defaultSettings),
      update: (p: unknown) => Promise.resolve({ ...defaultSettings, ...(p as object) }),
      pickWallpaper: () => Promise.resolve(null)
    },
    system: {
      appInfo: () => Promise.resolve({ version: '0.0.0-test', userData: '/tmp/ga98-test', platform: 'linux' })
    }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); });

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('Settings banner', () => {
  it('renders the settings banner image as the first header element', async () => {
    await act(async () => { root.render(<SettingsModule />); });
    await flush();
    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/settings-banner/);
    expect(img!.getAttribute('alt')).toBe('Settings');
  });
});
