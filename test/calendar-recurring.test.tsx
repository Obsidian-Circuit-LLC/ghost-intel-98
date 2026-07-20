// @vitest-environment jsdom
/**
 * Task 3: Calendar month-view recurring-reminder expansion.
 *
 * A global reminder with repeat:'weekly' whose anchor is Thu 2026-07-16 18:00 must render
 * on every matching day of the month view (Thursdays 16/23/30 in July 2026), each cell
 * carrying the 🔁 recurring badge (.ga98-cal-recurring). Non-recurring reminders are
 * unaffected (single cell, no badge).
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * against a jsdom container, mirroring socmint-cases-sidebar.test.tsx. The clock is pinned
 * to July 2026 so the module's initial cursor (new Date()) lands on the month under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CalendarModule } from '../src/renderer/modules/calendar/CalendarModule';
import type { Reminder } from '@shared/types';

// Anchor built from LOCAL components so the ISO instant re-buckets to the 16th in any timezone.
const anchorIso = new Date(2026, 6, 16, 18, 0, 0, 0).toISOString();

const WEEKLY: Reminder = { id: 'g1', title: 'CCF Call 6PM', fireAt: anchorIso, repeat: 'weekly', fired: false };

let container: HTMLDivElement;
let root: Root;
let listGlobal: ReturnType<typeof vi.fn>;
let upsertGlobal: ReturnType<typeof vi.fn>;
let casesList: ReturnType<typeof vi.fn>;

function installApi(reminders: Reminder[]): void {
  listGlobal = vi.fn().mockResolvedValue(reminders);
  upsertGlobal = vi.fn().mockResolvedValue(undefined);
  casesList = vi.fn().mockResolvedValue([]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    reminders: { listGlobal, upsertGlobal, deleteGlobal: vi.fn() },
    cases: { list: casesList, read: vi.fn() },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 10, 9, 0, 0, 0)); // July 2026 → initial cursor is July 1 2026
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Calendar recurring expansion (Task 3)', () => {
  it('renders a weekly reminder on every matching day (16/23/30) with a 🔁 badge', async () => {
    installApi([WEEKLY]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    const eventEls = Array.from(container.querySelectorAll('.ga98-cal-event'))
      .filter((el) => (el.textContent ?? '').includes('CCF Call 6PM'));
    expect(eventEls.length).toBe(3);

    const badges = container.querySelectorAll('.ga98-cal-recurring');
    expect(badges.length).toBe(3);
    expect(Array.from(badges).every((b) => (b.textContent ?? '').includes('🔁'))).toBe(true);
  });

  it('leaves a non-recurring reminder as a single un-badged cell', async () => {
    installApi([{ id: 'g2', title: 'One-off', fireAt: anchorIso, repeat: 'none', fired: false }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    const eventEls = Array.from(container.querySelectorAll('.ga98-cal-event'))
      .filter((el) => (el.textContent ?? '').includes('One-off'));
    expect(eventEls.length).toBe(1);
    expect(container.querySelectorAll('.ga98-cal-recurring').length).toBe(0);
  });
});

function menuButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('.ga98-context-menu .ga98-context-menu-item')) as HTMLButtonElement[];
}

function menuLabels(): string[] {
  return menuButtons().map((b) => (b.textContent ?? '').trim());
}

async function openMenuFor(label: string): Promise<void> {
  const el = Array.from(container.querySelectorAll('.ga98-cal-event'))
    .find((e) => (e.textContent ?? '').includes(label));
  if (!el) throw new Error(`no calendar event with label ${label}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
}

async function clickMenu(label: string): Promise<void> {
  const btn = menuButtons().find((b) => (b.textContent ?? '').trim() === label);
  if (!btn) throw new Error(`no menu button ${label}`);
  await act(async () => { btn.click(); });
  await flush();
}

describe('Calendar right-click Make/Remove recurring (Task 4)', () => {
  it('offers Repeat daily/weekly/monthly on a NON-recurring reminder and upserts the chosen freq', async () => {
    installApi([{ id: 'g2', title: 'One-off', fireAt: anchorIso, repeat: 'none', fired: false }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    await openMenuFor('One-off');
    const labels = menuLabels();
    expect(labels).toContain('Repeat daily');
    expect(labels).toContain('Repeat weekly');
    expect(labels).toContain('Repeat monthly');
    expect(labels).not.toContain('Remove recurring');

    await clickMenu('Repeat weekly');
    expect(upsertGlobal).toHaveBeenCalledTimes(1);
    expect(upsertGlobal.mock.calls[0][0]).toMatchObject({ id: 'g2', repeat: 'weekly' });
  });

  it('offers Remove recurring on a recurring reminder and upserts repeat:none', async () => {
    installApi([WEEKLY]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    await openMenuFor('CCF Call 6PM');
    const labels = menuLabels();
    expect(labels).toContain('Remove recurring');
    expect(labels).not.toContain('Repeat daily');
    expect(labels).not.toContain('Repeat weekly');
    expect(labels).not.toContain('Repeat monthly');

    await clickMenu('Remove recurring');
    expect(upsertGlobal).toHaveBeenCalledTimes(1);
    expect(upsertGlobal.mock.calls[0][0]).toMatchObject({ id: 'g1', repeat: 'none' });
  });

  it('Remove recurring on a PAST-anchored reminder marks it fired so drainDue will not re-notify the stale anchor', async () => {
    // System time is Jul 10 2026 (beforeEach). Anchor Jul 2 is already in the past.
    const pastIso = new Date(2026, 6, 2, 18, 0, 0, 0).toISOString();
    installApi([{ id: 'g4', title: 'Past weekly', fireAt: pastIso, repeat: 'weekly', fired: false }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    await openMenuFor('Past weekly');
    await clickMenu('Remove recurring');
    expect(upsertGlobal).toHaveBeenCalledTimes(1);
    const arg = upsertGlobal.mock.calls[0][0];
    expect(arg).toMatchObject({ id: 'g4', repeat: 'none', fired: true });
    expect(arg.lastFiredAt).toBeUndefined();
    expect(arg.fireAt).toBe(pastIso); // anchor immutable
  });

  it('Remove recurring on a FUTURE-anchored reminder leaves it unfired so it still fires at its time', async () => {
    // Anchor Jul 16 18:00 is in the future relative to the Jul 10 system time.
    installApi([WEEKLY]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    await openMenuFor('CCF Call 6PM');
    await clickMenu('Remove recurring');
    expect(upsertGlobal).toHaveBeenCalledTimes(1);
    expect(upsertGlobal.mock.calls[0][0]).toMatchObject({ id: 'g1', repeat: 'none', fired: false });
  });
});

describe('Calendar event colour + note (v3.57)', () => {
  const ONEOFF: Reminder = { id: 'g2', title: 'One-off', fireAt: anchorIso, repeat: 'none', fired: false };

  it('applies a chosen colour swatch to the reminder (upsert carries the hex)', async () => {
    installApi([ONEOFF]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    await openMenuFor('One-off');
    const swatch = container.querySelector('.ga98-cal-swatch:not(.ga98-cal-swatch-clear)') as HTMLButtonElement;
    expect(swatch).toBeTruthy();
    await act(async () => { swatch.click(); });
    await flush();
    expect(upsertGlobal).toHaveBeenCalledTimes(1);
    expect(typeof upsertGlobal.mock.calls[0][0].color).toBe('string');
  });

  it('renders a colour-carrying reminder as a tinted chip', async () => {
    // jsdom's cssstyle expands the `background` shorthand into `backgroundColor`.
    installApi([{ ...ONEOFF, color: '#800000' }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();
    const chip = Array.from(container.querySelectorAll('.ga98-cal-event'))
      .find((e) => (e.textContent ?? '').includes('One-off')) as HTMLElement;
    expect(chip.style.backgroundColor).toBeTruthy();
  });

  it('clears the colour via the × swatch (upsert sets color undefined)', async () => {
    installApi([{ ...ONEOFF, color: '#800000' }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();
    await openMenuFor('One-off');
    const clear = container.querySelector('.ga98-cal-swatch-clear') as HTMLButtonElement;
    await act(async () => { clear.click(); });
    await flush();
    expect(upsertGlobal.mock.calls[0][0].color).toBeUndefined();
  });

  it('shows a note badge + puts the note in the hover title, and Delete note clears it', async () => {
    installApi([{ ...ONEOFF, note: 'bring the deck' }]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();

    const chip = Array.from(container.querySelectorAll('.ga98-cal-event'))
      .find((e) => (e.textContent ?? '').includes('One-off')) as HTMLElement;
    expect(chip.querySelector('.ga98-cal-noted')).toBeTruthy();       // 📝 badge present
    expect(chip.getAttribute('title')).toContain('bring the deck');    // hover shows the note

    await openMenuFor('One-off');
    expect(menuLabels()).toContain('Edit note…');
    await clickMenu('Delete note');
    expect(upsertGlobal.mock.calls[0][0].note).toBeUndefined();
  });

  it('offers "Add note…" (not Edit) when the reminder has no note', async () => {
    installApi([ONEOFF]);
    await act(async () => { root.render(<CalendarModule />); });
    await flush();
    await openMenuFor('One-off');
    expect(menuLabels()).toContain('Add note…');
    expect(menuLabels()).not.toContain('Edit note…');
    expect(menuLabels()).not.toContain('Delete note');
  });
});
