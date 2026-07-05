import { describe, it, expect } from 'vitest';
import type { RunEvent } from '@shared/investigation-agent';
import { formatRunEvent, appendCapped, type FeedLine } from '../src/renderer/modules/investigation-graph/run-feed';

describe('formatRunEvent', () => {
  it('action → "Running <transformId> on <entityValue>" (action severity)', () => {
    const e: RunEvent = { kind: 'action', transformId: 'whois', entityValue: 'evil.tld' };
    expect(formatRunEvent(e)).toEqual({ text: 'Running whois on evil.tld', severity: 'action' });
  });

  it('observed → "Found N new entities" (info severity), pluralised for 1', () => {
    expect(formatRunEvent({ kind: 'observed', newEntities: 3 })).toEqual({ text: 'Found 3 new entities', severity: 'info' });
    expect(formatRunEvent({ kind: 'observed', newEntities: 1 })).toEqual({ text: 'Found 1 new entity', severity: 'info' });
    expect(formatRunEvent({ kind: 'observed', newEntities: 0 })).toEqual({ text: 'Found 0 new entities', severity: 'info' });
  });

  it('blocked → "Held back: <reason>" (warn severity)', () => {
    expect(formatRunEvent({ kind: 'blocked', reason: 'target not authorized' }))
      .toEqual({ text: 'Held back: target not authorized', severity: 'warn' });
  });

  it('ask → the question verbatim (info severity)', () => {
    expect(formatRunEvent({ kind: 'ask', question: 'Which domain is the real target?' }))
      .toEqual({ text: 'Which domain is the real target?', severity: 'info' });
  });

  it('thinking → its text (info severity)', () => {
    expect(formatRunEvent({ kind: 'thinking', text: 'Considering the frontier' }))
      .toEqual({ text: 'Considering the frontier', severity: 'info' });
  });

  it('paused / resumed → info severity', () => {
    expect(formatRunEvent({ kind: 'paused' })).toEqual({ text: 'Paused', severity: 'info' });
    expect(formatRunEvent({ kind: 'resumed' })).toEqual({ text: 'Resumed', severity: 'info' });
  });

  it('stopped → "Stopped: <reason>" (done severity)', () => {
    expect(formatRunEvent({ kind: 'stopped', reason: 'analyst stopped the run' }))
      .toEqual({ text: 'Stopped: analyst stopped the run', severity: 'done' });
  });

  it('done → "Done: <reason>" (done severity)', () => {
    expect(formatRunEvent({ kind: 'done', reason: 'objective met' }))
      .toEqual({ text: 'Done: objective met', severity: 'done' });
  });

  it('is pure — same input yields an equal (but fresh) object each call', () => {
    const e: RunEvent = { kind: 'action', transformId: 'whois', entityValue: 'evil.tld' };
    const a = formatRunEvent(e);
    const b = formatRunEvent(e);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('appendCapped', () => {
  const mk = (n: number): FeedLine => ({ text: `line ${n}`, severity: 'info' });

  it('appends the line to a fresh array (does not mutate the input)', () => {
    const feed: FeedLine[] = [mk(0)];
    const next = appendCapped(feed, mk(1));
    expect(next).toEqual([mk(0), mk(1)]);
    expect(feed).toEqual([mk(0)]); // input untouched
    expect(next).not.toBe(feed);
  });

  it('keeps only the last `cap` lines (default 200)', () => {
    let feed: FeedLine[] = [];
    for (let i = 0; i < 250; i++) feed = appendCapped(feed, mk(i));
    expect(feed.length).toBe(200);
    expect(feed[0]).toEqual(mk(50));
    expect(feed[199]).toEqual(mk(249));
  });

  it('honours an explicit cap', () => {
    let feed: FeedLine[] = [];
    for (let i = 0; i < 5; i++) feed = appendCapped(feed, mk(i), 3);
    expect(feed).toEqual([mk(2), mk(3), mk(4)]);
  });
});
