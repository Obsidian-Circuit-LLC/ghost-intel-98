/**
 * Calendar — month view aggregating reminders + case task deadlines.
 *
 * v2.0: click a day cell to quickly create a global reminder for that day at noon.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaseSummary, Reminder } from '@shared/types';
import { promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

interface Event {
  date: string;
  label: string;
  kind: 'reminder' | 'case-due';
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function makeId(): string {
  return `rem-${crypto.randomUUID()}`;
}

export function CalendarModule(): JSX.Element {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState<Event[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [globals, cases] = await Promise.all([
        window.api.reminders.listGlobal(),
        window.api.cases.list()
      ]);
      const evs: Event[] = [];
      const broken: string[] = [];
      for (const r of globals) evs.push({ date: ymd(new Date(r.fireAt)), label: r.title, kind: 'reminder' });
      for (const c of cases) {
        try {
          const detail = await window.api.cases.read(c.id);
          for (const r of detail.reminders) {
            evs.push({ date: ymd(new Date(r.fireAt)), label: `${c.title} — ${r.title}`, kind: 'reminder' });
          }
          for (const t of detail.tasks) {
            if (t.dueAt) evs.push({ date: ymd(new Date(t.dueAt)), label: `${c.title} — ${t.text}`, kind: 'case-due' });
          }
        } catch (err) {
          broken.push(`${c.title}: ${(err as Error).message}`);
          // eslint-disable-next-line no-console
          console.warn('[calendar] case read failed', c.id, err);
        }
      }
      setEvents(evs);
      if (broken.length > 0) {
        toast.warn(`Calendar: ${broken.length} case${broken.length === 1 ? '' : 's'} could not be loaded — see console.`);
      }
    } catch (err) {
      toast.error(`Calendar refresh failed: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [cursor, refreshTick, refresh]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = ymd(today);

  async function quickCreate(date: Date): Promise<void> {
    const title = await promptDialog(`New reminder for ${date.toLocaleDateString()}:`, '', 'Quick reminder');
    if (!title) return;
    // Fire at noon local time of the chosen day
    const fireAt = new Date(date);
    fireAt.setHours(12, 0, 0, 0);
    const r: Reminder = {
      id: makeId(),
      title: title.trim(),
      fireAt: fireAt.toISOString(),
      repeat: 'none',
      fired: false
    };
    try {
      await window.api.reminders.upsertGlobal(r);
      toast.success(`Reminder set for ${date.toLocaleDateString()}.`);
      setRefreshTick((n) => n + 1);
    } catch (err) {
      toast.error(`Reminder failed: ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} title="Previous month">‹ Prev</button>
        <strong style={{ flex: 1, textAlign: 'center' }}>
          {cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
        </strong>
        <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} title="Next month">Next ›</button>
      </div>
      <p style={{ fontSize: 11, padding: '4px 8px 0 8px', margin: 0, color: '#444' }}>
        Click any day to add a quick reminder.
      </p>
      <div className="ga98-grid-calendar" style={{ margin: 6 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="ga98-cal-header">{d}</div>
        ))}
        {grid.map((cell, i) => {
          const key = ymd(cell.date);
          const cellEvents = events.filter((e) => e.date === key);
          return (
            <div
              key={i}
              data-muted={!cell.inMonth}
              data-today={key === todayKey}
              data-clickable="true"
              onClick={() => void quickCreate(cell.date)}
            >
              <div style={{ position: 'absolute', top: 2, right: 4, fontWeight: 'bold' }}>{cell.date.getDate()}</div>
              <div style={{ marginTop: 14 }}>
                {cellEvents.slice(0, 3).map((e, j) => (
                  <div key={j} className="ga98-cal-event" title={e.label}>{e.label}</div>
                ))}
                {cellEvents.length > 3 && <div style={{ fontSize: 10 }}>+{cellEvents.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildMonthGrid(monthStart: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const offset = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - offset);
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === monthStart.getMonth() });
  }
  return cells;
}

export type _Unused = CaseSummary;
