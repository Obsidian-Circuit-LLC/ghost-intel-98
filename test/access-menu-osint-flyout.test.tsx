// @vitest-environment jsdom
/**
 * T2: Access-menu OSINT Toolkit flyout.
 *
 * The Access menu used to (a) list the OSINT modules (eyespy/geoint/searchlight/socmint/…) as
 * flat shortcut rows AND (b) pin a single "OSINT Toolkit" launcher. This consolidates: the OSINT
 * modules no longer appear as flat rows, and the "OSINT Toolkit" entry becomes a ONE-hop flyout
 * submenu (cloned from the existing Games submenu) that groups the OSINT tools by subcategory —
 * exactly the grouping produced by buildOsintDirectory(listModules()) — with one clickable row per
 * tool that launches that module immediately.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), against a
 * jsdom container, mirroring hostinfo-states.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessMenu } from '../src/renderer/shell/AccessMenu';
import { useSettings, useWindows } from '../src/renderer/state/store';
import { _resetRegistryForTest, listModules, registerModule } from '../src/renderer/state/registry';
import { buildOsintDirectory } from '../src/renderer/modules/osint-toolkit/directory';
import { defaultSettings, type AccessShortcut } from '@shared/types';

/** Minimal registry — avoids pulling the whole builtin module tree (pdfjs/canvas) into jsdom.
 *  Covers several subcategories so the flyout ordering is exercised via buildOsintDirectory. */
const Dummy = (): null => null;
function registerFixtureModules(): void {
  registerModule({ key: 'cases', title: 'My Cases', glyph: '📁', component: Dummy, builtin: true });
  registerModule({ key: 'searchlight', title: 'Searchlight', glyph: '🔎', component: Dummy, builtin: true, category: 'osint', subcategory: 'Identity' });
  registerModule({ key: 'geoint', title: 'GeoINT', glyph: '🌍', component: Dummy, builtin: true, category: 'osint', subcategory: 'Geospatial' });
  registerModule({ key: 'eyespy', title: 'EyeSpy', glyph: '📷', component: Dummy, builtin: true, category: 'osint', subcategory: 'Geospatial' });
  registerModule({ key: 'socmint', title: 'SOCMINT', glyph: '📡', component: Dummy, builtin: true, category: 'osint', subcategory: 'Social Media' });
  registerModule({ key: 'host-info', title: 'Host Info', glyph: '🖥', component: Dummy, builtin: true, category: 'osint', subcategory: 'Network / Recon' });
  registerModule({ key: 'osint-toolkit', title: 'OSINT Toolkit', glyph: '🧰', component: Dummy, builtin: true });
}

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.fn>;
const onClose = vi.fn();

/** Flat osint targets that used to render as rows — they must be gone from the flat list. */
const OSINT_FLAT_SHORTCUTS: AccessShortcut[] = [
  { id: 'sl', label: 'Searchlight', kind: 'module', target: 'searchlight' },
  { id: 'gi', label: 'GeoINT', kind: 'module', target: 'geoint' },
  { id: 'es', label: 'EyeSpy', kind: 'module', target: 'eyespy' }
];
const NONOSINT_SHORTCUT: AccessShortcut = { id: 'cases', label: 'My Cases', kind: 'module', target: 'cases' };

beforeEach(() => {
  _resetRegistryForTest();
  registerFixtureModules();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  openSpy = vi.fn();
  useWindows.setState({ open: openSpy });
  useSettings.setState({
    settings: {
      ...defaultSettings,
      soundEnabled: false,
      shortcuts: [NONOSINT_SHORTCUT, ...OSINT_FLAT_SHORTCUTS]
    }
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

describe('Access menu — OSINT Toolkit flyout (T2)', () => {
  it('drops the OSINT modules from the flat shortcut list', () => {
    render();
    const text = container.textContent ?? '';
    // Non-OSINT shortcut still there.
    expect(text).toContain('My Cases');
    // OSINT modules gone from the flat list (flyout is closed, so they must not appear at all yet).
    expect(text).not.toContain('Searchlight');
    expect(text).not.toContain('GeoINT');
    expect(text).not.toContain('EyeSpy');
  });

  it('renders the OSINT flyout with a grouped heading per subcategory and a row per tool, in buildOsintDirectory order', () => {
    render();
    click(findByHaspopup('OSINT Toolkit'));

    const dir = buildOsintDirectory(listModules());
    expect(dir.length).toBeGreaterThan(0);

    const headings = [...container.querySelectorAll('.ga98-access-osint-group')].map((n) => n.textContent);
    expect(headings).toEqual(dir.map((g) => g.subcategory));

    const rowKeys = [...container.querySelectorAll('[data-osint-key]')].map((n) => n.getAttribute('data-osint-key'));
    expect(rowKeys).toEqual(dir.flatMap((g) => g.tools.map((t) => t.key)));
  });

  it('anchors the flyout to grow UPWARD (bottom-anchored) so its lower groups stay on-screen', () => {
    render();
    click(findByHaspopup('OSINT Toolkit'));
    // The Access menu is bottom-anchored near the taskbar; this flyout is tall (headings + up to 10
    // rows), so it must open upward (bottom:0), not downward from top:0 which would push its lower
    // groups off the bottom of the screen and make them unclickable.
    const panel = (container.querySelector('[data-osint-key]')?.closest('[role="menu"]')) as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.style.bottom).toBe('0px');
    expect(panel!.style.top).not.toBe('0px');
  });

  it('launches the module when a tool row is clicked', () => {
    render();
    click(findByHaspopup('OSINT Toolkit'));

    const row = container.querySelector('[data-osint-key]') as HTMLElement | null;
    expect(row).not.toBeNull();
    const key = row!.getAttribute('data-osint-key');
    click(row!);

    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ module: key }));
    expect(onClose).toHaveBeenCalled();
  });
});
