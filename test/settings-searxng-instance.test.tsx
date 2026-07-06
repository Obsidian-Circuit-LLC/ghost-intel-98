// @vitest-environment jsdom
/**
 * Settings → Q pane: the SearXNG instance editor (v3.31.0 follow-up — the multi-engine picker shipped
 * with ai.searxngOnion settable only in the settings file; this surfaces it in the UI). Asserts the
 * field reflects + patches ai.searxngOnion, Reset restores the bundled default, and a non-onion value
 * warns (mirroring main's fail-closed .onion enforcement) while an onion value does not.
 *
 * No @testing-library — React 18 createRoot inside act() against jsdom. LocalAiPane + window.api.memory
 * (AiPane's mount effects) are stubbed; only the SearXNG field is exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSettings } from '@shared/types';
import type { AppSettings } from '@shared/types';

vi.mock('../src/renderer/modules/settings/LocalAiPane', () => ({ LocalAiPane: () => null }));

import { AiPane } from '../src/renderer/modules/settings/SettingsModule';

let container: HTMLDivElement;
let root: Root;

function installApi(): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    memory: {
      status: vi.fn().mockResolvedValue(null),
      onProgress: vi.fn().mockReturnValue(() => {}),
      embedHealth: vi.fn().mockResolvedValue(null)
    }
  };
}

function settingsWith(searxngOnion: string): AppSettings {
  return { ...defaultSettings, ai: { ...defaultSettings.ai, searxngOnion } };
}

function fireInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('AiPane — SearXNG instance editor', () => {
  it('renders the current searxngOnion and patches ai.searxngOnion on edit', () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    act(() => { root.render(<AiPane s={settingsWith('http://abc.onion')} patch={patch} />); });
    const input = [...container.querySelectorAll('input')].find((i) => (i as HTMLInputElement).value === 'http://abc.onion') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireInput(input, 'http://xyz.onion');
    expect(patch).toHaveBeenCalledWith({ ai: expect.objectContaining({ searxngOnion: 'http://xyz.onion' }) });
  });

  it('Reset restores the bundled default onion', () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    act(() => { root.render(<AiPane s={settingsWith('http://custom.onion')} patch={patch} />); });
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    act(() => { btn.click(); });
    expect(patch).toHaveBeenCalledWith({ ai: expect.objectContaining({ searxngOnion: defaultSettings.ai.searxngOnion }) });
  });

  it('warns for a non-onion instance and stays quiet for an onion one', () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    act(() => { root.render(<AiPane s={settingsWith('https://searx.example.com')} patch={patch} />); });
    expect(container.textContent).toMatch(/must be a \.onion/i);
    act(() => { root.render(<AiPane s={settingsWith(defaultSettings.ai.searxngOnion)} patch={patch} />); });
    expect(container.textContent).not.toMatch(/must be a \.onion/i);
  });
});
