# Recurring Calendar Reminders — Design Spec

**Date:** 2026-07-16
**Module:** Ghost Intel 98 → Calendar (`CalendarModule`) + the global-reminder store/scheduler.
**Origin:** GhostExodus — right-click a calendar reminder to make it recurring (and to remove recurrence), so e.g. a weekly "CCF Call 6PM" repeats on the calendar and keeps notifying.

## Goal

Turn the existing-but-unused `Reminder.repeat` field into a working feature: right-click a global reminder → **Make recurring ▸ Daily / Weekly / Monthly** and **Remove recurring**; the month view shows the reminder on every matching day forward from its start; and the scheduler keeps firing notifications each period.

## Current state (grounding)

- `Reminder` (`src/shared/types.ts`) already has `repeat?: 'none' | 'daily' | 'weekly'` — but nothing reads it.
- `drainDue` (`src/main/storage/json-fs.ts`) marks a due reminder `fired = true` once and never reschedules.
- `CalendarModule` buckets a reminder onto its single `fireAt` local-civil day; right-click offers only "Delete reminder".
- Global reminders are CRUD'd via `window.api.reminders.{listGlobal, upsertGlobal, deleteGlobal}`; the 30 s ticker (`register.ts`) calls `drainDue`.

## Design

### Data model (`src/shared/types.ts`)

- Extend `Reminder.repeat` to `'none' | 'daily' | 'weekly' | 'monthly'`.
- Add `Reminder.lastFiredAt?: ISODate` — the timestamp of the most recent occurrence the scheduler has already notified. `fireAt` stays the **immutable anchor** (first occurrence); `lastFiredAt` tracks scheduler progress without destroying the anchor.
- Migration: absent `repeat` reads as `'none'`; absent `lastFiredAt` reads as undefined (never fired). A legacy `fired: true` non-repeating reminder is unchanged.

### Recurrence math (pure, `src/shared/recurrence.ts` — new, shared so main + renderer both use it)

- `nextOccurrence(anchorMs: number, repeat: Repeat, afterMs: number): number | null` — the first occurrence strictly after `afterMs` (daily = +1 day, weekly = +7 days, monthly = same day-of-month advancing whole months, **skipping months without that day** e.g. no 31st). Returns `null` for `repeat === 'none'`.
- `occurrencesInLocalMonth(anchorMs, repeat, year, month): number[]` — every occurrence timestamp whose LOCAL civil date falls in `[year, month]`, from the anchor forward (nothing before the anchor). Used by the calendar; bucketed by the module's existing local-civil `ymd()`.
- Deterministic: all math from the passed timestamps; no `Date.now()` inside the pure functions (callers pass `now`).

### Scheduler (`drainDue`, `src/main/storage/json-fs.ts`)

For each global + case reminder:
- **Non-repeating** (`repeat` absent/`none`): unchanged — fire once when `fireAt <= now`, set `fired = true`.
- **Repeating**: compute `due = nextOccurrence(fireAt, repeat, lastFiredAt ?? fireAt - 1)`. If `due !== null && due <= now`, push it as due, set `lastFiredAt = due` (do NOT set `fired`). At most one occurrence per reminder per tick → a machine off for weeks gets a gentle catch-up over subsequent ticks, not a notification burst. `fireAt` is never mutated.

### Calendar (`src/renderer/modules/reports/... no` → `src/renderer/modules/calendar/CalendarModule.tsx`)

- When building the month's events, a global reminder with `repeat !== 'none'` contributes an event on **every** day returned by `occurrencesInLocalMonth(fireAt, repeat, viewYear, viewMonth)` (instead of only its `fireAt` day). Each occurrence event keeps the same `globalReminderId` (right-click acts on the series) and carries a `recurring: true` flag → render a small 🔁 badge before the label.
- Case reminders remain single-day (out of scope; only global reminders get the right-click menu today).

### Right-click menu (`CalendarModule`)

Extend the existing reminder context menu (currently "Delete reminder"):
- **Make recurring ▸ Daily / Weekly / Monthly** — shown when the reminder's `repeat` is `'none'`/absent; sets `repeat` and `upsertGlobal`s. (A submenu, or three flat items "Repeat daily/weekly/monthly" — implementer picks whichever fits the existing menu component with least friction; both are acceptable.)
- **Remove recurring** — shown only when `repeat !== 'none'`; sets `repeat = 'none'` (and clears `lastFiredAt`) and `upsertGlobal`s.
- **Delete reminder** — unchanged; deletes the whole series (one record).
- Only global reminders (those with `globalReminderId`) get these items — case-derived events stay delete-less as today.

### Validation (`src/main/security/validate.ts`)

Wherever `upsertGlobal` input is validated, accept `repeat ∈ {none,daily,weekly,monthly}` (default `none` on anything else) and a well-formed `lastFiredAt` ISODate (drop if malformed). No new IPC surface.

## Testing

- **Pure (`recurrence.ts`):** `nextOccurrence` for daily/weekly/monthly incl. the month-skip (Jan 31 → Mar 31, skipping Feb); `null` for none; strictly-after semantics. `occurrencesInLocalMonth` returns the right days for a mid-month weekly anchor, nothing before the anchor, and correct across a month boundary.
- **Scheduler (`drainDue`):** a weekly reminder fires once when the next occurrence is due, sets `lastFiredAt`, doesn't set `fired`, and doesn't re-fire the same occurrence next tick; a non-repeating reminder still fires-once. Determinism (fixed `now`).
- **Calendar:** a weekly reminder renders on all matching days of the viewed month with the 🔁 badge; right-click a recurring reminder shows Remove recurring (not Make recurring) and vice-versa; Make/Remove call `upsertGlobal` with the expected `repeat`.
- **Validator:** repeat enum clamp + lastFiredAt parse.

## Out of scope

- Recurring **case** reminders (only global reminders get the calendar right-click today).
- Custom intervals ("every 2 weeks"), end dates, per-occurrence edits/exceptions, weekday-set rules. Just the three fixed frequencies.
- Editing a reminder's time/text from the calendar (unchanged).

## Charter / constraints

Commit identity, explicit-path `git add`, no new deps, no new egress, encrypt-at-rest preserved (reminders live in the same store). Determinism in the scheduler + recurrence math (no unseeded time inside pure functions).
