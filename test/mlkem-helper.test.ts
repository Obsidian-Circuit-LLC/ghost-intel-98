/**
 * Real ML-KEM-1024 sidecar binary checks. Spawns the bundled AWS-LC helper directly (the protocol
 * the MlkemSidecar client speaks — MlkemSidecar itself imports electron, so we drive the binary
 * here) and cross-validates it against an INDEPENDENT ML-KEM-1024 implementation (@noble). Agreement
 * between two independent FIPS-203 implementations is a strong correctness/interop check. Skipped on
 * platforms whose helper binary isn't present (e.g. CI before the per-platform build).
 *
 * Also asserts the crypto.ts seam fails closed when no provider is installed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { mlkemKeygen, setMlkemProvider, CryptoError } from '../src/main/chat/crypto';

const PUB = 1568, SEC = 3168, CT = 1568, SS = 32;

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
const BIN = join(__dirname, '..', 'resources', 'mlkem', platformDir(), process.platform === 'win32' ? 'mlkem-helper.exe' : 'mlkem-helper');
const present = existsSync(BIN);

/** Minimal client for the helper's op(1)|len(4 BE)|payload ⇄ status(1)|len(4 BE)|payload protocol. */
class Helper {
  proc: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private waiter: ((r: { st: number; pl: Buffer }) => void) | null = null;
  constructor() {
    this.proc = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc.stdout.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
  }
  private pump(): void {
    if (!this.waiter || this.buf.length < 5) return;
    const len = this.buf.readUInt32BE(1);
    if (this.buf.length < 5 + len) return;
    const st = this.buf[0]; const pl = Buffer.from(this.buf.subarray(5, 5 + len));
    this.buf = Buffer.from(this.buf.subarray(5 + len));
    const w = this.waiter; this.waiter = null; w({ st, pl });
  }
  req(op: number, payload = Buffer.alloc(0)): Promise<{ st: number; pl: Buffer }> {
    return new Promise((res) => {
      this.waiter = res;
      const h = Buffer.alloc(5); h[0] = op; h.writeUInt32BE(payload.length, 1);
      this.proc.stdin.write(h); if (payload.length) this.proc.stdin.write(payload);
    });
  }
  stop(): void { try { this.proc.stdin.end(); this.proc.kill(); } catch { /* gone */ } }
}

const helper = present ? new Helper() : null;
afterAll(() => helper?.stop());

const d = present ? describe : describe.skip;

d('ML-KEM-1024 AWS-LC helper binary', () => {
  it('keygen returns correctly-sized public/secret keys', async () => {
    const r = await helper!.req(1);
    expect(r.st).toBe(0);
    expect(r.pl.length).toBe(PUB + SEC);
  });

  it('helper encapsulate ↔ @noble decapsulate agree (cross-implementation)', async () => {
    const kg = await helper!.req(1);
    const pub = kg.pl.subarray(0, PUB), sk = kg.pl.subarray(PUB);
    const en = await helper!.req(2, Buffer.from(pub));
    expect(en.st).toBe(0);
    expect(en.pl.length).toBe(CT + SS);
    const ct = en.pl.subarray(0, CT), ssHelper = en.pl.subarray(CT);
    const ssNoble = ml_kem1024.decapsulate(new Uint8Array(ct), new Uint8Array(sk));
    expect(Buffer.from(ssNoble).equals(Buffer.from(ssHelper))).toBe(true);
  });

  it('@noble encapsulate ↔ helper decapsulate agree (cross-implementation)', async () => {
    const kp = ml_kem1024.keygen();
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(kp.publicKey);
    const de = await helper!.req(3, Buffer.concat([Buffer.from(cipherText), Buffer.from(kp.secretKey)]));
    expect(de.st).toBe(0);
    expect(de.pl.length).toBe(SS);
    expect(Buffer.from(sharedSecret).equals(de.pl)).toBe(true);
  });

  it('rejects a wrong-length public key (status=error)', async () => {
    const r = await helper!.req(2, Buffer.alloc(10));
    expect(r.st).toBe(1);
  });
});

describe('ML-KEM crypto seam', () => {
  it('fails closed when no provider is installed (no in-process fallback)', async () => {
    setMlkemProvider(null);
    try {
      await expect(mlkemKeygen()).rejects.toThrow(CryptoError);
    } finally {
      // restore the in-process test provider for any subsequent tests in this file
      setMlkemProvider({
        keygen: async () => { const k = ml_kem1024.keygen(); return { publicKey: k.publicKey, secretKey: k.secretKey }; },
        encapsulate: async (p) => { const e = ml_kem1024.encapsulate(p); return { cipherText: e.cipherText, sharedSecret: e.sharedSecret }; },
        decapsulate: async (c, s) => ml_kem1024.decapsulate(c, s)
      });
    }
  });
});
