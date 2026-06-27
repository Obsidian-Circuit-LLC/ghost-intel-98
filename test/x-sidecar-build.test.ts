/**
 * X-8: PyInstaller sidecar build tests.
 *
 * Covers:
 *   - Python source exists and passes syntax check
 *   - Standalone NDJSON smoke: twscrape-runner.py responds ping → pong
 *   - Sealed seam: without twscrape installed, emits error{code:'TWSCRAPE_NOT_INSTALLED'}
 *     rather than silent done{count:0} (FAIL-LOUD invariant, spec §4)
 *   - Hash-mismatch: sidecar-client returns SHA_MISMATCH when a non-empty pin
 *     does not match the binary (verify-before-exec, spec §2.2)
 *   - Build script exists and is executable (operator gate)
 *   - requirements.txt has the correct version-pinned structure
 *
 * The real twscrape-runner binary does NOT exist in this build (sealed, spec §2.2).
 * The Python source is run directly with python3 for the protocol smoke tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  accessSync,
  chmodSync,
  constants,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Electron mock — required before importing sidecar-client
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/dcs98-x8-test-nonexistent',
    resourcesPath: '/dcs98-x8-test-nonexistent/resources',
  },
}));

import {
  runJob,
  killSidecar,
  __setSidecarPathForTest,
  __setPinnedShaForTest,
  __resetForTest,
} from '../src/main/x/sidecar-client';
import type { XSidecarRequest } from '../src/main/x/sidecar-client';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT     = join(__dirname, '..');
const RUNNER_DIR    = join(REPO_ROOT, 'resources', 'twscrape-runner');
const PY_SRC        = join(RUNNER_DIR, 'twscrape-runner.py');
const REQUIREMENTS  = join(RUNNER_DIR, 'requirements.txt');
const BUILD_SCRIPT  = join(REPO_ROOT, 'scripts', 'build-twscrape-runner.sh');
const BUILD_SCRIPT_BAT = join(REPO_ROOT, 'scripts', 'build-twscrape-runner.bat');
const PYTHON3       = process.env.PYTHON3 ?? 'python3';

const DUMMY_REQ: XSidecarRequest = { type: 'search', query: 'test', limit: 10 };

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetForTest();
});

afterEach(() => {
  killSidecar();
  __resetForTest();
});

// ---------------------------------------------------------------------------
// 1. Python source presence + syntax validity
// ---------------------------------------------------------------------------

describe('X-8: Python source', () => {
  it('twscrape-runner.py exists at the expected path', () => {
    expect(existsSync(PY_SRC)).toBe(true);
  });

  it('passes Python syntax check (py_compile)', () => {
    // -m py_compile exits 0 on valid syntax, non-zero on SyntaxError.
    const r = spawnSync(PYTHON3, ['-m', 'py_compile', PY_SRC], { encoding: 'utf8' });
    expect(r.status, `py_compile stderr: ${r.stderr}`).toBe(0);
  });

  it('has the module docstring documenting the SEALED state', () => {
    const src = readFileSync(PY_SRC, 'utf8');
    expect(src).toMatch(/SEALED/);
    expect(src).toMatch(/TWSCRAPE_NOT_INSTALLED/);
  });

  it('does not import twscrape at top-level (guarded import only)', () => {
    // The source must guard the import in a try/except block, not at module top-level.
    const src = readFileSync(PY_SRC, 'utf8');
    // There should be a try/except around the import
    expect(src).toMatch(/try:/);
    expect(src).toMatch(/ImportError/);
    // The bare 'import twscrape' must appear ONLY inside a try block, not at top level.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A top-level bare import would have no indentation.
      if (/^import twscrape/.test(line)) {
        throw new Error(
          `Line ${i + 1}: top-level 'import twscrape' found — must be inside try/except`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Standalone NDJSON smoke: ping → pong (no twscrape needed)
// ---------------------------------------------------------------------------

describe('X-8: standalone NDJSON smoke (direct Python, no binary needed)', () => {
  it('responds to {type:"ping"} with {type:"pong"}', async () => {
    const pong = await readOnePong();
    expect(pong).not.toBeNull();
    expect(pong?.type).toBe('pong');
  });

  it('shuts down cleanly after ping + shutdown', async () => {
    const exitCode = await pingThenShutdown();
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Sealed seam: TWSCRAPE_NOT_INSTALLED (FAIL-LOUD, spec §4)
// ---------------------------------------------------------------------------

describe('X-8: sealed seam — TWSCRAPE_NOT_INSTALLED', () => {
  it('emits error{code:TWSCRAPE_NOT_INSTALLED, fatal:true} when twscrape is absent', async () => {
    // twscrape is not installed in this repo (sealed).  Spawn twscrape-runner.py
    // directly with python3 and send a search request; it must emit an error frame.
    const frame = await collectFirstFrame('search');
    expect(frame).not.toBeNull();
    expect(frame?.type).toBe('error');
    expect(frame?.code).toBe('TWSCRAPE_NOT_INSTALLED');
    expect(frame?.fatal).toBe(true);
  });

  it('TWSCRAPE_NOT_INSTALLED is never treated as done or partial (FAIL-LOUD)', async () => {
    const frame = await collectFirstFrame('search');
    expect(frame?.type).not.toBe('done');
    expect(frame?.type).not.toBe('truncated');
  });

  it('error message mentions the build script (operator guidance)', async () => {
    const frame = await collectFirstFrame('search');
    // The message should point the operator toward the build gate.
    expect(frame?.message ?? '').toMatch(/build|scripts?|PyInstaller/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Hash-mismatch: sidecar-client returns SHA_MISMATCH (spec §2.2)
// ---------------------------------------------------------------------------

describe('X-8: hash-mismatch (verify-before-exec)', () => {
  let tmpDir: string;
  let fakeBin: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `x8-sha-${randomUUID().slice(0, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    fakeBin = join(tmpDir, 'fake-sidecar');
    writeFileSync(fakeBin, 'fake binary content for sha test');
    // Mark executable so spawn can attempt to run it (EACCES is otherwise unhandled
    // before the proc error handler fires).
    chmodSync(fakeBin, 0o755);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns SHA_MISMATCH when pin is set and binary content does not match', async () => {
    // Compute the real SHA of the fake binary.
    const realSha = createHash('sha256')
      .update(readFileSync(fakeBin))
      .digest('hex');
    // Use a deliberately wrong pin (flip one hex digit).
    const wrongSha = realSha.replace(/^./, realSha[0] === 'a' ? 'b' : 'a');

    __setSidecarPathForTest(fakeBin);
    __setPinnedShaForTest({ [process.platform]: wrongSha });

    const result = await runJob(DUMMY_REQ, undefined, () => {}, 'x8-sha-mismatch');
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('SHA_MISMATCH');
    expect(result.errorMessage).toMatch(/sha[-_]256|mismatch|verify/i);
  });

  it('does not run the binary when SHA_MISMATCH (no spawn occurs)', async () => {
    // The SIGKILL-able spawn seam is not overridden here; sidecar-client must
    // return before calling spawn when the SHA check fails.
    const realSha = createHash('sha256')
      .update(readFileSync(fakeBin))
      .digest('hex');
    const wrongSha = realSha.replace(/^./, realSha[0] === 'a' ? 'b' : 'a');

    __setSidecarPathForTest(fakeBin);
    __setPinnedShaForTest({ [process.platform]: wrongSha });

    const spawnCalled = vi.fn();
    const { __setSpawnForTest } = await import('../src/main/x/sidecar-client');
    __setSpawnForTest((..._args) => {
      spawnCalled();
      // Return a dummy that immediately exits — if spawn is somehow called.
      return spawn(process.execPath, ['--eval', 'process.exit(1)']);
    });

    await runJob(DUMMY_REQ, undefined, () => {}, 'x8-no-spawn');
    expect(spawnCalled).not.toHaveBeenCalled();
  });

  it('returns sidecar-missing (not SHA_MISMATCH) when binary is absent', async () => {
    // Even with a non-empty pin, if the file doesn't exist we get sidecar-missing,
    // not SHA_MISMATCH (existsSync runs before SHA check).
    __setPinnedShaForTest({ [process.platform]: 'a'.repeat(64) });
    // Path stays at the default non-existent production path.

    const result = await runJob(DUMMY_REQ, undefined, () => {}, 'x8-absent');
    expect(result.status).toBe('sidecar-missing');
  });

  it('runs successfully when pin matches the binary content', async () => {
    // Set the correct SHA — the client must proceed past verification.
    // The binary is 'fake binary content' which is not a real executable, so
    // spawn will immediately fail (SIDECAR_CRASH or EACCES), but the important
    // assertion is that status is NOT 'error' with code 'SHA_MISMATCH'.
    const correctSha = createHash('sha256')
      .update(readFileSync(fakeBin))
      .digest('hex');

    __setSidecarPathForTest(fakeBin);
    __setPinnedShaForTest({ [process.platform]: correctSha });

    const result = await runJob(DUMMY_REQ, undefined, () => {}, 'x8-sha-match');
    // SHA check passes — error is something else (not SHA_MISMATCH).
    expect(result.errorCode).not.toBe('SHA_MISMATCH');
    // status will be 'error' (SIDECAR_CRASH etc.) because the fake binary isn't runnable,
    // but the important invariant is the SHA step was passed.
    expect(result.status).not.toBe('sidecar-missing');
  }, 15_000);
});

// ---------------------------------------------------------------------------
// 5. Build script presence and permissions
// ---------------------------------------------------------------------------

describe('X-8: build scripts', () => {
  it('build-twscrape-runner.sh exists', () => {
    expect(existsSync(BUILD_SCRIPT)).toBe(true);
  });

  it('build-twscrape-runner.sh is executable', () => {
    // accessSync throws if the file lacks the requested permission.
    expect(() => accessSync(BUILD_SCRIPT, constants.X_OK)).not.toThrow();
  });

  it('build-twscrape-runner.bat exists (Windows build script)', () => {
    expect(existsSync(BUILD_SCRIPT_BAT)).toBe(true);
  });

  it('build script mentions --onedir (not --onefile) per spec §2.2', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(src).toMatch(/--onedir/);
    expect(src).not.toMatch(/--onefile/);
  });

  it('build script does NOT pass --noconsole (spec §2.2: would break IPC)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(src).not.toMatch(/--noconsole/);
    const batSrc = readFileSync(BUILD_SCRIPT_BAT, 'utf8');
    expect(batSrc).not.toMatch(/--noconsole/);
  });

  it('build script mentions --require-hashes (supply-chain gate, spec §5.7)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(src).toMatch(/--require-hashes/);
  });

  it('build script mentions SHA-256 output (for pinning into sidecar-client)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    expect(src).toMatch(/SHA[-_]?256|sha256|shasum/i);
  });
});

// ---------------------------------------------------------------------------
// 6. requirements.txt structure
// ---------------------------------------------------------------------------

describe('X-8: requirements.txt', () => {
  it('exists', () => {
    expect(existsSync(REQUIREMENTS)).toBe(true);
  });

  it('pins twscrape at a specific version', () => {
    const txt = readFileSync(REQUIREMENTS, 'utf8');
    expect(txt).toMatch(/twscrape==\d+\.\d+\.\d+/);
  });

  it('pins pyinstaller at a 6.x version (spec §2.2)', () => {
    const txt = readFileSync(REQUIREMENTS, 'utf8');
    expect(txt).toMatch(/pyinstaller==6\.\d+\.\d+/i);
  });

  it('references vladkens supply-chain verification (spec §5.7)', () => {
    const txt = readFileSync(REQUIREMENTS, 'utf8');
    expect(txt).toMatch(/vladkens/i);
  });

  it('documents the sealed / locked install process', () => {
    const txt = readFileSync(REQUIREMENTS, 'utf8');
    // Must mention the hash-pinning step or the build script.
    expect(txt).toMatch(/require-hashes|hash|locked?|build/i);
  });
});

// ---------------------------------------------------------------------------
// Helpers — spawn twscrape-runner.py directly with python3
// ---------------------------------------------------------------------------

/** Send `ping` then read the first JSON line (the pong response). */
async function readOnePong(): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON3, [PY_SRC], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let resolved = false;

    (proc.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1 && !resolved) {
        resolved = true;
        try {
          resolve(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        } catch {
          resolve(null);
        }
        try { proc.kill('SIGKILL'); } catch { /* gone */ }
      }
    });

    proc.once('exit', () => {
      if (!resolved) { resolved = true; resolve(null); }
    });

    // Send ping
    (proc.stdin as NodeJS.WritableStream).write(JSON.stringify({ type: 'ping' }) + '\n');

    // Safety timeout
    setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }, 8_000);
  });
}

/** Send ping, then shutdown; return exit code. */
async function pingThenShutdown(): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON3, [PY_SRC], { stdio: ['pipe', 'pipe', 'pipe'] });
    let gotPong = false;

    (proc.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const frame = JSON.parse(line) as Record<string, unknown>;
          if (frame.type === 'pong' && !gotPong) {
            gotPong = true;
            (proc.stdin as NodeJS.WritableStream).write(
              JSON.stringify({ type: 'shutdown' }) + '\n'
            );
          }
        } catch { /* ignore */ }
      }
    });

    proc.once('exit', (code) => resolve(code));

    (proc.stdin as NodeJS.WritableStream).write(JSON.stringify({ type: 'ping' }) + '\n');

    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
      resolve(null);
    }, 8_000);
  });
}

/**
 * Send ping then a job request; return the first non-pong frame.
 * Used to verify the TWSCRAPE_NOT_INSTALLED error frame.
 */
async function collectFirstFrame(
  jobType: 'search' | 'userTweets'
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON3, [PY_SRC], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let gotPong = false;
    let resolved = false;

    function finish(val: Record<string, unknown> | null): void {
      if (resolved) return;
      resolved = true;
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
      resolve(val);
    }

    (proc.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      // Keep the last (potentially incomplete) line in buf.
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (frame.type === 'pong' && !gotPong) {
          gotPong = true;
          // Send the job request
          const req: Record<string, unknown> = { type: jobType };
          if (jobType === 'search') req.query = 'test';
          if (jobType === 'userTweets') req.username = 'testuser';
          req.limit = 10;
          (proc.stdin as NodeJS.WritableStream).write(JSON.stringify(req) + '\n');
          continue;
        }

        if (frame.type !== 'pong') {
          finish(frame);
          return;
        }
      }
    });

    proc.once('exit', (code) => {
      if (!resolved) finish(null);
      void code;
    });

    (proc.stdin as NodeJS.WritableStream).write(JSON.stringify({ type: 'ping' }) + '\n');

    setTimeout(() => {
      if (!resolved) finish(null);
    }, 10_000);
  });
}
