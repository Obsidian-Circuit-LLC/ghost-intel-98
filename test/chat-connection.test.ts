import { describe, it, expect } from 'vitest';
import { Connection, type ConnectionEvents } from '../src/main/chat/connection';
import { createPipe } from '../src/main/chat/transport';
import { encodeFrame, FrameType } from '../src/main/chat/wire';
import { Session, encodeEnvelope, decodeEnvelope, type Role } from '../src/main/chat/session';
import { randomBytes } from '../src/main/chat/crypto';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Build two connections over a pipe with paired sessions (as a real handshake would produce). */
function linkedPair(evI: ConnectionEvents = {}, evR: ConnectionEvents = {}): { I: Connection; R: Connection } {
  const sessionId = randomBytes(16);
  const rootKey = randomBytes(32);
  const [sa, sb] = createPipe();
  const I = new Connection(sa, new Session(sessionId, rootKey, 'initiator' as Role), evI);
  const R = new Connection(sb, new Session(sessionId, rootKey, 'responder' as Role), evR);
  return { I, R };
}

describe('chat connection', () => {
  it('delivers an encrypted message and acks it back', async () => {
    const received: string[] = [];
    const acked: number[] = [];
    const { I, R } = linkedPair({ onAck: (c) => acked.push(c) }, {
      onMessage: (env) => received.push(decodeEnvelope(env).text)
    });
    const counter = I.sendMessage(encodeEnvelope({ type: 'text', text: 'hello' }));
    await flush();
    expect(received).toEqual(['hello']);
    await flush(); // let the ack travel back
    expect(acked).toEqual([counter]);
  });

  it('carries messages both directions in order', async () => {
    const atR: string[] = [];
    const atI: string[] = [];
    const { I, R } = linkedPair({ onMessage: (e) => atI.push(decodeEnvelope(e).text) }, {
      onMessage: (e) => atR.push(decodeEnvelope(e).text)
    });
    I.sendMessage(encodeEnvelope({ type: 'text', text: 'a' }));
    I.sendMessage(encodeEnvelope({ type: 'text', text: 'b' }));
    await flush();
    R.sendMessage(encodeEnvelope({ type: 'text', text: 'c' }));
    await flush();
    expect(atR).toEqual(['a', 'b']);
    expect(atI).toEqual(['c']);
  });

  it('fires onActivity on inbound frames (presence) and ping is benign', async () => {
    let activity = 0;
    const { I, R } = linkedPair({}, { onActivity: () => (activity += 1) });
    I.sendPing();
    await flush();
    expect(activity).toBeGreaterThanOrEqual(1);
  });

  it('tears down fail-closed on a replayed/forged message frame', async () => {
    const sessionId = randomBytes(16);
    const rootKey = randomBytes(32);
    const [sa, sb] = createPipe();
    let rClosed = '';
    const I = new Connection(sa, new Session(sessionId, rootKey, 'initiator' as Role), {});
    const R = new Connection(sb, new Session(sessionId, rootKey, 'responder' as Role), {
      onClose: (r) => (rClosed = r)
    });
    // Genuine message advances R's recv counter to 1.
    I.sendMessage(encodeEnvelope({ type: 'text', text: 'genuine' }));
    await flush();
    expect(R.closed).toBe(false);
    // Inject a frame re-encrypting counter 0 (a fresh initiator session resets the counter) → R sees
    // counter 0 < recvCounter 1 → SessionError(replay) → fail-closed teardown.
    const forged = new Session(sessionId, rootKey, 'initiator' as Role);
    sa.send(encodeFrame(FrameType.Msg, forged.encrypt(encodeEnvelope({ type: 'text', text: 'replay' }))));
    await flush();
    expect(rClosed).toContain('session-error');
    expect(R.closed).toBe(true);
    void I;
  });

  it('propagates a graceful peer close', async () => {
    let iClosed = '';
    const { I, R } = linkedPair({ onClose: (r) => (iClosed = r) }, {});
    R.close();
    await flush();
    expect(R.closed).toBe(true);
    expect(I.closed).toBe(true);
    expect(iClosed).toBe('peer-close');
  });

  it('sendMessage after close throws', async () => {
    const { I } = linkedPair();
    I.close();
    await flush();
    expect(() => I.sendMessage(encodeEnvelope({ type: 'text', text: 'x' }))).toThrow();
  });
});
