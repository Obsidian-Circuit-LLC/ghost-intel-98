// @vitest-environment jsdom
/**
 * MONITORED SITUATIONS — the "×" must actually remove the row.
 *
 * FIELD BUG (GhostExodus, 2026-08-20): "the (x) in the monitored situations does not function."
 *
 * The button was wired correctly; the LIST was not. Rows qualify by
 *
 *     corroboration count >= 1   OR   pinned
 *
 * and "×" only un-pinned. Every row in his screenshot shows "×1" — i.e. they are all there by
 * CORROBORATION — so un-pinning changed nothing and the row stayed exactly where it was. The button
 * can never work for a corroborated item, which is nearly all of them.
 *
 * "Remove from monitor" has to mean "stop showing me this", whatever qualified it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandRail, type CommandRailProps } from '../src/renderer/modules/geoint/CommandRail';
import type { GeoItem } from '../src/shared/post-mvp-types';

vi.mock('maplibre-gl', () => ({ default: {} }));
vi.mock('../src/renderer/modules/geoint/MapGL', () => ({ MapGL: () => null, validCoord: () => true }));

let container: HTMLDivElement;
let root: Root;

const item = (id: string, title: string): GeoItem => ({
  id, sourceId: 'rss:bbc', title, link: `https://example.org/${id}`,
  located: 'geo', lat: 51.5, lon: -0.1, category: 'politics', severity: 'medium',
} as GeoItem);

const CORROBORATED = item('bbc:1', 'Cambridge chancellor criticises');
const PINNED_ONLY = item('bbc:2', 'Somali man charged with');

function props(over: Partial<CommandRailProps> = {}): CommandRailProps {
  return {
    visibleItems: [CORROBORATED, PINNED_ONLY],
    // CORROBORATED qualifies on its own; PINNED_ONLY has no agreement.
    corroboration: new Map([[CORROBORATED.id, 1]]),
    onFocus: vi.fn(),
    categoryFilter: new Set(['politics']),
    onToggleCategory: vi.fn(),
    basemap: 'street',
    onBasemap: vi.fn(),
    labels: false,
    onLabels: vi.fn(),
    net: true,
    items: [CORROBORATED, PINNED_ONLY],
    pinned: new Set([PINNED_ONLY.id]),
    onAddMonitor: vi.fn(),
    onRemoveMonitor: vi.fn(),
    ...over,
  } as CommandRailProps;
}

function rows(): HTMLElement[] {
  const legend = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (el) => /^Monitored Situations \(/.test(el.textContent || '') && el.children.length === 0,
  );
  const panel = legend?.parentElement;
  return Array.from(panel?.querySelectorAll('li') ?? []);
}

async function mount(p: Partial<CommandRailProps> = {}) {
  await act(async () => { root.render(<CommandRail {...props(p)} />); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Monitored Situations — removing a row', () => {
  it('lists both a corroborated and a pinned situation', async () => {
    await mount();
    expect(rows()).toHaveLength(2);
  });

  it('REMOVES a CORROBORATED row when its × is pressed — the field bug', async () => {
    const onRemoveMonitor = vi.fn();
    await mount({ onRemoveMonitor });
    const row = rows().find((li) => (li.textContent || '').includes('Cambridge'))!;
    const x = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '×')!;
    await act(async () => { x.click(); });
    expect(onRemoveMonitor).toHaveBeenCalledWith(CORROBORATED.id);
    expect(rows().some((li) => (li.textContent || '').includes('Cambridge'))).toBe(false);
  });

  it('REMOVES a pinned row too', async () => {
    await mount();
    const row = rows().find((li) => (li.textContent || '').includes('Somali'))!;
    const x = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '×')!;
    await act(async () => { x.click(); });
    expect(rows().some((li) => (li.textContent || '').includes('Somali'))).toBe(false);
  });

  it('keeps the other rows — × removes one situation, not the panel', async () => {
    await mount();
    const row = rows().find((li) => (li.textContent || '').includes('Cambridge'))!;
    const x = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '×')!;
    await act(async () => { x.click(); });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Somali');
  });

  it('does not fly to the item when × is pressed (the click must not fall through)', async () => {
    const onFocus = vi.fn();
    await mount({ onFocus });
    const row = rows()[0]!;
    const x = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '×')!;
    await act(async () => { x.click(); });
    expect(onFocus).not.toHaveBeenCalled();
  });
});
