/**
 * Fuzz harness for the chat untrusted-input parsers (Gate 1 §3). These decode attacker-controlled
 * bytes off the Tor stream / invite link, so the property formal methods don't cover is: for ANY
 * input the parser either returns a well-formed result or throws its DECLARED error type — never an
 * unexpected exception (RangeError/TypeError from a bug), never OOM on a hostile length, never a hang,
 * and never non-canonical garbage. Inputs are driven by a seeded PRNG so any failure is reproducible
 * (determinism floor). No ML-KEM provider needed — none of these paths decapsulate.
 */
import { describe, it, expect } from 'vitest';
import {
  FrameDecoder, FrameType, encodeFrame, FrameError, WIRE_VERSION, MAX_FRAME_PAYLOAD
} from '../src/main/chat/wire';
import {
  decodeKemPrekey, encodeKemPrekey, decodeIdentityPublic, encodeIdentityPublic,
  IdentityError, generateIdentity, ed25519Pair, KEM_PREKEY_LEN, PREKEY_ID_LEN, IDENTITY_PUBLIC_LEN
} from '../src/main/chat/identity';
import { parseInvite, createInvite, InviteError, INVITE_PREFIX } from '../src/main/chat/invite';
import { ed25519Sign, MLKEM_PUBLIC_LEN } from '../src/main/chat/crypto';
import { DS_PREKEY, SUITE_ID, concatBytes } from '../src/main/chat/constants';

// ---- deterministic PRNG (mulberry32) + byte helpers ----
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ri = (rng: () => number, n: number): number => Math.floor(rng() * n);
function randBytes(rng: () => number, len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) b[i] = ri(rng, 256);
  return b;
}
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function randOnion(rng: () => number): string {
  let s = '';
  for (let i = 0; i < 56; i += 1) s += B32[ri(rng, 32)];
  return `${s}.onion`;
}
const ITER = 1500;

describe('fuzz: FrameDecoder', () => {
  it('only ever throws FrameError on arbitrary bytes fed in arbitrary chunk splits', () => {
    const rng = makeRng(0xF1);
    for (let n = 0; n < ITER; n += 1) {
      const total = randBytes(rng, ri(rng, 80));
      const dec = new FrameDecoder();
      try {
        let off = 0;
        while (off < total.length) { const take = 1 + ri(rng, total.length - off); dec.push(total.slice(off, off + take)); off += take; }
        dec.push(new Uint8Array(0));
      } catch (e) {
        expect(e, `seed-iter ${n}`).toBeInstanceOf(FrameError); // never a RangeError/TypeError
      }
    }
  });

  it('rejects a hostile declared length immediately (no giant allocation / OOM)', () => {
    // header: version, type=Msg, len = 0xFFFFFFFF (≈4 GiB) — must throw the cap error, not allocate.
    const hdr = Uint8Array.of(WIRE_VERSION, FrameType.Msg, 0xff, 0xff, 0xff, 0xff);
    expect(() => new FrameDecoder().push(hdr)).toThrow(FrameError);
    // exactly-at-cap+1 declared length also rejected
    const over = MAX_FRAME_PAYLOAD + 1;
    const hdr2 = Uint8Array.of(WIRE_VERSION, FrameType.Msg, (over >>> 24) & 0xff, (over >>> 16) & 0xff, (over >>> 8) & 0xff, over & 0xff);
    expect(() => new FrameDecoder().push(hdr2)).toThrow(FrameError);
  });

  it('reconstructs valid frames split at every byte boundary, and a concatenated batch in order', () => {
    const rng = makeRng(0xF2);
    for (let n = 0; n < 200; n += 1) {
      const payload = randBytes(rng, ri(rng, 40));
      const frame = encodeFrame(FrameType.Msg, payload);
      const dec = new FrameDecoder();
      const got: Uint8Array[] = [];
      for (const byte of frame) got.push(...dec.push(Uint8Array.of(byte)).map((f) => f.payload)); // 1 byte at a time
      expect(got).toHaveLength(1);
      expect(Array.from(got[0])).toEqual(Array.from(payload));
    }
    // three frames concatenated, fed in random splits → three payloads in order
    const rng2 = makeRng(0xF3);
    const ps = [randBytes(rng2, 5), randBytes(rng2, 0), randBytes(rng2, 17)];
    const stream = concatBytes(...ps.map((p) => encodeFrame(FrameType.Ack, p)));
    const dec = new FrameDecoder();
    const out: Uint8Array[] = [];
    let off = 0;
    while (off < stream.length) { const take = 1 + ri(rng2, stream.length - off); out.push(...dec.push(stream.slice(off, off + take)).map((f) => f.payload)); off += take; }
    expect(out.map((p) => p.length)).toEqual(ps.map((p) => p.length));
  });
});

describe('fuzz: fixed-layout decoders', () => {
  it('decodeKemPrekey: only IdentityError; canonical round-trip when accepted', () => {
    const rng = makeRng(0xA1);
    for (let n = 0; n < ITER; n += 1) {
      const bytes = randBytes(rng, ri(rng, KEM_PREKEY_LEN + 8));
      try {
        const p = decodeKemPrekey(bytes);
        expect(Array.from(encodeKemPrekey(p)), `iter ${n}`).toEqual(Array.from(bytes)); // canonical
      } catch (e) {
        expect(e, `iter ${n}`).toBeInstanceOf(IdentityError);
      }
    }
    // a structurally-valid buffer decodes; a bad is_last_resort flag (2) is rejected
    const good = new Uint8Array(KEM_PREKEY_LEN); good[PREKEY_ID_LEN] = 1;
    expect(() => decodeKemPrekey(good)).not.toThrow();
    const bad = new Uint8Array(KEM_PREKEY_LEN); bad[PREKEY_ID_LEN] = 2;
    expect(() => decodeKemPrekey(bad)).toThrow(IdentityError);
  });

  it('decodeIdentityPublic: only IdentityError; round-trips a 64-byte bundle', () => {
    const rng = makeRng(0xA2);
    for (let n = 0; n < ITER; n += 1) {
      const bytes = randBytes(rng, ri(rng, IDENTITY_PUBLIC_LEN + 4));
      try {
        const id = decodeIdentityPublic(bytes);
        expect(Array.from(encodeIdentityPublic(id))).toEqual(Array.from(bytes));
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityError);
      }
    }
  });
});

describe('fuzz: parseInvite', () => {
  it('only ever throws InviteError on arbitrary strings (prefixed and not)', () => {
    const rng = makeRng(0xB1);
    for (let n = 0; n < ITER; n += 1) {
      const raw = randBytes(rng, ri(rng, 120));
      const b64 = Buffer.from(raw).toString('base64url');
      // mix: raw garbage, prefixed garbage, prefixed base64, and near-miss prefixes
      const variants = [
        String.fromCharCode(...raw.map((x) => 32 + (x % 95))),
        INVITE_PREFIX + b64,
        INVITE_PREFIX + String.fromCharCode(...raw.map((x) => 32 + (x % 95))),
        'dcs98chat://invite/' + '='.repeat(n % 5)
      ];
      for (const link of variants) {
        try { parseInvite(link); } catch (e) { expect(e, `iter ${n}`).toBeInstanceOf(InviteError); }
      }
    }
  });

  it('accepts a canonically-built valid invite (positive round-trip)', () => {
    const rng = makeRng(0xB2);
    const id = generateIdentity();
    const onion = randOnion(rng);
    const prekeyId = randBytes(rng, PREKEY_ID_LEN);
    const pk = randBytes(rng, MLKEM_PUBLIC_LEN);
    // replicate identity.ts prekeySignedMessage so verifyKemPrekey accepts (no ML-KEM provider needed)
    const prekeyMsg = concatBytes(DS_PREKEY, SUITE_ID, id.publicKeys.ed25519, prekeyId, Uint8Array.of(0), pk);
    const signature = ed25519Sign(prekeyMsg, ed25519Pair(id));
    const prekey = { prekeyId, isLastResort: false, publicKey: pk, signature };
    const token = randBytes(rng, 32);
    const link = createInvite({ responder: id, onion, prekey, token });
    const parsed = parseInvite(link);
    expect(parsed.onion).toBe(onion);
    expect(Array.from(parsed.token)).toEqual(Array.from(token));
    expect(Array.from(parsed.responderPublic.ed25519)).toEqual(Array.from(id.publicKeys.ed25519));
  });
});
