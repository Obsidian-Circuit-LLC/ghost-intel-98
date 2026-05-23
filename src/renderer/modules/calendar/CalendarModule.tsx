/**
 * Retro calendar — month view aggregating reminders (global + per-case) and case deadlines.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CaseSummary, Reminder } from '@shared/types';

interface Event {
  date: string; // YYYY-MM-DD
  label: string;
  kind: 'reminder' | 'case-due';
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function CalendarModule(): JSX.Element {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    void (async () => {
      const [globals, cases] = await Promise.all([
        window.api.reminders.listGlobal(),
        window.api.cases.list()
      ]);
      const evs: Event[] = [];
      for (const r of globals) evs.push({ date: ymd(new Date(r.fireAt)), label: r.title, kind: 'reminder' });
      // case-scoped reminders + tasks with dueAt
      for (const c of cases) {
        try {
          const detail = await window.api.cases.read(c.id);
          for (const r of detail.reminders) {
            evs.push({ date: ymd(new Date(r.fireAt)), label: `${c.title} — ${r.title}`, kind: 'reminder' });
          }
          for (const t of detail.tasks) {
            if (t.dueAt) evs.push({ date: ymd(new Date(t.dueAt)), label: `${c.title} — ${t.text}`, kind: 'case-due' });
          }
        } catch {
          // skip malformed case
        }
      }
      setEvents(evs);
    })();
  }, [cursor]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const todayKey = ymd(today);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹ Prev</button>
        <strong style={{ flex: 1, textAlign: 'center' }}>
          {cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
        </strong>
        <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>Next ›</button>
      </div>
      <div className="ga98-grid-calendar" style={{ margin: 6 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="ga98-cal-header">{d}</div>
        ))}
        {grid.map((cell, i) => {
          const key = ymd(cell.date);
          const cellEvents = events.filter((e) => e.date === key);
          return (
            <div key={i} data-muted={!cell.inMonth} data-today={key === todayKey}>
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

// Reference unused param to satisfy strict lint (caseSummary type imported but unused otherwise)
export type _Unused = CaseSummary | Reminder;
