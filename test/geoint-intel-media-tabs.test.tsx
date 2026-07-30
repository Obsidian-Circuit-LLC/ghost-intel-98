// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement; let root: Root;
const render = (el: React.ReactElement): void => { act(() => root.render(el)); };
const clickButton = (re: RegExp): void => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button ${re}`);
  act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const hasText = (re: RegExp): boolean =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).some((el) => el.children.length === 0 && re.test(el.textContent ?? ''));
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({ title: o.id, located: 'geo', ...o } as GeoItem);
const item = mk({ id: 'T', sourceId: 'wt', title: 'Strike near Mariupol', category: 'chatter', link: 'https://ex.org/e',
  // image is a REMOTE URL: the fixture carries it so the no-remote-media assertion actually bites — a
  // regression that renders <img src={item.image}> would beacon out and MUST fail this test.
  image: 'https://ex.org/p.jpg',
  detail: 'Missiles hit two districts near Mariupol. At least three people were killed. Casualties remain unconfirmed.',
  hasMedia: true, isVideo: true, place: 'Mariupol', country: 'Ukraine' });

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as any).window.api = { geoint: { summarizeEvent: vi.fn(async () => ({ available: true, text: 'Two districts were struck; details unconfirmed.' })) } };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); delete (globalThis as any).window.api; });

describe('EventDetailsPanel — MEDIA + INTEL tabs', () => {
  it('MEDIA shows a reported-media affordance and NEVER an inline remote <img>/<video>', () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/MEDIA/i);
    expect(hasText(/Media reported/i)).toBe(true);
    const remote = Array.from(container.querySelectorAll('img,video')).filter((el) => /^https?:/i.test(el.getAttribute('src') ?? ''));
    expect(remote.length).toBe(0);
  });

  it('INTEL renders deterministic entities + casualty QUOTES (never a synthesized number)', () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    expect(hasText(/Mariupol/)).toBe(true);                                   // place entity
    expect(hasText(/At least three people were killed\./)).toBe(true);        // verbatim quote
    expect(hasText(/extracted · unverified/i)).toBe(true);
  });

  it('INTEL shows the AI summary under an "AI · unverified" stamp when a model is available', async () => {
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    await flush();
    expect(hasText(/AI · unverified/i)).toBe(true);
    expect(hasText(/Two districts were struck/)).toBe(true);
  });

  it('INTEL degrades gracefully when no local model — entities still render', async () => {
    (globalThis as any).window.api.geoint.summarizeEvent = vi.fn(async () => ({ available: false, reason: 'Local AI model not available' }));
    render(<EventDetailsPanel item={item} allItems={[item]} sources={[]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/INTEL/i);
    await flush();
    expect(hasText(/Local AI model not available/i)).toBe(true);
    expect(hasText(/Mariupol/)).toBe(true);   // rest of the tab still works
  });
});
