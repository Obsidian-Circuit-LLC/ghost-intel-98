// @vitest-environment jsdom
/**
 * T1: Access menu categorization.
 *
 * The Access menu used to drive a flat list of rows from `settings.shortcuts`. This restructures
 * it into five fixed category flyouts (Programs / Creativity / Music / Network / Organization),
 * alongside the existing Games and OSINT Toolkit flyouts, with an RTFM entry added to the footer
 * immediately below Settings. The `settings.shortcuts` flat list no longer renders at all (the
 * setting field itself stays in the schema — see @shared/types — this only changes what the menu
 * renders).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * test/access-menu-osint-flyout.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessMenu } from '../src/renderer/shell/AccessMenu';
import { useSettings, useWindows } from '../src/renderer/state/store';
import { _resetRegistryForTest, registerModule } from '../src/renderer/state/registry';
import { defaultSettings, type AccessShortcut } from '@shared/types';

const Dummy = (): null => null;
function registerFixtureModules(): void {
  registerModule({ key: 'cases', title: 'My Cases', glyph: '📁', component: Dummy, builtin: true });
  registerModule({ key: 'notepad', title: 'Notepad 98', glyph: '📝', component: Dummy, builtin: true });
  registerModule({ key: 'briefcase', title: 'Briefcase', glyph: '💼', component: Dummy, builtin: true });
  registerModule({ key: 'markets', title: 'Markets', glyph: '📈', component: Dummy, builtin: true });
  registerModule({ key: 'search', title: 'Search', glyph: '🔍', component: Dummy, builtin: true });
  registerModule({ key: 'ai-assistant', title: 'Q', glyph: '🤖', component: Dummy, builtin: true });
  registerModule({ key: 'journal', title: 'Journal Jots', glyph: '📔', component: Dummy, builtin: true });
  registerModule({ key: 'media-player', title: 'Jukebox', glyph: '🎵', component: Dummy, builtin: true });
  registerModule({ key: 'dialterm', title: 'DialTerm', glyph: '☎', component: Dummy, builtin: true });
  registerModule({ key: 'mail', title: 'Mail', glyph: '✉', component: Dummy, builtin: true });
  registerModule({ key: 'chat', title: 'Chat (beta)', glyph: '💬', component: Dummy, builtin: true });
  registerModule({ key: 'bookmarks', title: 'Bookmarks', glyph: '🔖', component: Dummy, builtin: true });
  registerModule({ key: 'invoices', title: 'Invoices', glyph: '🧾', component: Dummy, builtin: true });
  registerModule({ key: 'calendar', title: 'Calendar', glyph: '📅', component: Dummy, builtin: true });
  registerModule({ key: 'reminders', title: 'Reminders', glyph: '⏰', component: Dummy, builtin: true });
  registerModule({ key: 'alarm', title: 'Alarm', glyph: '⏲', component: Dummy, builtin: true });
  registerModule({ key: 'solitaire', title: 'Solitaire', glyph: '🃏', component: Dummy, builtin: true });
  registerModule({ key: 'minesweeper', title: 'Mine Detector', glyph: '💣', component: Dummy, builtin: true });
  registerModule({ key: 'chess', title: 'Chess', glyph: '♟', component: Dummy, builtin: true });
  registerModule({ key: 'pinball', title: 'Ghost Space Ball', glyph: '🕹', component: Dummy, builtin: true });
  registerModule({ key: 'osint-toolkit', title: 'OSINT Toolkit', glyph: '🧰', component: Dummy, builtin: true });
  registerModule({ key: 'searchlight', title: 'Searchlight', glyph: '🔎', component: Dummy, builtin: true, category: 'osint', subcategory: 'Identity' });
}

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.fn>;
const onClose = vi.fn();

const LEGACY_SHORTCUTS: AccessShortcut[] = [
  { id: 'cases', label: 'My Cases', kind: 'module', target: 'cases' },
  { id: 'sl', label: 'Searchlight', kind: 'module', target: 'searchlight' }
];

beforeEach(() => {
  _resetRegistryForTest();
  registerFixtureModules();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  openSpy = vi.fn();
  useWindows.setState({ open: openSpy });
  useSettings.setState({
    settings: { ...defaultSettings, soundEnabled: false, shortcuts: LEGACY_SHORTCUTS }
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  _resetRegistryForTest();
  onClose.mockReset();
  vi.restoreAllMocks();
});

function render(): void {
  act(() => root.render(<AccessMenu onClose={onClose} />));
}

function labels(): string[] {
  return Array.from(container.querySelectorAll('.ga98-access-entry')).map((e) => e.textContent || '');
}

function findByHaspopup(label: string): HTMLElement {
  const el = [...container.querySelectorAll('[aria-haspopup="true"]')].find((n) =>
    n.textContent?.includes(label)
  );
  if (!el) throw new Error(`no aria-haspopup trigger containing "${label}"`);
  return el as HTMLElement;
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('AccessMenu categories', () => {
  it('renders the five category flyouts + Games + OSINT Toolkit and the footer, RTFM below Settings', () => {
    render();
    const text = labels().join('|');
    for (const cat of ['Programs', 'Creativity', 'Music', 'Network', 'Organizer', 'Games', 'OSINT Toolkit', 'Settings', 'RTFM', 'Shut Down']) {
      expect(text).toContain(cat);
    }
    const order = labels();
    expect(order.findIndex((l) => /RTFM/.test(l))).toBeGreaterThan(order.findIndex((l) => /Settings/.test(l)));
  });

  it('does not render the legacy settings.shortcuts flat list at all', () => {
    render();
    // Closed-menu text must not leak "My Cases" (it now lives inside the closed Programs flyout,
    // not as a flat row) — the old flat-list behaviour rendered it directly.
    const text = container.textContent ?? '';
    expect(text).not.toContain('My Cases');
  });

  it('opening Programs and clicking My Cases opens the cases module', () => {
    render();
    click(findByHaspopup('Programs'));
    const row = [...container.querySelectorAll('.ga98-access-entry')].find((n) => /My Cases/.test(n.textContent || ''));
    expect(row).toBeTruthy();
    click(row as HTMLElement);
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ module: 'cases' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking RTFM opens the help module titled RTFM', () => {
    render();
    const row = [...container.querySelectorAll('.ga98-access-entry')].find((n) => /^RTFM$|❔RTFM/.test(n.textContent || ''));
    expect(row).toBeTruthy();
    click(row as HTMLElement);
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ module: 'help', title: 'RTFM' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('OSINT Toolkit is listed above Games', () => {
    render();
    const order = labels();
    expect(order.findIndex((l) => /OSINT Toolkit/.test(l))).toBeLessThan(order.findIndex((l) => /Games/.test(l)));
  });

  it('has an Organizer category containing Number Muncher', () => {
    render();
    const t = Array.from(container.querySelectorAll('.ga98-access-entry')).map((e) => e.textContent || '').join('|');
    expect(t).toContain('Organizer');
    expect(t).not.toMatch(/\bOrganization\b/);
  });
});
