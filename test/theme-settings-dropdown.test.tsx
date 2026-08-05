// @vitest-environment jsdom
/**
 * QUIET AMETHYST — Settings theme dropdown (plan Task 6, Step 1).
 *
 * The theme picker is the ONLY user-facing control that flips `AppSettings.themeName` (App.tsx stamps
 * `data-ga98-theme` from it). This renders the REAL `ThemePane` (createRoot + act, no @testing-library),
 * and asserts:
 *   (1) a <select> bound to `themeName` lists exactly the registry's labels (Classic + QUIET AMETHYST);
 *   (2) its current value reflects `s.themeName`;
 *   (3) choosing an option calls `patch({ themeName: <id> })` — the persisted-settings round-trip.
 * Rendering the real component (not hand-authored markup) means deleting the <select> or unbinding it
 * breaks the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemePane } from '../src/renderer/modules/settings/SettingsModule';
import { THEMES } from '../src/renderer/styles/themes';
import { defaultSettings, type AppSettings } from '@shared/types';

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(s: AppSettings, patch: (p: Partial<AppSettings>) => Promise<void>): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<ThemePane s={s} patch={patch} />));
  return container;
}

/** The theme <select> is the one whose options match the THEMES registry ids. */
function themeSelect(c: HTMLElement): HTMLSelectElement {
  const sel = [...c.querySelectorAll('select')].find((el) => {
    const vals = [...el.options].map((o) => o.value);
    return THEMES.every((t) => vals.includes(t.id));
  });
  if (!sel) throw new Error('ThemePane renders no <select> bound to the theme registry');
  return sel as HTMLSelectElement;
}

describe('Settings theme dropdown', () => {
  it('lists every registered theme by label and reflects the current themeName', () => {
    const c = render({ ...defaultSettings, themeName: 'amethyst' }, vi.fn());
    const sel = themeSelect(c);
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Classic', 'QUIET AMETHYST']);
    expect([...sel.options].map((o) => o.value)).toEqual(['classic', 'amethyst']);
    expect(sel.value).toBe('amethyst');
  });

  it('defaults its value to classic when themeName is classic', () => {
    const c = render({ ...defaultSettings, themeName: 'classic' }, vi.fn());
    expect(themeSelect(c).value).toBe('classic');
  });

  it('patches themeName when a different theme is chosen', () => {
    const patch = vi.fn(() => Promise.resolve());
    const c = render({ ...defaultSettings, themeName: 'classic' }, patch);
    const sel = themeSelect(c);
    act(() => {
      sel.value = 'amethyst';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(patch).toHaveBeenCalledWith({ themeName: 'amethyst' });
  });
});
