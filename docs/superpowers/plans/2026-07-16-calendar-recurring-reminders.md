# Recurring Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Reminder.repeat` a working feature — right-click a global calendar reminder to Make/Remove recurring (Daily/Weekly/Monthly), show it on every matching day of the month view, and keep firing its notifications each period.

**Architecture:** `fireAt` is an immutable anchor; a new `lastFiredAt` tracks scheduler progress. Pure recurrence math lives in a new shared module used by both the renderer (calendar expansion) and main (scheduler). No `fireAt` mutation, no per-occurrence records.

**Tech Stack:** TypeScript, React (CalendarModule), the secure-fs JSON reminder store, Vitest. No new dependencies.

## Global Constraints

- **Commit identity:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`. NEVER emit `Co-Authored-By` / `Signed-off-by` / `Claude-Session` trailers.
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/**`, `native/**`, `docs/superpowers/ideation/**`.
- **No new dependencies. No new egress. Encrypt-at-rest preserved** (reminders stay in the existing store).
- **Determinism:** the pure recurrence functions take all timestamps as arguments — no `Date.now()` / `new Date()` (argless) inside them. Callers pass `now`.
- **`fireAt` is the immutable anchor** — never mutate it. Progress is tracked in `lastFiredAt` only.
- Tests: `pnpm exec vitest run <files>`; typecheck `pnpm exec tsc --noEmit`.

---

## File Structure

- **Modify** `src/shared/types.ts` — `Reminder.repeat` gains `'monthly'`; add `Reminder.lastFiredAt?: ISODate`.
- **Create** `src/shared/recurrence.ts` — pure `Repeat`, `nextOccurrence`, `occurrencesInLocalMonth`.
- **Modify** `src/main/security/validate.ts` — clamp `repeat` to the enum + parse `lastFiredAt` (only if a reminder validator exists; otherwise this is a no-op — see Task 1 Step 5).
- **Modify** `src/main/storage/json-fs.ts` (`drainDue`) — reschedule repeating reminders.
- **Modify** `src/renderer/modules/calendar/CalendarModule.tsx` — expand occurrences + right-click Make/Remove recurring + 🔁 badge.
- **Tests:** `test/recurrence.test.ts`, `test/reminders-drain-recurring.test.ts`, `test/calendar-recurring.test.tsx`.

---

## Task 1: Types + pure recurrence module + validator

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/recurrence.ts`
- Modify: `src/main/security/validate.ts` (only if a reminder validator exists)
- Test: `test/recurrence.test.ts` (create)

**Interfaces — Produces:**
- `Reminder.repeat: 'none' | 'daily' | 'weekly' | 'monthly'` (still optional); `Reminder.lastFiredAt?: string`.
- `export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'`
- `export function nextOccurrence(anchorMs: number, repeat: Repeat, afterMs: number): number | null`
- `export function occurrencesInLocalMonth(anchorMs: number, repeat: Repeat, year: number, month: number): number[]` (`month` is 0-based, matching JS `Date`)

- [ ] **Step 1: Write the failing test** — `test/recurrence.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { nextOccurrence, occurrencesInLocalMonth } from '../src/shared/recurrence';

// A local anchor: Thu 2026-07-16 18:00.
const anchor = new Date(2026, 6, 16, 18, 0, 0, 0).getTime();

describe('nextOccurrence', () => {
  it('returns null for none', () => {
    expect(nextOccurrence(anchor, 'none', anchor)).toBeNull();
  });
  it('daily/weekly step to the first occurrence strictly after `after`', () => {
    expect(new Date(nextOccurrence(anchor, 'daily', anchor)!).getDate()).toBe(17);
    expect(new Date(nextOccurrence(anchor, 'weekly', anchor)!).getDate()).toBe(23);
  });
  it('monthly skips months without the anchor day', () => {
    const jan31 = new Date(2026, 0, 31, 9, 0, 0, 0).getTime();
    // next after Jan 31 is Mar 31 (Feb has no 31st)
    const n = new Date(nextOccurrence(jan31, 'monthly', jan31)!);
    expect(n.getMonth()).toBe(2); // March
    expect(n.getDate()).toBe(31);
  });
});

describe('occurrencesInLocalMonth', () => {
  it('weekly: every Thursday on/after the anchor in July 2026', () => {
    const days = occurrencesInLocalMonth(anchor, 'weekly', 2026, 6).map((ms) => new Date(ms).getDate());
    expect(days).toEqual([16, 23, 30]); // nothing before the 16th; Thursdays 16/23/30
  });
  it('daily: every day on/after the anchor', () => {
    const days = occurrencesInLocalMonth(anchor, 'daily', 2026, 6).map((ms) => new Date(ms).getDate());
    expect(days[0]).toBe(16);
    expect(days[days.length - 1]).toBe(31);
    expect(days.length).toBe(16);
  });
  it('monthly: the anchor day only, and nothing in a month before the anchor', () => {
    expect(occurrencesInLocalMonth(anchor, 'monthly', 2026, 7).map((ms) => new Date(ms).getDate())).toEqual([16]); // Aug 16
    expect(occurrencesInLocalMonth(anchor, 'monthly', 2026, 5)).toEqual([]); // June is before the anchor
  });
  it('none yields nothing', () => {
    expect(occurrencesInLocalMonth(anchor, 'none', 2026, 6)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run test/recurrence.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/shared/recurrence.ts`** — all math via local `Date` components (DST/month-length safe):

```ts
/** Pure recurrence math for calendar reminders. `fireAt` (ms) is the immutable ANCHOR — the first
 *  occurrence. All functions take timestamps as arguments (no Date.now()) so they stay deterministic. */
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

const withAnchorTime = (y: number, m: number, d: number, a: Date): Date =>
  new Date(y, m, d, a.getHours(), a.getMinutes(), a.getSeconds(), a.getMilliseconds());

function advance(d: Date, anchor: Date, repeat: Repeat): Date {
  if (repeat === 'daily') return withAnchorTime(d.getFullYear(), d.getMonth(), d.getDate() + 1, anchor);
  if (repeat === 'weekly') return withAnchorTime(d.getFullYear(), d.getMonth(), d.getDate() + 7, anchor);
  // monthly: step whole months keeping the anchor's day-of-month, skipping months that lack it.
  const day = anchor.getDate();
  let y = d.getFullYear(); let m = d.getMonth();
  for (let i = 0; i < 60; i++) {
    m++; if (m > 11) { m = 0; y++; }
    const cand = withAnchorTime(y, m, day, anchor);
    if (cand.getMonth() === m) return cand; // the day exists in this month
  }
  return new Date(NaN);
}

/** First occurrence strictly after `afterMs`, or null for `none`. Steps from the anchor. */
export function nextOccurrence(anchorMs: number, repeat: Repeat, afterMs: number): number | null {
  if (repeat === 'none') return null;
  const anchor = new Date(anchorMs);
  let d = withAnchorTime(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), anchor);
  let guard = 0;
  while (d.getTime() <= afterMs && guard < 100000) { d = advance(d, anchor, repeat); guard++; }
  return d.getTime();
}

/** Every occurrence whose LOCAL civil date is in [year, month] (0-based month), from the anchor
 *  forward (nothing before the anchor's own day). Computed directly per-frequency (O(days)). */
export function occurrencesInLocalMonth(anchorMs: number, repeat: Repeat, year: number, month: number): number[] {
  if (repeat === 'none') return [];
  const anchor = new Date(anchorMs);
  const anchorDayStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const out: number[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const cand = withAnchorTime(year, month, day, anchor);
    if (cand.getTime() < anchorDayStart) continue; // nothing before the anchor day
    if (repeat === 'daily') out.push(cand.getTime());
    else if (repeat === 'weekly' && cand.getDay() === anchor.getDay()) out.push(cand.getTime());
    else if (repeat === 'monthly' && cand.getDate() === anchor.getDate()) out.push(cand.getTime());
  }
  return out;
}
```

- [ ] **Step 4: Implement types** (`src/shared/types.ts`) — change `repeat?: 'none' | 'daily' | 'weekly';` to `repeat?: 'none' | 'daily' | 'weekly' | 'monthly';` and add `lastFiredAt?: ISODate;` to the `Reminder` interface.

- [ ] **Step 5: Implement validator** — check for a reminder validator: `grep -n "upsertGlobal\|ensureReminder\|reminders" src/main/ipc/register.ts src/main/security/validate.ts`. If `upsertGlobal`'s IPC handler validates the reminder, extend that path to clamp `repeat` to `{'none','daily','weekly','monthly'}` (default `'none'`) and keep `lastFiredAt` only when it parses as a finite `Date`. If there is NO validator on that path (the renderer-built `Reminder` is stored as-is), add nothing — the recurrence functions already treat any non-enum `repeat` as producing no occurrences, and this task's deliverable is the types + pure module. Note in the commit which case applied.

- [ ] **Step 6: Run tests + typecheck** — `pnpm exec vitest run test/recurrence.test.ts` PASS; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/recurrence.ts test/recurrence.test.ts src/main/security/validate.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(calendar): recurrence types + pure occurrence math (daily/weekly/monthly, anchor + lastFiredAt)"
```

---

## Task 2: Scheduler reschedule (`drainDue`)

**Files:**
- Modify: `src/main/storage/json-fs.ts` (`drainDue`, ~lines 1020-1062)
- Test: `test/reminders-drain-recurring.test.ts` (create — call the store's `drainDue` against a temp data root, mirroring the existing drain test if present; else construct a global reminders file and assert)

**Interfaces — Consumes:** `nextOccurrence` (Task 1).

- [ ] **Step 1: Write the failing test** — `test/reminders-drain-recurring.test.ts`. Set up a temp data root (reuse the repo's existing storage-test harness/pattern — `grep -rn "drainDue\|_resetForTest\|dataRoot" test/` to find it). Assertions:
  - a global reminder `{repeat:'weekly', fireAt: T, lastFiredAt: undefined}` where `T <= now`: `drainDue(now)` returns it as due, and after the call its stored `lastFiredAt` equals the fired occurrence and `fired` is NOT set true; `fireAt` is unchanged.
  - calling `drainDue(now)` again with the same `now` does NOT return it again (the occurrence already fired).
  - a non-repeating due reminder still fires once and gets `fired = true` (unchanged behavior).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** In `drainDue`, replace the global-reminders loop body (and mirror it in the case-reminders loop):

```ts
for (const r of globals) {
  const repeat = r.repeat && r.repeat !== 'none' ? r.repeat : null;
  if (repeat) {
    const anchorMs = new Date(r.fireAt).getTime();
    const afterMs = r.lastFiredAt ? new Date(r.lastFiredAt).getTime() : anchorMs - 1;
    const dueMs = nextOccurrence(anchorMs, repeat, afterMs);
    if (dueMs !== null && dueMs <= now.getTime()) {
      due.push({ ...r, fireAt: new Date(dueMs).toISOString() }); // notify for THIS occurrence
      r.lastFiredAt = new Date(dueMs).toISOString();             // advance progress; do NOT set fired
      changed = true;
    }
  } else if (!r.fired && new Date(r.fireAt) <= now) {
    due.push(r);
    r.fired = true;
    changed = true;
  }
}
```

Add `import { nextOccurrence } from '@shared/recurrence';` (or the correct relative path) at the top of `json-fs.ts`. Apply the same repeating/non-repeating split to the per-case loop (`caseRemindersFile`), preserving its `{ ...r, caseId: cid }` shape (spread the occurrence-adjusted reminder). One occurrence per reminder per tick is intrinsic (a single `nextOccurrence` call), giving gentle catch-up.

- [ ] **Step 4: Run tests** — `pnpm exec vitest run test/reminders-drain-recurring.test.ts` PASS. Re-run any existing drain test to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/json-fs.ts test/reminders-drain-recurring.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(calendar): drainDue reschedules repeating reminders via lastFiredAt (no fireAt mutation, one/tick)"
```

---

## Task 3: Calendar month-view occurrence expansion

**Files:**
- Modify: `src/renderer/modules/calendar/CalendarModule.tsx` (the `Event` interface + the `refresh` globals loop + the day-cell render)
- Test: `test/calendar-recurring.test.tsx` (create — createRoot harness, mock `window.api.reminders.listGlobal` + `window.api.cases.list`)

**Interfaces — Consumes:** `occurrencesInLocalMonth` (Task 1).

- [ ] **Step 1: Write the failing test** — mount `CalendarModule` with `window.api.reminders.listGlobal` returning one `{id:'g1', title:'CCF Call 6PM', fireAt: <Thu 2026-07-16 18:00 ISO>, repeat:'weekly'}` and `cases.list` → `[]`; set the view to July 2026. Assert the label "CCF Call 6PM" appears on 3 day cells (16/23/30) and that each carries the recurring badge marker (e.g. text contains 🔁 or a `.ga98-cal-recurring` element). (Match the module's existing test harness in `test/` for how it renders a fixed month — if none, drive `Prev/Next`/`Today` to land on July 2026, or mock the clock via the component's `cursor`.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Extend the `Event` interface with `repeat?: Repeat;` and `recurring?: boolean;` (import `type { Repeat } from '@shared/recurrence'`). Replace the globals loop in `refresh`:

```ts
for (const r of globals) {
  if (r.repeat && r.repeat !== 'none') {
    const occ = occurrencesInLocalMonth(new Date(r.fireAt).getTime(), r.repeat, cursor.getFullYear(), cursor.getMonth());
    for (const ms of occ) {
      evs.push({ date: ymd(new Date(ms)), label: r.title, kind: 'reminder', globalReminderId: r.id, repeat: r.repeat, recurring: true });
    }
  } else {
    evs.push({ date: ymd(new Date(r.fireAt)), label: r.title, kind: 'reminder', globalReminderId: r.id, repeat: r.repeat });
  }
}
```

Add `import { occurrencesInLocalMonth, type Repeat } from '@shared/recurrence';`. In the day-cell render where an event's label is shown, prefix a badge for `ev.recurring`: `{ev.recurring ? <span className="ga98-cal-recurring" aria-hidden="true">🔁</span> : null}`. (The expansion is per the current `cursor` month, so it recomputes on Prev/Next.)

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/calendar/CalendarModule.tsx test/calendar-recurring.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(calendar): expand recurring reminders across the month view with a 🔁 badge"
```

---

## Task 4: Right-click Make/Remove recurring

**Files:**
- Modify: `src/renderer/modules/calendar/CalendarModule.tsx` (the `ctxMenu` render ~lines 174-185 + handlers)
- Test: extend `test/calendar-recurring.test.tsx`

**Interfaces — Consumes:** `window.api.reminders.upsertGlobal`, `listGlobal`.

- [ ] **Step 1: Write the failing test** — right-clicking a NON-recurring global reminder shows "Repeat daily/weekly/monthly" items and NOT "Remove recurring"; clicking "Repeat weekly" calls `upsertGlobal` with `repeat:'weekly'`. Right-clicking a recurring one shows "Remove recurring" (not the repeat items); clicking it calls `upsertGlobal` with `repeat:'none'`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add a handler that fetches the current reminder, sets `repeat`, and upserts:

```ts
async function setRecurrence(ev: Event, repeat: 'none' | 'daily' | 'weekly' | 'monthly'): Promise<void> {
  setCtxMenu(null);
  if (!ev.globalReminderId) return;
  const all = await window.api.reminders.listGlobal();
  const r = all.find((x) => x.id === ev.globalReminderId);
  if (!r) return;
  try {
    await window.api.reminders.upsertGlobal({ ...r, repeat, lastFiredAt: repeat === 'none' ? undefined : r.lastFiredAt });
    toast.success(repeat === 'none' ? 'Recurrence removed.' : `Repeats ${repeat}.`);
    setRefreshTick((n) => n + 1);
  } catch (err) {
    toast.error(`Update failed: ${(err as Error).message}`);
  }
}
```

In the `ctxMenu` block (inside the `ctxMenu.ev.globalReminderId` branch), before/after "Delete reminder", render:

```tsx
{(!ctxMenu.ev.repeat || ctxMenu.ev.repeat === 'none') ? (
  <>
    <button className="ga98-context-menu-item" onClick={() => void setRecurrence(ctxMenu.ev, 'daily')}>Repeat daily</button>
    <button className="ga98-context-menu-item" onClick={() => void setRecurrence(ctxMenu.ev, 'weekly')}>Repeat weekly</button>
    <button className="ga98-context-menu-item" onClick={() => void setRecurrence(ctxMenu.ev, 'monthly')}>Repeat monthly</button>
  </>
) : (
  <button className="ga98-context-menu-item" onClick={() => void setRecurrence(ctxMenu.ev, 'none')}>Remove recurring</button>
)}
```

(`ctxMenu.ev.repeat` is populated on every global event by Task 3, so a recurring occurrence's menu knows it is recurring.)

- [ ] **Step 4: Run tests + typecheck** — PASS; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/calendar/CalendarModule.tsx test/calendar-recurring.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify -m "feat(calendar): right-click Make recurring (daily/weekly/monthly) + Remove recurring"
```

---

## Final Verification (controller)

1. `pnpm test` → all green; `pnpm exec tsc --noEmit` → clean.
2. Whole-branch adversarial review focused on: the scheduler (no double-fire, no burst, no `fireAt` mutation, catch-up correctness), the recurrence math (monthly skip, month boundaries, DST via local-component stepping), and the menu (Make shown only when non-recurring, Remove only when recurring; Delete still deletes the series).
3. (This ships bundled with the Reports Win98 reskin as v3.49.1.)

## Self-Review (author, done)

- **Spec coverage:** monthly frequency + lastFiredAt + anchor (T1); recurrence math (T1); scheduler reschedule/notifications (T2); month-view expansion + badge (T3); right-click Make/Remove (T4); validator (T1 Step 5, conditional). All covered.
- **Placeholder scan:** none — every step has concrete code/tests; T1 Step 5 and the test-harness notes point at real grep commands, not TODOs.
- **Type consistency:** `Repeat` union identical across recurrence.ts / Event / handlers; `nextOccurrence`/`occurrencesInLocalMonth` signatures match their T2/T3 callers; `lastFiredAt` written by T2, cleared by T4, tracked as `ISODate`. `Reminder.repeat` widened once (T1) and consumed everywhere after.
