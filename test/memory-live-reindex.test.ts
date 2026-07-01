import { describe, it, expect, vi } from 'vitest';
import { createLiveReindexer, type LiveReindexDeps } from '../src/main/services/memory/live-reindex';

// Fake timer/clock harness: deps.schedule/deps.cancel drive a manually-advanced queue so the
// debounce logic is exercised deterministically without real wall-clock time.
function makeFakeDeps(overrides?: Partial<LiveReindexDeps>) {
  let time = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const now = () => time;
  const schedule = (fn: () => void, ms: number) => {
    const handle = nextHandle++;
    pending.set(handle, { at: time + ms, fn });
    return handle;
  };
  const cancel = (handle: unknown) => { pending.delete(handle as number); };
  const advance = (ms: number) => {
    time += ms;
    // run everything due, in handle-insertion order (stable/deterministic)
    for (const [handle, entry] of [...pending.entries()]) {
      if (entry.at <= time) {
        pending.delete(handle);
        entry.fn();
      }
    }
  };

  const reindexCase = vi.fn(async (_caseId: string) => undefined);
  const reindexConversations = vi.fn(async () => undefined);

  const deps: LiveReindexDeps = {
    reindexCase,
    reindexConversations,
    now,
    schedule,
    cancel,
    ...overrides
  };
  return { deps, advance, reindexCase, reindexConversations };
}

describe('createLiveReindexer (debounced)', () => {
  it('coalesces three rapid caseChanged(c1) calls into exactly one reindexCase(c1) after flush', async () => {
    const { deps, advance, reindexCase } = makeFakeDeps();
    const r = createLiveReindexer(deps, 1500);
    r.caseChanged('c1');
    advance(100);
    r.caseChanged('c1');
    advance(100);
    r.caseChanged('c1');
    advance(2000); // past the debounce window, should have fired via schedule
    await r.flush();
    expect(reindexCase).toHaveBeenCalledTimes(1);
    expect(reindexCase).toHaveBeenCalledWith('c1');
  });

  it('tracks distinct case ids separately: caseChanged(c1) + caseChanged(c2) both reindexed once', async () => {
    const { deps, reindexCase } = makeFakeDeps();
    const r = createLiveReindexer(deps, 1500);
    r.caseChanged('c1');
    r.caseChanged('c2');
    await r.flush();
    expect(reindexCase).toHaveBeenCalledTimes(2);
    expect(reindexCase.mock.calls.map((c) => c[0]).sort()).toEqual(['c1', 'c2']);
  });

  it('coalesces conversationsChanged to a single reindexConversations call', async () => {
    const { deps, reindexConversations } = makeFakeDeps();
    const r = createLiveReindexer(deps, 1500);
    r.conversationsChanged();
    r.conversationsChanged();
    r.conversationsChanged();
    await r.flush();
    expect(reindexConversations).toHaveBeenCalledTimes(1);
  });

  it('a throwing reindexCase does not reject flush() (best-effort)', async () => {
    const { deps } = makeFakeDeps({
      reindexCase: vi.fn(async () => { throw new Error('boom'); })
    });
    const r = createLiveReindexer(deps, 1500);
    r.caseChanged('c1');
    await expect(r.flush()).resolves.toBeUndefined();
  });

  it('a throwing reindexConversations does not reject flush() (best-effort)', async () => {
    const { deps } = makeFakeDeps({
      reindexConversations: vi.fn(async () => { throw new Error('boom'); })
    });
    const r = createLiveReindexer(deps, 1500);
    r.conversationsChanged();
    await expect(r.flush()).resolves.toBeUndefined();
  });

  it('flush() with nothing pending resolves immediately and calls nothing', async () => {
    const { deps, reindexCase, reindexConversations } = makeFakeDeps();
    const r = createLiveReindexer(deps, 1500);
    await r.flush();
    expect(reindexCase).not.toHaveBeenCalled();
    expect(reindexConversations).not.toHaveBeenCalled();
  });
});
