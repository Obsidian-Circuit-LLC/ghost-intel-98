// @vitest-environment jsdom
/**
 * Task J2 — X Listening Station "Enterprise dark-console" shell (GI98 reskin).
 *
 * Proves the reskinned outer frame renders GhostExodus's CYBERVS DOMINATVS layout in GI98 tokens:
 * a LEFT SIDEBAR (brand block → ACTIVE CAMPAIGN dock → count-badged nav → Tor box → session box)
 * and a RIGHT column (masthead banner → topbar eyebrow/title/actions → notice → the Phase-1..3 tab
 * body). Every assertion drives the REAL rendered module against a stubbed `window.api.xListening`,
 * with seeded counts so a nav badge is shown to reflect real loaded state (not a fabricated figure).
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency). jsdom cannot resolve
 * `var()` colours — the colour verification is the headless-Chrome screenshot + the rendered-contrast
 * oracle; here we assert STRUCTURE renders identically under both `data-ga98-theme` values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

const CAMP_A = { id: 'camp-a', name: 'Primary Investigation', createdAt: 1, updatedAt: 1 };
const CAMP_B = { id: 'camp-b', name: 'Secondary Watch', createdAt: 2, updatedAt: 2 };

// Seeded counts the sidebar nav badges must reflect.
const POSTS = Array.from({ length: 4 }, (_, i) => ({
  id: `p${i}`,
  channelId: 'kittytreats',
  channelLabel: '@kittytreats',
  authorHandle: 'kittytreats',
  text: `post ${i}`,
  publishedAt: '2026-08-12T10:00:00.000Z',
  url: 'https://x.com/kittytreats/status/1',
  kind: 'post' as const,
}));
const ENTITIES = Array.from({ length: 7 }, (_, i) => ({
  id: `e${i}`,
  type: 'mention',
  value: `@user${i}`,
  count: 1,
  sourceUsernames: ['kittytreats'],
  firstObservedAt: '2026-08-12T10:00:00.000Z',
  lastObservedAt: '2026-08-12T10:00:00.000Z',
}));
const PRESETS = [
  { id: 'pr1', name: 'Ransomware terms', keywords: ['x'], mode: 'any', caseSensitive: false, profileIds: [], enabled: true },
  { id: 'pr2', name: 'News alerts', keywords: ['y'], mode: 'any', caseSensitive: false, profileIds: [], enabled: true },
];

function makeApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A, CAMP_B]),
      campaignsCreate: vi.fn(async (name: string) => ({ id: 'camp-new', name, createdAt: 3, updatedAt: 3 })),
      campaignsSwitch: vi.fn(async (id: string) => ({ ...(id === CAMP_A.id ? CAMP_A : CAMP_B) })),
      campaignsUpdate: vi.fn(async (req: { id: string; name: string }) => ({ id: req.id, name: req.name, createdAt: 1, updatedAt: 4 })),
      campaignsDelete: vi.fn(async () => undefined),
      campaignsDuplicate: vi.fn(async () => CAMP_A),
      campaignsMeta: vi.fn(async () => ({ [CAMP_A.id]: { purpose: 'Migrated/default investigation workspace', description: '' } })),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => POSTS),
      analysis: vi.fn(async () => ({ commonIdentityCount: 9 })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => ENTITIES),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [{ id: 'n1', findingId: 'p0', text: 'note', updatedAt: 1 }] })),
      archiveStatus: vi.fn(async () => null),
      presetsRead: vi.fn(async () => ({ presets: PRESETS })),
      collectionSettingsRead: vi.fn(async () => ({})),
      imagePolicyRead: vi.fn(async () => ({ modes: {}, retrieveImages: true })),
      scheduleStatus: vi.fn(async () => null),
    },
  };
}

function setSettings(): void {
  useSettings.setState({ settings: { ...defaultSettings } });
}

describe('X Listening Station — Enterprise console shell (Task J2)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    (globalThis as any).window.api = api;
    setSettings();
    document.documentElement.removeAttribute('data-ga98-theme');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    document.documentElement.removeAttribute('data-ga98-theme');
    useSettings.setState({ settings: null });
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => { root.render(<XListeningModule />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  }

  it('renders the left sidebar: brand block, campaign dock, count-badged nav, Tor box, session box', async () => {
    await mount();

    const sidebar = container.querySelector('.xls-sidebar');
    expect(sidebar).toBeTruthy();

    // Brand block — CD seal + wordmark + GhostExodus credit.
    expect(container.querySelector('.xls-seal')?.textContent).toBe('CD');
    const brand = container.querySelector('.xls-brand-text');
    expect(brand?.textContent).toMatch(/CYBERVS DOMINATVS/);
    expect(brand?.textContent).toMatch(/X LISTENING STATION/);
    expect(brand?.textContent).toMatch(/by GhostExodus/);

    // Campaign dock — ACTIVE CAMPAIGN eyebrow + select + purpose line + +NEW / EDIT / MANAGE.
    const dock = container.querySelector('.xls-campaign-dock');
    expect(dock).toBeTruthy();
    expect(dock?.querySelector('.xls-dock-eyebrow')?.textContent).toMatch(/ACTIVE CAMPAIGN/);
    expect(container.querySelector('[aria-label="Active campaign"]')).toBeTruthy();
    expect(dock?.querySelector('.xls-dock-purpose')?.textContent).toMatch(/Migrated\/default investigation workspace/);
    const dockButtons = Array.from(dock!.querySelectorAll('button')).map((b) => b.textContent);
    expect(dockButtons).toEqual(['+ NEW', 'EDIT', 'MANAGE']);

    // Nav — all 11 tabs as count-badged rows, each keyed by data-tab.
    const nav = container.querySelector('.xls-nav');
    const navButtons = Array.from(nav!.querySelectorAll('.xls-tab'));
    expect(navButtons.length).toBe(11);
    expect(navButtons.map((b) => b.getAttribute('data-tab'))).toEqual([
      'dashboard', 'live', 'sources', 'network', 'entities', 'changes',
      'search', 'notes', 'exports', 'campaigns', 'system',
    ]);
    // Enterprise labels are shown (not the bare tab id).
    expect(nav?.textContent).toMatch(/COMMAND BOARD/);
    expect(nav?.textContent).toMatch(/FOLLOWER NETWORK/);
    expect(nav?.textContent).toMatch(/ANALYST NOTES/);

    // Tor box (carries the GI98 clearnet hardening control) + session box.
    expect(container.querySelector('.xls-tor-box')).toBeTruthy();
    expect(container.querySelector('.xls-tor-box input[type="checkbox"]')).toBeTruthy();
    expect(container.querySelector('.xls-markers .xls-marker')?.textContent).toBe('TOR');
    const session = container.querySelector('.xls-session-box');
    expect(session?.textContent).toMatch(/X SESSION ONLINE/);
    expect(session?.textContent).toMatch(/Primary Investigation/);
  });

  it('a nav badge reflects the seeded count (LIVE FEED = posts, ENTITY INDEX = entities, SEARCH = presets, ANALYST NOTES = notes)', async () => {
    await mount();
    const badgeFor = (tab: string): string | undefined =>
      container.querySelector(`.xls-tab[data-tab="${tab}"] .xls-nav-badge`)?.textContent ?? undefined;

    expect(badgeFor('live')).toBe('4');        // POSTS.length
    expect(badgeFor('entities')).toBe('7');    // ENTITIES.length
    expect(badgeFor('search')).toBe('2');      // PRESETS.length
    expect(badgeFor('notes')).toBe('1');       // notes.length
    expect(badgeFor('network')).toBe('9');     // analysis.commonIdentityCount
    expect(badgeFor('campaigns')).toBe('2');   // campaigns.length
    // Tabs with no meaningful count carry no badge.
    expect(container.querySelector('.xls-tab[data-tab="dashboard"] .xls-nav-badge')).toBeFalsy();
    expect(container.querySelector('.xls-tab[data-tab="exports"] .xls-nav-badge')).toBeFalsy();
  });

  it('renders the right column: masthead banner, topbar (eyebrow + active tab title + actions), notice, tab body', async () => {
    await mount();

    const main = container.querySelector('.xls-main');
    expect(main).toBeTruthy();
    // Masthead banner (shared ModuleBanner ambient-bleed wrapper + the CYBERVS art).
    expect(main?.querySelector('.ga98-module-banner-wrap')).toBeTruthy();
    expect(main?.querySelector('img.ga98-module-banner')?.getAttribute('alt')).toBe('CYBERVS DOMINATVS');

    // Topbar eyebrow + active-tab title (COMMAND BOARD on the default dashboard tab) + actions.
    const topbar = container.querySelector('.xls-topbar');
    expect(topbar?.querySelector('.xls-eyebrow')?.textContent).toMatch(/ENTERPRISE v3\.4\.1/);
    expect(topbar?.querySelector('.xls-topbar-title')?.textContent).toBe('COMMAND BOARD');
    expect(topbar?.querySelector('.xls-topbar-context')?.textContent).toMatch(/ACTIVE CAMPAIGN: Primary Investigation/);
    const actionLabels = Array.from(topbar!.querySelectorAll('.xls-topbar-actions button')).map((b) => b.textContent);
    expect(actionLabels).toEqual(['IMAGES: ON', 'SESSION CONNECTED', 'RUN SWEEP']);

    // Notice bar + the Phase-1..3 tab body still render inside the new shell.
    expect(main?.querySelector('.xls-notice')).toBeTruthy();
    expect(main?.querySelector('.xls-body .xls-stat-grid')).toBeTruthy();
  });

  it('the topbar title tracks the active tab (COMMAND BOARD → LIVE FEED on selecting Live)', async () => {
    await mount();
    const liveNav = container.querySelector('.xls-tab[data-tab="live"]') as HTMLButtonElement;
    await act(async () => { liveNav.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.xls-topbar-title')?.textContent).toBe('LIVE FEED');
    expect(liveNav.className).toContain('xls-tab-active');
  });

  it('renders the same shell structure under BOTH themes (classic + amethyst data-ga98-theme)', async () => {
    // classic (no attribute)
    await mount();
    const classicShell =
      !!container.querySelector('.xls-sidebar') &&
      !!container.querySelector('.xls-main .ga98-module-banner-wrap') &&
      container.querySelectorAll('.xls-nav .xls-tab').length === 11;
    expect(classicShell).toBe(true);

    // amethyst — the viewer's theme toggle stamps data-ga98-theme; the structure is identical.
    document.documentElement.setAttribute('data-ga98-theme', 'amethyst');
    await act(async () => { await Promise.resolve(); });
    const amethystShell =
      !!container.querySelector('.xls-sidebar') &&
      !!container.querySelector('.xls-main .ga98-module-banner-wrap') &&
      container.querySelectorAll('.xls-nav .xls-tab').length === 11 &&
      container.querySelector('.xls-tab[data-tab="live"] .xls-nav-badge')?.textContent === '4';
    expect(amethystShell).toBe(true);
  });
});
