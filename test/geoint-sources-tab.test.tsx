// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;
const render = (el: React.ReactElement): void => { act(() => root.render(el)); };
const clickButton = (re: RegExp): void => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button matching ${re}`);
  act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const hasText = (re: RegExp): boolean =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).some((el) => el.children.length === 0 && re.test(el.textContent ?? ''));
const countText = (re: RegExp): number =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => el.children.length === 0 && re.test(el.textContent ?? '')).length;

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem =>
  ({ title: o.id, located: 'geo', ...o } as GeoItem);
const target = mk({ id: 'T', sourceId: 'wt', title: 'US MILITARY STRIKE', category: 'chatter',
  lat: 50, lon: 30, country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });
const reuters = mk({ id: 'A', sourceId: 'reuters', title: 'Strike reported', link: 'https://ex.org/a', lat: 50.02, lon: 30.02, published: '2026-07-30T09:00:00Z' });
const related = mk({ id: 'R', sourceId: 'reuters', title: 'Earlier strike', country: 'UA', eventType: 'Military Strike', lat: 51, lon: 31, published: '2026-07-28T10:00:00Z' });
const sources = [{ id: 'wt', label: 'War-Tracker' }, { id: 'reuters', label: 'Reuters World' }];

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('EventDetailsPanel — SOURCES tab', () => {
  it('shows the distinct-other-source count and resolves labels', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/SOURCES \(1\)/)).toBe(true);          // one distinct OTHER source (reuters)
    expect(hasText(/^Reuters World$/)).toBe(true);
  });

  it('keeps the unverified social-OSINT stamp on a chatter-category source', () => {
    const chatterCorroborator = mk({ id: 'B', sourceId: 'tg', title: 'tg post', category: 'chatter', lat: 50.01, lon: 30.01, published: '2026-07-30T10:00:00Z' });
    render(<EventDetailsPanel item={target} allItems={[target, chatterCorroborator]}
      sources={[{ id: 'tg', label: 'Telegram' }]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/unverified social-OSINT/i)).toBe(true);
  });

  it('renders the related-in-region section', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/RELATED IN REGION/i)).toBe(true);
    expect(hasText(/^Earlier strike$/)).toBe(true);
  });

  it('opens a source link through onOpenLink (never a raw anchor)', () => {
    const onOpenLink = vi.fn();
    render(<EventDetailsPanel item={target} allItems={[target, reuters]} sources={sources}
      onClose={() => {}} onOpenLink={onOpenLink} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    clickButton(/^Open$/);
    expect(onOpenLink).toHaveBeenCalledWith('https://ex.org/a');
  });

  it('does NOT render any authority tier label (no Official/Independent/Social)', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/\bOfficial\b|\bIndependent\b/)).toBe(false);
    expect(hasText(/\bSocial\b(?!-OSINT)/)).toBe(false);
  });

  // Count honesty: the header must be DISTINCT other feeds — dedupe repeats from one feed, and never
  // count the event's own source. Fixture forces both guards to matter (they cannot both collapse to 1).
  it('counts distinct OTHER feeds — dedupes repeats and excludes the event\'s own source', () => {
    const sources3 = [{ id: 'wt', label: 'War-Tracker' }, { id: 'reuters', label: 'Reuters World' }, { id: 'ap', label: 'AP' }];
    const reutersA = mk({ id: 'RA', sourceId: 'reuters', title: 'ra', lat: 50.02, lon: 30.02, published: '2026-07-30T09:00:00Z' });
    const reutersB = mk({ id: 'RB', sourceId: 'reuters', title: 'rb', lat: 50.01, lon: 30.01, published: '2026-07-30T09:30:00Z' }); // 2nd report, SAME feed
    const ap = mk({ id: 'APX', sourceId: 'ap', title: 'ap', lat: 50.02, lon: 29.98, published: '2026-07-30T09:00:00Z' });
    const wtSelf = mk({ id: 'WS', sourceId: 'wt', title: 'ws', lat: 50.015, lon: 30.0, published: '2026-07-30T09:00:00Z' }); // event's OWN source
    render(<EventDetailsPanel item={target} allItems={[target, reutersA, reutersB, ap, wtSelf]} sources={sources3}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/SOURCES \(2\)/)).toBe(true);   // reuters + ap only; reuters not double-counted, wt (own) excluded
    expect(countText(/^Reuters World$/)).toBe(1);  // deduped to one row despite two reuters reports
  });

  it('the This source / Other feeds filter actually narrows the list', () => {
    const reutersA = mk({ id: 'RA', sourceId: 'reuters', title: 'RA report', lat: 50.02, lon: 30.02, published: '2026-07-30T09:00:00Z' });
    const wtSelf = mk({ id: 'WS', sourceId: 'wt', title: 'WS report', lat: 50.01, lon: 30.0, published: '2026-07-30T09:00:00Z' });
    render(<EventDetailsPanel item={target} allItems={[target, reutersA, wtSelf]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    clickButton(/^Other feeds$/);
    expect(hasText(/^Reuters World$/)).toBe(true);   // other feed shown
    expect(hasText(/^War-Tracker$/)).toBe(false);    // the event's own source is NOT an "other feed"
    clickButton(/^This source$/);
    expect(hasText(/^War-Tracker$/)).toBe(true);      // same-source report now shows
    expect(hasText(/^Reuters World$/)).toBe(false);
  });

  // Charter regression guard: chatter events must keep the unverified stamp in the RELATED list too,
  // not only in corroboration. Here corroboration is empty (the related event is far outside the radius)
  // so the stamp can ONLY come from the Related list.
  it('stamps chatter events in the Related-in-region list (not just corroboration)', () => {
    const relChatter = mk({ id: 'RC', sourceId: 'tg', title: 'Distant chatter strike', category: 'chatter',
      country: 'UA', eventType: 'Military Strike', lat: 45, lon: 30, published: '2026-07-29T10:00:00Z' }); // ~555km away
    render(<EventDetailsPanel item={target} allItems={[target, relChatter]}
      sources={[{ id: 'wt', label: 'War-Tracker' }, { id: 'tg', label: 'Telegram' }]}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/No other feeds reporting this event/i)).toBe(true); // corroboration genuinely empty
    expect(hasText(/^Distant chatter strike$/)).toBe(true);
    expect(hasText(/unverified social-OSINT/i)).toBe(true);             // stamp comes from Related
  });
});
