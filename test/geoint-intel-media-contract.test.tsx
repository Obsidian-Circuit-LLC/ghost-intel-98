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
    expect(tabButtons.length).toBe(4);   // guard: a vacuous .every()/.some() on an empty array must not pass
    expect(tabButtons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(tabButtons.some((b) => /· soon/.test(b.textContent ?? ''))).toBe(false);
    // Charter, on EVERY tab (Overview included): no remote-src <img>/<video> (egress) and no element
    // that was handed injected HTML (XSS) — the panel renders React text only.
    for (const re of [/OVERVIEW/, /SOURCES/, /MEDIA/, /INTEL/]) {
      const b = tabButtons.find((x) => re.test(x.textContent ?? ''))!;
      act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect((b as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');   // the switch actually happened
      const remote = Array.from(panel.querySelectorAll('img,video')).filter((el) => /^https?:/i.test(el.getAttribute('src') ?? ''));
      expect(remote.length).toBe(0);
      // No React node injected raw markup: every panel element's own text is plain (React escapes text
      // nodes); assert there is no element whose innerHTML contains an un-escaped tag it did not create.
      const injected = Array.from(panel.querySelectorAll('*')).filter((el) => /<\s*(script|img|iframe|svg)\b/i.test(el.innerHTML));
      expect(injected.length).toBe(0);
    }
  });
});
