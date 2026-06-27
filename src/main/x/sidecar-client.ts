/**
 * X/Twitter collector sidecar client (main process only).
 *
 * Manages the per-job twscrape-runner process lifecycle:
 *   existsSync → SHA verify → spawn → ping/pong → readline loop → SIGKILL teardown.
 *
 * SEALED: resources/twscrape-runner/ does NOT exist. sidecarPath() points at a
 * non-existent binary; runJob() existsSync-checks and returns
 * { status: 'sidecar-missing' } ("X collector sidecar not installed — pending
 * operator lock") — distinct from a runtime error, no silent skip, no stub.
 *
 * Wire protocol: NDJSON over stdout (spec §2.3). Each frame is a newline-terminated
 * JSON object. Per-line cap: 1 MB (§2.3). Every job terminates with exactly one of:
 *   done      { count, truncated }           — completed (truncated:false = full fetch)
 *   truncated { count, reason, message }     — stopped short for any reason
 *   error     { code, message, fatal }       — whole run (fatal:true) or mid-stream warning
 *
 * FAIL-LOUD invariants (spec §4):
 *   done { truncated:false, count>0 }  → status 'done'    (only truly complete result)
 *   done { count:0 }                   → status 'partial'  (zero-result guard, §4.4)
 *   done { truncated:true }            → status 'partial'
 *   truncated frame                    → status 'partial'
 *   error code:'DOC_ID_ROTATION'       → status 'breakage-detected' (§4.3)
 *   error other (fatal)                → status 'error'
 *
 * Credentials: passed in the stdin request payload, never argv or env (spec §2.4).
 * App-quit teardown: call killSidecar() from the will-quit handler (X-9).
 *
 * Quarantine invariants enforced here:
 *   - NO import from src/main/bgconn/*, src/main/chat/transport-tor,
 *     src/main/chat/socks5, src/main/searchlight/tor-socks, src/main/socmint/collector.
 *   - No network I/O in this module: all egress is the sidecar's own clearnet HTTPS.
 */

import { app } from 'electron';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status values for the X collector (spec §4.1). */
export type XCollectorStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'partial'
  | 'error'
  | 'sidecar-missing'
  | 'breakage-detected';

/** Raw tweet as delivered by the sidecar wire protocol (spec §1 field mapping). */
export interface RawTweet {
  id_str: string;
  /** ISO 8601 UTC timestamp from the platform. */
  date: string;
  rawContent: string;
  lang?: string;
  /** Permalink — must be scheme-guarded by caller before rendering. */
  url: string;
  user: {
    id_str: string;
    /** Handle without leading @. */
    username: string;
    displayname: string;
  };
  media?: Array<{ mediaType: 'photo' | 'video' | 'gif' }>;
}

/** Credentials passed in the stdin payload (never argv or env, never echoed). */
export interface XCreds {
  authToken?: string;
  ct0?: string;
  username?: string;
  password?: string;
}

/** Request frames written to sidecar stdin (spec §2.3). */
export type XSidecarRequest =
  | { type: 'search'; query: string; limit: number; since?: string; until?: string }
  | { type: 'userTweets'; username: string; limit: number; since?: string; until?: string };

/** Result returned by runJob to the caller (X-4 augments with itemsAdded/itemsSkipped). */
export interface XSidecarResult {
  status: XCollectorStatus;
  /** Total tweet frames received from the sidecar (before dedup). */
  totalFromSidecar: number;
  /** Present on 'partial' status. */
  truncationReason?: string;
  truncationMessage?: string;
  /** Present on 'error' and 'breakage-detected' status. */
  errorCode?: string;
  errorMessage?: string;
  jobId: string;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}

function binaryName(): string {
  return process.platform === 'win32' ? 'twscrape-runner.exe' : 'twscrape-runner';
}

/**
 * Production sidecar path (mirrors mlkem-sidecar.ts:54 pattern).
 * onedir layout: resources/twscrape-runner/<platform>/twscrape-runner/<binary>
 */
function productionSidecarPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  const plat = platformDir();
  return join(base, 'twscrape-runner', plat, 'twscrape-runner', binaryName());
}

/**
 * Per-platform pinned SHA-256 (verify-before-exec).
 * Empty string = dev/unpinned: binary must exist, hash is not checked.
 * Populated at build time by the X-8 build runner; empty until operator lock.
 */
const PINNED_SHA256: Record<string, string> = {
  win32:  '',
  linux:  '',
  darwin: '',
};

// ---------------------------------------------------------------------------
// Injection seams (test-only)
// ---------------------------------------------------------------------------

type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
let _spawnFn: SpawnFn = nodeSpawn as unknown as SpawnFn;
let _sidecarPathOverride: string | null = null;
/**
 * Override the per-platform SHA-256 pins for testing (X-8 hash-mismatch test).
 * Set to null to restore the production PINNED_SHA256 map.
 */
let _pinnedShaOverride: Record<string, string> | null = null;

export function __setSidecarPathForTest(p: string): void {
  _sidecarPathOverride = p;
}
export function __setSpawnForTest(fn: SpawnFn): void {
  _spawnFn = fn;
}
/** Override pinned SHA-256 map (test-only; X-8). Lets hash-mismatch tests set a non-empty pin. */
export function __setPinnedShaForTest(pins: Record<string, string>): void {
  _pinnedShaOverride = pins;
}
export function __resetForTest(): void {
  _spawnFn = nodeSpawn as unknown as SpawnFn;
  _sidecarPathOverride = null;
  _pinnedShaOverride = null;
}

// ---------------------------------------------------------------------------
// Public path accessor
// ---------------------------------------------------------------------------

/** Resolved sidecar path. May not exist — callers must existsSync-check. */
export function sidecarPath(): string {
  return _sidecarPathOverride ?? productionSidecarPath();
}

// ---------------------------------------------------------------------------
// Module-level child reference (for app-quit teardown, X-9)
// ---------------------------------------------------------------------------

let _activeChild: ChildProcess | null = null;

/** Synchronously SIGKILL the active sidecar, if any. Call from app will-quit (X-9). */
export function killSidecar(): void {
  const c = _activeChild;
  _activeChild = null;
  if (c) {
    try { c.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Wire protocol constants
// ---------------------------------------------------------------------------

const PING_TIMEOUT_MS = 10_000;
/** Per-line byte cap (spec §2.3: 1 MB → PROTOCOL_ERROR). */
const MAX_LINE_BYTES = 1_024 * 1_024;
const SHUTDOWN_WAIT_MS = 3_000;
const TWEET_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Core: runJob
// ---------------------------------------------------------------------------

/**
 * Run one X collector job.
 *
 * Lifecycle: existsSync → SHA verify → spawn → ping/pong → write request →
 * accumulate tweets → terminal frame → shutdown → SIGKILL → return result.
 *
 * Per-job process: spawned fresh, exits after the terminal frame. No cross-job
 * state accumulation.
 *
 * @param req     Collection request (search or userTweets).
 * @param creds   Operator-supplied account credentials (passed via stdin payload).
 * @param onItem  Callback called with each raw tweet in batches of 50.
 * @param jobId   Caller-supplied job ID (defaults to a new UUID).
 */
export async function runJob(
  req: XSidecarRequest,
  creds: XCreds | undefined,
  onItem: (tweet: RawTweet) => void,
  jobId: string = randomUUID(),
): Promise<XSidecarResult> {
  const binPath = sidecarPath();

  // 1. Binary absent → sealed-seam result (not a throw; sidecar-missing is a named status)
  if (!existsSync(binPath)) {
    return {
      status: 'sidecar-missing',
      totalFromSidecar: 0,
      errorMessage: 'X collector sidecar not installed — pending operator lock',
      jobId,
    };
  }

  // 2. SHA verify (only when pin is non-empty)
  const pins = _pinnedShaOverride ?? PINNED_SHA256;
  const pin = pins[process.platform] ?? '';
  if (pin) {
    const bytes = await readFile(binPath);
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== pin.toLowerCase()) {
      return {
        status: 'error',
        totalFromSidecar: 0,
        errorCode: 'SHA_MISMATCH',
        errorMessage: 'X sidecar SHA-256 mismatch — refusing to run (verify-before-exec)',
        jobId,
      };
    }
  }

  // 3. Spawn (per-job process; NEVER --noconsole; PYTHONUNBUFFERED prevents line-buffering)
  const proc = _spawnFn(binPath, [], {
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  _activeChild = proc;

  // 4. Scrub stderr (strip creds before logging)
  (proc.stderr as NodeJS.ReadableStream | null)?.on('data', (d: Buffer) => {
    const msg = d.toString('utf8')
      .replace(/auth_token=[^\s&"']*/gi, 'auth_token=[REDACTED]')
      .replace(/ct0=[^\s&"']*/gi, 'ct0=[REDACTED]')
      .replace(/password=[^\s&"']*/gi, 'password=[REDACTED]');
    console.warn('[x-sidecar stderr]', msg.trimEnd());
  });

  let result: XSidecarResult;

  try {
    result = await _runWithProc(proc, req, creds, onItem, jobId);
  } catch (err) {
    result = {
      status: 'error',
      totalFromSidecar: 0,
      errorCode: 'INTERNAL',
      errorMessage: err instanceof Error ? err.message : String(err),
      jobId,
    };
  } finally {
    // 5. Shutdown: write frame → wait ≤3s → SIGKILL
    try {
      (proc.stdin as NodeJS.WritableStream | null)?.write(JSON.stringify({ type: 'shutdown' }) + '\n');
    } catch { /* pipe may already be closed */ }

    await new Promise<void>((res) => {
      const timer = setTimeout(() => res(), SHUTDOWN_WAIT_MS);
      proc.once('exit', () => { clearTimeout(timer); res(); });
    });

    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    if (_activeChild === proc) _activeChild = null;
  }

  return result!;
}

// ---------------------------------------------------------------------------
// Internal: run the readline loop for a live process
// ---------------------------------------------------------------------------

function _runWithProc(
  proc: ChildProcess,
  req: XSidecarRequest,
  creds: XCreds | undefined,
  onItem: (tweet: RawTweet) => void,
  jobId: string,
): Promise<XSidecarResult> {
  return new Promise<XSidecarResult>((resolve, reject) => {
    const rl = createInterface({ input: proc.stdout as NodeJS.ReadableStream, crlfDelay: Infinity });
    let settled = false;
    let pongReceived = false;
    let pingTimer: ReturnType<typeof setTimeout> | null = null;
    let totalFromSidecar = 0;
    const batch: RawTweet[] = [];

    function flushBatch(): void {
      for (const t of batch) onItem(t);
      batch.length = 0;
    }

    function finish(r: XSidecarResult): void {
      if (settled) return;
      settled = true;
      rl.close();
      if (pingTimer !== null) { clearTimeout(pingTimer); pingTimer = null; }
      resolve(r);
    }

    function fail(e: Error): void {
      if (settled) return;
      settled = true;
      rl.close();
      if (pingTimer !== null) { clearTimeout(pingTimer); pingTimer = null; }
      reject(e);
    }

    // Suppress EPIPE/ECONNRESET on stdin: these happen when the sidecar exits early
    // (e.g. bad binary, ENOEXEC); the proc 'exit' or 'error' handler settles the promise.
    (proc.stdin as NodeJS.WritableStream).on('error', () => { /* handled by proc event handlers */ });

    // Raw-stream byte cap: abort an UNTERMINATED mega-line BEFORE readline buffers it all
    // into memory. The rl.on('line') cap below only fires after a whole line is assembled,
    // so on its own it cannot prevent the OOM it is meant to guard against. Track bytes
    // since the last newline across chunks; if an unterminated run exceeds the cap, fail
    // with PROTOCOL_ERROR. (X spec §2.3 hardening.)
    let pendingLineBytes = 0;
    (proc.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      if (settled) return;
      const nl = chunk.lastIndexOf(0x0a);
      pendingLineBytes = nl === -1 ? pendingLineBytes + chunk.length : chunk.length - nl - 1;
      if (pendingLineBytes > MAX_LINE_BYTES) {
        finish({
          status: 'error',
          totalFromSidecar,
          errorCode: 'PROTOCOL_ERROR',
          errorMessage: 'X sidecar: unterminated line exceeded 1 MB cap (spec §2.3)',
          jobId,
        });
      }
    });

    // Write ping and start timeout
    try {
      (proc.stdin as NodeJS.WritableStream).write(JSON.stringify({ type: 'ping' }) + '\n');
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    pingTimer = setTimeout(() => {
      pingTimer = null;
      fail(new Error('X sidecar: ping/pong timeout (10 s) — sidecar may be wedged'));
    }, PING_TIMEOUT_MS);

    rl.on('line', (line: string) => {
      if (settled) return;

      // Per-line 1 MB cap (spec §2.3)
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        finish({
          status: 'error',
          totalFromSidecar,
          errorCode: 'PROTOCOL_ERROR',
          errorMessage: 'X sidecar: line exceeded 1 MB cap (spec §2.3)',
          jobId,
        });
        return;
      }

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Non-JSON output (e.g. Python startup noise on stdout) — defensive ignore.
        return;
      }

      const type = frame.type as string;

      // ---- Pong (pre-request phase) ----------------------------------------
      if (!pongReceived) {
        if (type === 'pong') {
          pongReceived = true;
          if (pingTimer !== null) { clearTimeout(pingTimer); pingTimer = null; }
          // Write the request payload (creds embedded, never via argv/env)
          const wirePayload: Record<string, unknown> = { ...req };
          if (creds) wirePayload.creds = creds;
          try {
            (proc.stdin as NodeJS.WritableStream).write(JSON.stringify(wirePayload) + '\n');
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        } else {
          fail(new Error(`X sidecar: expected pong as first frame, got '${type}'`));
        }
        return;
      }

      // ---- Tweet frames (streaming phase) ----------------------------------
      if (type === 'tweet') {
        const tweet = frame.data as RawTweet;
        totalFromSidecar++;
        batch.push(tweet);
        if (batch.length >= TWEET_BATCH_SIZE) flushBatch();
        return;
      }

      // ---- Non-fatal mid-stream warning (does NOT replace terminal frame) --
      if (type === 'error' && frame.fatal === false) {
        console.warn('[x-sidecar warn]', frame.code, frame.message);
        return;
      }

      // ---- Terminal frames -------------------------------------------------
      flushBatch();

      if (type === 'done') {
        const count = typeof frame.count === 'number' ? frame.count : 0;
        const truncated = Boolean(frame.truncated);

        if (count === 0) {
          // §4.4: zero-result guard — 'done{count:0}' is never safe to treat as complete.
          finish({
            status: 'partial',
            totalFromSidecar,
            truncationReason: 'unknown',
            truncationMessage:
              'Sidecar reported done with zero results — may indicate breakage or an overly ' +
              'narrow query. Treat as inconclusive, not evidence of absence.',
            jobId,
          });
        } else if (truncated) {
          // done{truncated:true} — stopped early; treat same as explicit truncated frame.
          finish({
            status: 'partial',
            totalFromSidecar,
            truncationReason: 'sidecar-truncated',
            truncationMessage: 'Sidecar reported done but with truncation flag set.',
            jobId,
          });
        } else {
          // §2.3 invariant 2: the only truly complete result.
          finish({ status: 'done', totalFromSidecar, jobId });
        }
        return;
      }

      if (type === 'truncated') {
        finish({
          status: 'partial',
          totalFromSidecar,
          truncationReason: typeof frame.reason === 'string' ? frame.reason : undefined,
          truncationMessage: typeof frame.message === 'string' ? frame.message : undefined,
          jobId,
        });
        return;
      }

      if (type === 'error') {
        const code = typeof frame.code === 'string' ? frame.code : 'UNKNOWN';
        // §4.3: DOC_ID_ROTATION → 'breakage-detected' (persistent UI banner)
        const status: XCollectorStatus =
          code === 'DOC_ID_ROTATION' ? 'breakage-detected' : 'error';
        finish({
          status,
          totalFromSidecar,
          errorCode: code,
          errorMessage: typeof frame.message === 'string' ? frame.message : undefined,
          jobId,
        });
        return;
      }

      // Unknown terminal — treat as error to stay fail-loud.
      finish({
        status: 'error',
        totalFromSidecar,
        errorCode: 'UNKNOWN_FRAME',
        errorMessage: `X sidecar: unexpected terminal frame type '${type}'`,
        jobId,
      });
    });

    // Process exits without a terminal frame (crash / OOM / SIGKILL)
    proc.once('exit', (code) => {
      if (!settled) {
        flushBatch();
        finish({
          status: 'error',
          totalFromSidecar,
          errorCode: 'SIDECAR_CRASH',
          errorMessage: `X sidecar exited (code ${code}) without sending a terminal frame`,
          jobId,
        });
      }
    });

    // Spawn-level errors (EACCES, ENOEXEC, ENOENT on the binary path, etc.)
    // These fire before any stdout/exit event and would otherwise become unhandled exceptions.
    proc.once('error', (err: NodeJS.ErrnoException) => {
      if (!settled) {
        flushBatch();
        finish({
          status: 'error',
          totalFromSidecar,
          errorCode: err.code ?? 'SPAWN_ERROR',
          errorMessage: `X sidecar spawn failed: ${err.message}`,
          jobId,
        });
      }
    });
  });
}
