// @vitest-environment jsdom
/**
 * The logon screen, redesigned to GhostExodus's mockup: a classic Win98 Logon dialog.
 *
 * Structure is asserted because the dialog carries the ONLY way into the app. A refactor that
 * quietly drops the recovery-key route locks out anyone who has lost their master password, and
 * their vault is not recoverable by any other means — so "the button exists and switches the form"
 * is a safety property here, not a cosmetic one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LockScreen } from '../src/renderer/shell/LockScreen';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const text = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');

beforeEach(() => {
  (globalThis as any).window.api = {
    bgconn: { status: vi.fn(async () => ({ connections: [] })) },
    auth: { status: vi.fn(async () => ({ enabled: true, unlocked: false })), unlock: vi.fn() },
  };
  useSettings.setState({ settings: { ...defaultSettings } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as any).window.api;
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () => { root.render(<LockScreen />); });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}

describe('Ghost Intel 98 — Logon', () => {
  it('is titled as a Logon dialog', async () => {
    await mount();
    expect(container.querySelector('.title-bar-text')?.textContent).toBe('Ghost Intel 98 - Logon');
  });

  it('prompts for the master password, in the mockup wording', async () => {
    await mount();
    expect(text()).toContain('Enter your master password');
    expect(text()).toContain('to log on to Ghost Intel 98.');
    expect(container.querySelector('label')?.textContent).toBe('Password:');
    expect(container.querySelector('input')?.getAttribute('type')).toBe('password');
  });

  it('offers OK, Cancel and the recovery-key route', async () => {
    await mount();
    const labels = buttons();
    expect(labels).toContain('OK');
    expect(labels).toContain('Cancel');
    expect(labels).toContain('Use recovery key…');
    // OK is the default action, as a Win98 dialog marks it.
    expect(container.querySelector('button.default')?.textContent).toBe('OK');
  });

  it('switches to the recovery key and back — the only route in without the password', async () => {
    await mount();
    const recovery = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Use recovery key'))!;
    await act(async () => { recovery.click(); });

    expect(container.querySelector('label')?.textContent).toBe('Recovery key:');
    // A recovery key is transcribed by eye, so it must NOT be masked.
    expect(container.querySelector('input')?.getAttribute('type')).toBe('text');
    expect(text()).toContain('Enter your recovery key');

    const back = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Use password'))!;
    await act(async () => { back.click(); });
    expect(container.querySelector('label')?.textContent).toBe('Password:');
  });

  it('will not submit an empty password', async () => {
    await mount();
    const ok = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'OK') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
  });
});
