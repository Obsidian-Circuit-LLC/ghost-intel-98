// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;
const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem =>
  ({ title: o.id, located: 'geo', ...o } as GeoItem);
const target = mk({ id: 'T', sourceId: 'wt', title: 'STRIKE', category: 'chatter', lat: 50, lon: 30, country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });
const many = Array.from({ length: 40 }, (_, n) => mk({ id: `S${n}`, sourceId: `s${n}`, title: `report ${n}`, lat: 50.01, lon: 30.01, published: '2026-07-30T10:00:00Z' }));

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('SOURCES tab — scroll-container contract', () => {
  it('renders the panel as a scroll-auto .ga98-geo-details root (not a .window), with SOURCES inside it', () => {
    act(() => root.render(
      <div className="ga98-window-shell" style={{ height: 600 }}>
        <div className="window"><div className="window-body">
          <EventDetailsPanel item={target} allItems={[target, ...many]}
            sources={many.map((m) => ({ id: m.sourceId, label: m.sourceId }))}
            onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />
        </div></div>
      </div>
    ));
    const panel = container.querySelector('.ga98-geo-details') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('window')).toBe(false);
    expect(panel.style.overflowY).toBe('auto');
    // switch to SOURCES and confirm its content is a descendant of the scroll-auto root
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /SOURCES/i.test(b.textContent ?? ''))!;
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const src = Array.from(panel.querySelectorAll<HTMLElement>('*')).find((el) => /SOURCES \(/i.test(el.textContent ?? ''));
    expect(src).toBeTruthy();
  });
});
