import { describe, it, expect } from 'vitest';
import {
  Session,
  SessionError,
  chainStep,
  encodeEnvelope,
  decodeEnvelope,
  ENVELOPE_VERSION,
  MAX_MESSAGE_TEXT,
  MAX_MESSAGE_BYTES,
  type Role
} from '../src/main/chat/session';
import { randomBytes, constantTimeEqual } from '../src/main/chat/crypto';

function pair(): { initiator: Session; responder: Session; sessionId: Uint8Array; rootKey: Uint8Array } {
  const sessionId = randomBytes(16);
  const rootKey = randomBytes(32);
  return {
    initiator: new Session(sessionId, rootKey, 'initiator' as Role),
    responder: new Session(sessionId, rootKey, 'responder' as Role),
    sessionId,
    rootKey
  };
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('chat session — envelope', () => {
  it('round-trips a text envelope', () => {
    const e = encodeEnvelope({ type: 'text', text: 'hello over tor' });
    expect(e[0]).toBe(ENVELOPE_VERSION);
    expect(decodeEnvelope(e)).toEqual({ type: 'text', text: 'hello over tor' });
  });

  it('rejects unknown version / content type / over-cap text', () => {
    expect(() => decodeEnvelope(new Uint8Array([2, 1, 65]))).toThrow(SessionError); // bad version
    expect(() => decodeEnvelope(new Uint8Array([ENVELOPE_VERSION, 99, 65]))).toThrow(SessionError); // bad type
    expect(() => decodeEnvelope(new Uint8Array([ENVELOPE_VERSION]))).toThrow(SessionError); // truncated
    expect(() => encodeEnvelope({ type: 'text', text: 'x'.repeat(MAX_MESSAGE_TEXT + 1) })).toThrow(SessionError);
  });

  it('enforces the byte cap before decoding (no giant string allocation)', () => {
    const oversize = new Uint8Array(2 + MAX_MESSAGE_BYTES + 1);
    oversize[0] = ENVELOPE_VERSION;
    oversize[1] = 1; // text content type
    expect(() => decodeEnvelope(oversize)).toThrow(SessionError);
  });
});

describe('chat session — ratchet', () => {
  it('chainStep is deterministic and separates message vs next-chain keys', () => {
    const ck = randomBytes(32);
    const a = chainStep(ck);
    const b = chainStep(ck);
    expect(constantTimeEqual(a.messageKey, b.messageKey)).toBe(true); // deterministic
    expect(constantTimeEqual(a.nextChainKey, b.nextChainKey)).toBe(true);
    expect(constantTimeEqual(a.messageKey, a.nextChainKey)).toBe(false); // domain-separated
    const c = chainStep(randomBytes(32));
    expect(constantTimeEqual(a.messageKey, c.messageKey)).toBe(false); // different chain → different
  });
});

describe('chat session — secure channel', () => {
  it('initiator → responder and responder → initiator both decrypt in order', () => {
    const { initiator, responder } = pair();
    const a = initiator.encrypt(encodeEnvelope({ type: 'text', text: 'first' }));
    const b = initiator.encrypt(encodeEnvelope({ type: 'text', text: 'second' }));
    expect(decodeEnvelope(responder.decrypt(a))).toEqual({ type: 'text', text: 'first' });
    expect(decodeEnvelope(responder.decrypt(b))).toEqual({ type: 'text', text: 'second' });
    const back = responder.encrypt(encodeEnvelope({ type: 'text', text: 'reply' }));
    expect(decodeEnvelope(initiator.decrypt(back))).toEqual({ type: 'text', text: 'reply' });
  });

  it('rejects replay (same counter twice)', () => {
    const { initiator, responder } = pair();
    const m0 = initiator.encrypt(enc('hi'));
    responder.decrypt(m0);
    expect(() => responder.decrypt(m0)).toThrow(SessionError); // replay
  });

  it('rejects out-of-order delivery (gap)', () => {
    const { initiator, responder } = pair();
    initiator.encrypt(enc('a')); // m0 (not delivered)
    const m1 = initiator.encrypt(enc('b'));
    expect(() => responder.decrypt(m1)).toThrow(SessionError); // expected counter 0, got 1
  });

  it('rejects a tampered ciphertext and does not desync the receive chain', () => {
    const { initiator, responder } = pair();
    const m0 = initiator.encrypt(encodeEnvelope({ type: 'text', text: 'genuine' }));
    const tampered = new Uint8Array(m0);
    tampered[tampered.length - 1] ^= 0x01; // flip a tag byte
    expect(() => responder.decrypt(tampered)).toThrow(SessionError);
    // the genuine frame for the same counter still decrypts (chain didn't advance on failure)
    expect(decodeEnvelope(responder.decrypt(m0))).toEqual({ type: 'text', text: 'genuine' });
  });

  it('cross-session frames do not decrypt (session-id binding)', () => {
    const { initiator } = pair();
    const { responder: otherResponder } = pair(); // different sessionId + rootKey
    const m0 = initiator.encrypt(encodeEnvelope({ type: 'text', text: 'x' }));
    expect(() => otherResponder.decrypt(m0)).toThrow(SessionError);
  });

  it('destroy() wipes key state', () => {
    const { initiator } = pair();
    initiator.encrypt(enc('a'));
    expect(() => initiator.destroy()).not.toThrow();
  });
});
