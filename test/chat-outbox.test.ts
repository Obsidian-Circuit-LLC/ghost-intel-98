import { describe, it, expect } from 'vitest';
import { Outbox, OutboxError, MAX_OUTBOX } from '../src/main/chat/outbox';

describe('chat outbox state machine', () => {
  it('enqueues in queued state and dedups by id (idempotent)', () => {
    const ob = new Outbox();
    const a = ob.enqueue('m1', 0);
    expect(a.state).toBe('queued');
    const again = ob.enqueue('m1', 0); // retry of the same id
    expect(again).toEqual(a);
    expect(ob.size).toBe(1); // no duplicate inserted
  });

  it('rejects a negative/non-integer seq', () => {
    const ob = new Outbox();
    expect(() => ob.enqueue('m', -1)).toThrow(OutboxError);
    expect(() => ob.enqueue('m', 1.5)).toThrow(OutboxError);
  });

  it('walks the happy path queued → sent → delivered', () => {
    const ob = new Outbox();
    ob.enqueue('m1', 0);
    expect(ob.markSent('m1').state).toBe('sent');
    expect(ob.markDelivered('m1').state).toBe('delivered');
  });

  it('rejects invalid transitions and unknown ids', () => {
    const ob = new Outbox();
    ob.enqueue('m1', 0);
    expect(() => ob.markDelivered('m1')).toThrow(OutboxError); // queued → delivered not allowed
    ob.markSent('m1');
    ob.markDelivered('m1');
    expect(() => ob.markSent('m1')).toThrow(OutboxError); // delivered is terminal
    expect(() => ob.markSent('nope')).toThrow(OutboxError); // unknown id
  });

  it('supports failed → retry(queued) → sent', () => {
    const ob = new Outbox();
    ob.enqueue('m1', 0);
    expect(ob.markFailed('m1').state).toBe('failed');
    expect(ob.retry('m1').state).toBe('queued');
    expect(ob.markSent('m1').state).toBe('sent');
  });

  it('transitions are idempotent (no-op to the same state)', () => {
    const ob = new Outbox();
    ob.enqueue('m1', 0);
    ob.markSent('m1');
    expect(ob.markSent('m1').state).toBe('sent'); // idempotent, no throw
  });

  it('nextQueued returns the lowest-seq queued entry, skipping non-queued', () => {
    const ob = new Outbox();
    ob.enqueue('m2', 2);
    ob.enqueue('m0', 0);
    ob.enqueue('m1', 1);
    expect(ob.nextQueued()?.id).toBe('m0');
    ob.markSent('m0');
    expect(ob.nextQueued()?.id).toBe('m1'); // m0 no longer queued
    ob.markSent('m1');
    ob.markSent('m2');
    expect(ob.nextQueued()).toBeNull(); // nothing queued
  });

  it('entries() returns a seq-ordered snapshot; pruneDelivered drops delivered', () => {
    const ob = new Outbox();
    ob.enqueue('m1', 1);
    ob.enqueue('m0', 0);
    expect(ob.entries().map((e) => e.id)).toEqual(['m0', 'm1']);
    ob.markSent('m0');
    ob.markDelivered('m0');
    expect(ob.pruneDelivered()).toBe(1);
    expect(ob.entries().map((e) => e.id)).toEqual(['m1']);
  });

  it('enforces the depth cap on undelivered entries (delivered do not count)', () => {
    const ob = new Outbox();
    for (let i = 0; i < MAX_OUTBOX; i += 1) ob.enqueue(`m${i}`, i);
    expect(() => ob.enqueue('overflow', MAX_OUTBOX)).toThrow(OutboxError);
    // deliver one → frees a slot
    ob.markSent('m0');
    ob.markDelivered('m0');
    expect(() => ob.enqueue('nowfits', MAX_OUTBOX + 1)).not.toThrow();
  });

  it('restores from a persisted snapshot', () => {
    const ob = new Outbox([
      { id: 'm0', seq: 0, state: 'delivered' },
      { id: 'm1', seq: 1, state: 'queued' }
    ]);
    expect(ob.size).toBe(2);
    expect(ob.nextQueued()?.id).toBe('m1');
    expect(ob.byId('m0')?.state).toBe('delivered');
  });
});
