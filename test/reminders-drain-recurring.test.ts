import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real reminder store runs against real files without an Electron runtime (same pattern as
// test/invoice-store.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-reminders-drain-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { rm } from 'node:fs/promises';
import { reminderStore } from '../src/main/storage/json-fs';
import { globalRemindersFile } from '../src/main/storage/paths';
import type { Reminder } from '../src/shared/types';

async function resetGlobals(): Promise<void> {
  // Wipe the global reminders file between tests (store has no _resetForTest seam).
  await rm(globalRemindersFile(), { force: true }).catch(() => {});
}

describe('reminderStore.drainDue — recurring reschedule', () => {
  beforeEach(async () => { await resetGlobals(); });

  it('fires a repeating reminder without setting fired, advances lastFiredAt, leaves fireAt immutable', async () => {
    const fireAt = new Date(2026, 6, 16, 18, 0, 0, 0); // Thu 2026-07-16 18:00 local
    await reminderStore.upsertGlobal({
      id: 'g1', title: 'CCF Call', fireAt: fireAt.toISOString(), repeat: 'weekly',
    } as Reminder);

    const now = new Date(2026, 6, 17, 9, 0, 0, 0); // the day after the anchor
    const due = await reminderStore.drainDue(now);

    const g1 = due.find((r) => r.id === 'g1');
    expect(g1).toBeTruthy();
    // Notified for THIS occurrence (the anchor), not mutating the stored fireAt.
    expect(new Date(g1!.fireAt).getTime()).toBe(fireAt.getTime());

    const stored = (await reminderStore.listGlobal()).find((r) => r.id === 'g1')!;
    expect(stored.fireAt).toBe(fireAt.toISOString()); // anchor unchanged
    expect(stored.fired).not.toBe(true);               // repeating reminders never latch fired
    expect(new Date(stored.lastFiredAt!).getTime()).toBe(fireAt.getTime()); // progress advanced
  });

  it('does not re-fire the same occurrence on a second drain at the same now', async () => {
    const fireAt = new Date(2026, 6, 16, 18, 0, 0, 0);
    await reminderStore.upsertGlobal({
      id: 'g1', title: 'CCF Call', fireAt: fireAt.toISOString(), repeat: 'weekly',
    } as Reminder);

    const now = new Date(2026, 6, 17, 9, 0, 0, 0);
    const first = await reminderStore.drainDue(now);
    expect(first.some((r) => r.id === 'g1')).toBe(true);

    const second = await reminderStore.drainDue(now);
    expect(second.some((r) => r.id === 'g1')).toBe(false); // next occurrence (Jul 23) is not yet due
  });

  it('a non-repeating due reminder fires once and latches fired = true (unchanged behavior)', async () => {
    const fireAt = new Date(2026, 6, 16, 18, 0, 0, 0);
    await reminderStore.upsertGlobal({
      id: 'g2', title: 'One-off', fireAt: fireAt.toISOString(),
    } as Reminder);

    const now = new Date(2026, 6, 17, 9, 0, 0, 0);
    const first = await reminderStore.drainDue(now);
    expect(first.some((r) => r.id === 'g2')).toBe(true);

    const stored = (await reminderStore.listGlobal()).find((r) => r.id === 'g2')!;
    expect(stored.fired).toBe(true);

    const second = await reminderStore.drainDue(now);
    expect(second.some((r) => r.id === 'g2')).toBe(false);
  });
});
