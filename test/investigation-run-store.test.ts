/**
 * Task 4 — per-case run store + mount-independent onEvent singleton.
 *
 * The store (zustand, mirroring src/renderer/state/store.ts) is keyed by caseId so a
 * tab-switch unmount never loses a running feed and TWO cases never cross-contaminate
 * (`[[searchlight-panel-unmount-state]]`). The singleton subscribes to run.onEvent
 * exactly once and routes each `{runId, event}` to the case whose runId matches.
 *
 * Default node env; window.api is stubbed for the singleton portion.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RunEvent } from '@shared/investigation-agent';
import { formatRunEvent } from '../src/renderer/modules/investigation-graph/run-feed';
import { useInvestigationRunStore } from '../src/renderer/state/investigation-run-store';
import {
  startRunStream,
  __resetRunStreamForTest,
} from '../src/renderer/state/investigation-run-stream.singleton';

const store = () => useInvestigationRunStore.getState();

beforeEach(() => {
  useInvestigationRunStore.setState({ cases: {} });
});

describe('investigationRunStore — per-case reducers', () => {
  it('beginRun sets runId + running status and clears feed/pendingAsk', () => {
    store().applyEvent('caseA', { kind: 'ask', question: 'stale?' }); // dirty state
    store().beginRun('caseA', 'run-1');
    const e = store().cases['caseA'];
    expect(e.runId).toBe('run-1');
    expect(e.status).toBe('running');
    expect(e.feed).toEqual([]);
    expect(e.pendingAsk).toBeNull();
  });

  it('applyEvent folds action / observed into the feed via formatRunEvent', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'action', transformId: 'whois', entityValue: 'evil.tld' });
    store().applyEvent('caseA', { kind: 'observed', newEntities: 2 });
    expect(store().cases['caseA'].feed).toEqual([
      formatRunEvent({ kind: 'action', transformId: 'whois', entityValue: 'evil.tld' }),
      formatRunEvent({ kind: 'observed', newEntities: 2 }),
    ]);
  });

  it('ask sets pendingAsk and keeps status running', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'ask', question: 'Which domain is the real target?' });
    const e = store().cases['caseA'];
    expect(e.pendingAsk).toBe('Which domain is the real target?');
    expect(e.status).toBe('running');
    expect(e.feed.at(-1)).toEqual(formatRunEvent({ kind: 'ask', question: 'Which domain is the real target?' }));
  });

  it('a subsequent action clears the pending ask (agent moved on)', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'ask', question: 'which?' });
    store().applyEvent('caseA', { kind: 'action', transformId: 'dns', entityValue: 'a.tld' });
    expect(store().cases['caseA'].pendingAsk).toBeNull();
  });

  it('paused → paused; resumed → running (clears nothing else)', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'ask', question: 'q?' });
    store().applyEvent('caseA', { kind: 'paused' });
    expect(store().cases['caseA'].status).toBe('paused');
    store().applyEvent('caseA', { kind: 'resumed' });
    const e = store().cases['caseA'];
    expect(e.status).toBe('running');
    expect(e.pendingAsk).toBe('q?'); // resumed clears nothing
  });

  it('stopped / done → terminal status + a reason line in the feed', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'stopped', reason: 'analyst stopped the run' });
    let e = store().cases['caseA'];
    expect(e.status).toBe('stopped');
    expect(e.feed.at(-1)).toEqual(formatRunEvent({ kind: 'stopped', reason: 'analyst stopped the run' }));

    store().beginRun('caseB', 'run-2');
    store().applyEvent('caseB', { kind: 'done', reason: 'budget exhausted' });
    e = store().cases['caseB'];
    expect(e.status).toBe('done');
    expect(e.feed.at(-1)).toEqual(formatRunEvent({ kind: 'done', reason: 'budget exhausted' }));
  });

  it('setAvailable sets the probe result and preserves an in-flight run', () => {
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'action', transformId: 'whois', entityValue: 'e' });
    store().setAvailable('caseA', true);
    const e = store().cases['caseA'];
    expect(e.available).toBe(true);
    expect(e.runId).toBe('run-1');
    expect(e.feed).toHaveLength(1); // run state untouched
  });

  it('setAvailable works before any run exists for the case', () => {
    store().setAvailable('caseA', false);
    const e = store().cases['caseA'];
    expect(e.available).toBe(false);
    expect(e.status).toBe('idle');
    expect(e.runId).toBeNull();
  });

  it('reset clears the run but keeps the availability probe result', () => {
    store().setAvailable('caseA', true);
    store().beginRun('caseA', 'run-1');
    store().applyEvent('caseA', { kind: 'action', transformId: 'whois', entityValue: 'e' });
    store().reset('caseA');
    const e = store().cases['caseA'];
    expect(e.runId).toBeNull();
    expect(e.status).toBe('idle');
    expect(e.feed).toEqual([]);
    expect(e.pendingAsk).toBeNull();
    expect(e.available).toBe(true);
  });

  it('the feed is capped (store folds through appendCapped)', () => {
    store().beginRun('caseA', 'run-1');
    for (let i = 0; i < 250; i++) {
      store().applyEvent('caseA', { kind: 'observed', newEntities: i });
    }
    expect(store().cases['caseA'].feed).toHaveLength(200);
  });

  it('two caseIds NEVER cross-contaminate — applying to caseA leaves caseB untouched', () => {
    store().beginRun('caseA', 'run-A');
    store().beginRun('caseB', 'run-B');
    const beforeB = store().cases['caseB'];
    store().applyEvent('caseA', { kind: 'action', transformId: 'whois', entityValue: 'a.tld' });
    store().applyEvent('caseA', { kind: 'done', reason: 'finished A' });
    expect(store().cases['caseA'].status).toBe('done');
    expect(store().cases['caseA'].feed).toHaveLength(2);
    // caseB is byte-for-byte what it was.
    expect(store().cases['caseB']).toEqual(beforeB);
    expect(store().cases['caseB'].status).toBe('running');
    expect(store().cases['caseB'].feed).toEqual([]);
  });
});

describe('investigation run stream singleton', () => {
  let emit: ((p: { runId: string; event: RunEvent }) => void) | null = null;
  let subscribeCount = 0;
  const off = vi.fn();

  beforeEach(() => {
    emit = null;
    subscribeCount = 0;
    off.mockReset();
    vi.stubGlobal('window', {
      api: {
        investigation: {
          run: {
            onEvent: (cb: (p: { runId: string; event: RunEvent }) => void) => {
              subscribeCount += 1;
              emit = cb;
              return off;
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    __resetRunStreamForTest();
    vi.unstubAllGlobals();
  });

  it('routes an onEvent payload to the case whose runId matches', () => {
    store().beginRun('caseA', 'run-A');
    store().beginRun('caseB', 'run-B');
    startRunStream();
    emit!({ runId: 'run-B', event: { kind: 'action', transformId: 'dns', entityValue: 'b.tld' } });
    expect(store().cases['caseB'].feed).toEqual([
      formatRunEvent({ kind: 'action', transformId: 'dns', entityValue: 'b.tld' }),
    ]);
    expect(store().cases['caseA'].feed).toEqual([]); // wrong runId never touched caseA
  });

  it('drops events for an unknown runId without throwing', () => {
    store().beginRun('caseA', 'run-A');
    startRunStream();
    expect(() =>
      emit!({ runId: 'ghost-run', event: { kind: 'observed', newEntities: 1 } }),
    ).not.toThrow();
    expect(store().cases['caseA'].feed).toEqual([]);
  });

  it('is idempotent — subscribes to onEvent exactly once', () => {
    startRunStream();
    startRunStream();
    startRunStream();
    expect(subscribeCount).toBe(1);
  });

  it('__resetRunStreamForTest unsubscribes so a fresh start re-subscribes', () => {
    startRunStream();
    expect(subscribeCount).toBe(1);
    __resetRunStreamForTest();
    expect(off).toHaveBeenCalledTimes(1);
    startRunStream();
    expect(subscribeCount).toBe(2);
  });
});
