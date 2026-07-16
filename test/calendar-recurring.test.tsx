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
let casesList: ReturnType<typeof vi.fn>;

function installApi(reminders: Reminder[]): void {
  listGlobal = vi.fn().mockResolvedValue(reminders);
  casesList = vi.fn().mockResolvedValue([]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    reminders: { listGlobal, upsertGlobal: vi.fn(), deleteGlobal: vi.fn() },
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
