// Pure, deterministic plain-language formatting for the run event feed (SP-6 cockpit).
// No Date.now / Math.random — the feed narrates events exactly as they arrive.
import type { RunEvent } from '@shared/investigation-agent';

export type FeedSeverity = 'info' | 'action' | 'warn' | 'done';

export interface FeedLine {
  text: string;
  severity: FeedSeverity;
}

/** Map a single run event to one plain-language feed line. Never surfaces raw
 *  machine syntax (`run-transform whois e1`) — always analyst-readable prose. */
export function formatRunEvent(e: RunEvent): FeedLine {
  switch (e.kind) {
    case 'action':
      return { text: `Running ${e.transformId} on ${e.entityValue}`, severity: 'action' };
    case 'observed':
      return {
        text: `Found ${e.newEntities} new ${e.newEntities === 1 ? 'entity' : 'entities'}`,
        severity: 'info',
      };
    case 'blocked':
      return { text: `Held back: ${e.reason}`, severity: 'warn' };
    case 'ask':
      return { text: e.question, severity: 'info' };
    case 'thinking':
      return { text: e.text, severity: 'info' };
    case 'paused':
      return { text: 'Paused', severity: 'info' };
    case 'resumed':
      return { text: 'Resumed', severity: 'info' };
    case 'stopped':
      return { text: `Stopped: ${e.reason}`, severity: 'done' };
    case 'done':
      return { text: `Done: ${e.reason}`, severity: 'done' };
  }
}

/** Append a line to the feed, returning a fresh array capped to the last `cap`
 *  lines. The input array is never mutated. */
export function appendCapped(feed: FeedLine[], line: FeedLine, cap = 200): FeedLine[] {
  const next = [...feed, line];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
