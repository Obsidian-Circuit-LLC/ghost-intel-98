// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement; let root: Root;
const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({ title: o.id, located: 'geo', ...o } as GeoItem);
const item = mk({ id: 'T', sourceId: 'wt', title: 'Strike', category: 'chatter', link: 'https://ex.org/e', image: 'https://ex.org/p.jpg',
  detail: 'Missiles hit two districts. At least three were killed. Casualties unconfirmed.', hasMedia: true, isVideo: true, place: 'Mariupol', country: 'Ukraine' });

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as any).window.api = { geoint: { summarizeEvent: vi.fn(async () => ({ available: false, reason: 'Local AI model not available' })) } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); delete (globalThis as any).window.api; });

describe('Intel/Media contract', () => {
  it('all four tabs are live and no tab inlines remote media, on any tab', () => {
    act(() => root.render(
      <div className="ga98-window-shell" style={{ height: 600 }}><div className="window"><div className="window-body">
        <EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />
      </div></div></div>
    ));
    const panel = container.querySelector('.ga98-geo-details') as HTMLElement;
    expect(panel.classList.contains('window')).toBe(false);
    expect(panel.style.overflowY).toBe('auto');
    const tabButtons = Array.from(container.querySelectorAll('button')).filter((b) => /OVERVIEW|SOURCES|MEDIA|INTEL/.test(b.textContent ?? ''));
    expect(tabButtons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(tabButtons.some((b) => /· soon/.test(b.textContent ?? ''))).toBe(false);
    for (const re of [/MEDIA/, /INTEL/, /SOURCES/]) {
      const b = tabButtons.find((x) => re.test(x.textContent ?? ''))!;
      act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const remote = Array.from(panel.querySelectorAll('img,video')).filter((el) => /^https?:/i.test(el.getAttribute('src') ?? ''));
      expect(remote.length).toBe(0);
    }
  });
});
