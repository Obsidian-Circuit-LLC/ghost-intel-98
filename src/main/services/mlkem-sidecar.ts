/**
 * ML-KEM-1024 sidecar client (main process). The ML-KEM leg of the chat handshake is served by a
 * bundled native helper that links AWS-LC's libcrypto — NOT in-process JS — so the KEM has an audited,
 * constant-time-designed implementation isolated from the V8 JIT. FIPS: when the helper is built from
 * AWS-LC's FIPS-validated release it is the validated module and runs a power-on self-test at init; a
 * regular/cross build (e.g. the current Windows mingw helper) is functionally correct ML-KEM-1024 but
 * NOT the validated module. This module is the client: it spawns the long-lived helper,
 * speaks a tiny length-prefixed stdio protocol, and implements the `MlkemProvider` that crypto.ts
 * delegates to. Fail-closed: a missing/again-hash-mismatched/dead helper makes every ML-KEM op reject;
 * there is NO in-process fallback by design.
 *
 * Wire protocol (binary, big-endian lengths; requests serialized one at a time):
 *   request  = op(1) ‖ len(4) ‖ payload
 *     op 1 keygen      payload: (none)
 *     op 2 encapsulate payload: peerPublic(1568)
 *     op 3 decapsulate payload: ciphertext(1568) ‖ secretKey(3168)
 *   response = status(1) ‖ len(4) ‖ payload
 *     status 0 OK   payload: keygen→ pub(1568)‖sk(3168); encap→ ct(1568)‖ss(32); decap→ ss(32)
 *     status 1 ERR  payload: utf8 message
 */
import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  MLKEM_PUBLIC_LEN, MLKEM_SECRET_LEN, MLKEM_CT_LEN, SHARED_SECRET_LEN,
  type MlkemProvider, type KeyPair
} from '../chat/crypto';

const OP_KEYGEN = 1;
const OP_ENCAP = 2;
const OP_DECAP = 3;
const OP_TIMEOUT_MS = 10_000;

/** Per-platform pinned helper SHA-256 (verify-before-exec, fail-closed). Empty ⇒ dev/unpinned: the
 *  binary must still exist, but its hash isn't checked. CI pins these alongside fetch-mlkem.mjs. */
const PINNED_SHA256: Record<string, string> = {
  win32: 'b955444d5f06d5beb4c3d5f4135d8ad4c2c14f8f8ccd91d3f3127f2a7a945b31',
  linux: '028cd33a7fbcc03999683b77e653c17e33fd43da4c89ef9f9aaa2c79927a75c3',
  darwin: '' // no mac helper built yet
};

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
function binaryName(): string {
  return process.platform === 'win32' ? 'mlkem-helper.exe' : 'mlkem-helper';
}
function helperPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'mlkem', platformDir(), binaryName());
}

export class MlkemSidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlkemSidecarError';
  }
}

/** Long-lived ML-KEM helper. Construct, `start()` (verifies + spawns), use as an MlkemProvider, then
 *  `stop()` on chat disable / quit teardown. */
export class MlkemSidecar implements MlkemProvider {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private pending: { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private dead: Error | null = null;

  async start(): Promise<void> {
    const bin = helperPath();
    if (!existsSync(bin)) throw new MlkemSidecarError(`ML-KEM helper not found at ${bin}`);
    const want = PINNED_SHA256[process.platform] ?? '';
    if (want) {
      const got = createHash('sha256').update(await readFile(bin)).digest('hex');
      if (got !== want.toLowerCase()) throw new MlkemSidecarError('ML-KEM helper SHA-256 mismatch (refusing to run)');
    }
    const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.dead = null;
    proc.stdout.on('data', (d: Buffer) => this.onData(d));
    proc.on('exit', (code) => this.fail(new MlkemSidecarError(`ML-KEM helper exited (${code})`)));
    proc.on('error', (e) => this.fail(new MlkemSidecarError(`ML-KEM helper error: ${e.message}`)));
    // Liveness self-test: a keygen round-trip confirms the helper is alive and returns correct sizes.
    // (This is a liveness check, NOT a FIPS power-on self-test — that only runs in a FIPS-module build.)
    const kp = await this.keygen();
    if (kp.publicKey.length !== MLKEM_PUBLIC_LEN || kp.secretKey.length !== MLKEM_SECRET_LEN) {
      throw new MlkemSidecarError('ML-KEM helper self-test returned wrong sizes');
    }
  }

  stop(): void {
    const p = this.proc;
    this.proc = null;
    this.fail(new MlkemSidecarError('ML-KEM helper stopped'));
    try { p?.kill(); } catch { /* already gone */ }
  }

  private fail(e: Error): void {
    this.dead = e;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(e); this.pending = null; }
    // Kill a wedged/misbehaving helper so it can't linger (e.g. after a timeout); exit/error paths
    // re-enter fail() harmlessly (the process is already gone).
    const p = this.proc; this.proc = null; try { p?.kill(); } catch { /* already gone */ }
  }

  private onData(d: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (!this.pending || this.buf.length < 5) return;
    const len = this.buf.readUInt32BE(1);
    // Fast-fail an oversized/malformed frame instead of buffering up to 4 GiB. The largest legitimate
    // response is a keygen (pub+sk); errors are short ascii — both well under this bound.
    if (len > MLKEM_PUBLIC_LEN + MLKEM_SECRET_LEN) { this.fail(new MlkemSidecarError('ML-KEM helper response too large')); return; }
    if (this.buf.length < 5 + len) return;
    const status = this.buf[0];
    const payload = this.buf.subarray(5, 5 + len);
    const rest = this.buf.subarray(5 + len);
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    const out = Buffer.from(payload); // copy before we drop the backing buffer
    this.buf = Buffer.from(rest);
    if (status === 0) p.resolve(out);
    else p.reject(new MlkemSidecarError(`ML-KEM helper: ${out.toString('utf8') || 'error'}`));
  }

  /** Serialize requests: one outstanding op at a time over the single pipe. */
  private request(op: number, payload: Uint8Array): Promise<Buffer> {
    const run = (): Promise<Buffer> => new Promise<Buffer>((resolve, reject) => {
      if (this.dead || !this.proc) { reject(this.dead ?? new MlkemSidecarError('ML-KEM helper not started')); return; }
      const header = Buffer.alloc(5);
      header[0] = op;
      header.writeUInt32BE(payload.length, 1);
      const timer = setTimeout(() => { this.pending = null; this.fail(new MlkemSidecarError('ML-KEM helper timed out')); reject(new MlkemSidecarError('ML-KEM helper timed out')); }, OP_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      this.proc.stdin.write(header);
      if (payload.length) this.proc.stdin.write(Buffer.from(payload));
    });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async keygen(): Promise<KeyPair> {
    const out = await this.request(OP_KEYGEN, new Uint8Array(0));
    if (out.length !== MLKEM_PUBLIC_LEN + MLKEM_SECRET_LEN) throw new MlkemSidecarError('bad keygen response length');
    return {
      publicKey: new Uint8Array(out.subarray(0, MLKEM_PUBLIC_LEN)),
      secretKey: new Uint8Array(out.subarray(MLKEM_PUBLIC_LEN))
    };
  }

  async encapsulate(peerPublic: Uint8Array): Promise<{ cipherText: Uint8Array; sharedSecret: Uint8Array }> {
    const out = await this.request(OP_ENCAP, peerPublic);
    if (out.length !== MLKEM_CT_LEN + SHARED_SECRET_LEN) throw new MlkemSidecarError('bad encapsulate response length');
    return {
      cipherText: new Uint8Array(out.subarray(0, MLKEM_CT_LEN)),
      sharedSecret: new Uint8Array(out.subarray(MLKEM_CT_LEN))
    };
  }

  async decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
    const payload = new Uint8Array(cipherText.length + secretKey.length);
    payload.set(cipherText, 0);
    payload.set(secretKey, cipherText.length);
    const out = await this.request(OP_DECAP, payload);
    if (out.length !== SHARED_SECRET_LEN) throw new MlkemSidecarError('bad decapsulate response length');
    return new Uint8Array(out);
  }
}
