// @vitest-environment jsdom
/**
 * Event Details Phase 1 — Task 4: EventDetailsPanel Overview tab (presentational).
 *
 * The panel is a pure presentational component (all state owned by GeoIntModuleInner, per the
 * CommandRail convention). It renders the Overview dossier from real, already-fetched data via the
 * pure helpers resolveEventFields/deriveTags (Task 3). No AI, no network, no fabricated data.
 *
 * HONESTY (charter): the MEDIA / SOURCES / INTEL SUMMARY tabs are shown DISABLED ("coming soon") —
 * they are Phases 2-3 and MUST NOT be populated with fabricated data. XSS-safe (React text only).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(), mirroring
 * geoint-patch-partial.test.tsx / add-stream-dialog.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;

const strike: GeoItem = {
  id: 'wartracker:1',
  sourceId: 'threat:wartracker',
  title: 'Coordinated strike near Mosul',
  link: 'https://example.org/events/1',
  located: 'geo',
  lat: 36.3456,
  lon: 43.1189,
  published: '2026-07-20T12:00:00.000Z',
  place: 'Mosul',
  category: 'chatter',
  severity: 'high',
  eventType: 'Military Strike',
  detail: 'A coordinated airstrike was reported across three districts; missile impacts near the airport.',
  confidence: 'HIGH',
  country: 'IQ'
};

function textNodes(rootEl: ParentNode): HTMLElement[] {
  return Array.from(rootEl.querySelectorAll<HTMLElement>('*'));
}
function findByText(rootEl: ParentNode, text: string): HTMLElement | undefined {
  return textNodes(rootEl).find((el) => el.children.length === 0 && el.textContent === text);
}
function findButton(rootEl: ParentNode, re: RegExp): HTMLButtonElement | undefined {
  return Array.from(rootEl.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
}

function render(el: React.ReactElement): void {
  act(() => root.render(el));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('EventDetailsPanel — Overview tab', () => {
  it('renders the badge (uppercased, colored), title, location/coords/date/source', () => {
    render(
      <EventDetailsPanel item={strike} onClose={vi.fn()} onOpenLink={vi.fn()} onPin={vi.fn()} pinned={false} />
    );
    const badge = findByText(container, 'MILITARY STRIKE');
    expect(badge).toBeTruthy();
    expect(badge!.style.background || badge!.style.backgroundColor).toBeTruthy();

    const txt = container.textContent ?? '';
    expect(txt).toContain('Coordinated strike near Mosul'); // title
    expect(txt).toContain('Mosul'); // location (place)
    expect(txt).toContain('36.3456'); // lat coord
    expect(txt).toContain('43.1189'); // lon coord
    expect(txt).toContain('threat:wartracker'); // source label
    expect(txt).toContain('2026'); // absolute date (year at minimum)
  });

  it('renders the fact grid (Event Type / Confidence / Severity), description and tag chips', () => {
    render(
      <EventDetailsPanel item={strike} onClose={vi.fn()} onOpenLink={vi.fn()} onPin={vi.fn()} pinned={false} />
    );
    const txt = container.textContent ?? '';
    expect(txt).toContain('Event Type');
    expect(txt).toContain('Military Strike');
    expect(txt).toContain('Confidence');
    expect(txt).toContain('HIGH');
    expect(txt).toContain('Severity');
    expect(txt).toContain('SEVERE');
    // description body surfaced verbatim
    expect(txt).toContain('A coordinated airstrike was reported across three districts');
    // deterministic keyword tags from title + detail
    expect(txt).toContain('military');
    expect(txt).toContain('strike');
  });

  it('shows the MEDIA / SOURCES / INTEL SUMMARY tabs DISABLED ("coming soon"), not populated', () => {
    render(
      <EventDetailsPanel item={strike} onClose={vi.fn()} onOpenLink={vi.fn()} onPin={vi.fn()} pinned={false} />
    );
    for (const label of ['MEDIA', 'SOURCES', 'INTEL SUMMARY']) {
      const tab = findButton(container, new RegExp(`^${label}`));
      expect(tab, `${label} tab present`).toBeTruthy();
      expect(tab!.disabled, `${label} tab disabled`).toBe(true);
    }
  });

  it('wires the action buttons: Open/source-link → onOpenLink(link), close → onClose, pin → onPin', () => {
    const onOpenLink = vi.fn();
    const onClose = vi.fn();
    const onPin = vi.fn();
    render(
      <EventDetailsPanel item={strike} onClose={onClose} onOpenLink={onOpenLink} onPin={onPin} pinned={false} />
    );

    const openBtn = findButton(container, /open/i);
    expect(openBtn).toBeTruthy();
    act(() => { openBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenLink).toHaveBeenCalledWith(strike.link);

    // the canonical source link (anchor) also opens via onOpenLink
    const anchor = container.querySelector('a');
    expect(anchor).toBeTruthy();
    act(() => { anchor!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenLink).toHaveBeenCalledWith(strike.link);

    const pinBtn = findButton(container, /monitor/i);
    expect(pinBtn).toBeTruthy();
    act(() => { pinBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onPin).toHaveBeenCalledWith(strike.id);

    const closeBtn = findButton(container, /^\s*[×✕x]\s*$/i) ?? findButton(container, /close/i);
    expect(closeBtn).toBeTruthy();
    act(() => { closeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Remove from Monitor when pinned', () => {
    render(
      <EventDetailsPanel item={strike} onClose={vi.fn()} onOpenLink={vi.fn()} onPin={vi.fn()} pinned={true} />
    );
    expect(findButton(container, /remove.*monitor/i)).toBeTruthy();
  });

  it('renders nothing when item is null', () => {
    render(
      <EventDetailsPanel item={null} onClose={vi.fn()} onOpenLink={vi.fn()} onPin={vi.fn()} pinned={false} />
    );
    expect(container.textContent).toBe('');
  });
});
