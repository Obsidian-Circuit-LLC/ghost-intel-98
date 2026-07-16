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
