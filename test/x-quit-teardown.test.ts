/**
 * X-9: App-quit teardown — SIGKILL backstop kills the active sidecar child.
 *
 * Verifies that calling killSidecar() while a job is in progress (simulating
 * the `app.on('will-quit')` handler registered in src/main/index.ts) kills the
 * child process synchronously, causing runJob() to resolve with status 'error'
 * and errorCode 'SIDECAR_CRASH'.
 *
 * The "hang" scenario in test/fixtures/mock-x-sidecar.mjs is used: the mock
 * sidecar completes the ping/pong handshake and then hangs indefinitely without
 * ever sending a terminal frame.
 *
 * Covered:
 *   - killSidecar() while job is running → SIDECAR_CRASH (the quit path)
 *   - killSidecar() with no active child → no-op (idempotent)
 *   - killSidecar() after sealed sidecar-missing run → no-op
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';

// Must mock electron before importing sidecar-client.ts.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/dcs98-test-nonexistent',
    resourcesPath: '/dcs98-test-nonexistent/resources',
  },
}));

import {
  runJob,
  killSidecar,
  __setSidecarPathForTest,
  __setSpawnForTest,
  __setPinnedShaForTest,
  __resetForTest,
} from '../src/main/x/sidecar-client';
import type { XSidecarRequest } from '../src/main/x/sidecar-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_SIDECAR = join(__dirname, 'fixtures', 'mock-x-sidecar.mjs');
const DUMMY_REQ: XSidecarRequest = { type: 'search', query: 'quit-test', limit: 10 };

function mockSpawn(scenario: string) {
  return (_cmd: string, _args: string[], opts: SpawnOptions) =>
    spawn(process.execPath, [MOCK_SIDECAR, scenario], opts);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetForTest();
  // The mock fixture's hash never matches the production linux pin; neutralise it
  // so runJob spawns the child instead of short-circuiting with SHA_MISMATCH
  // (which would leave _activeChild null and make killSidecar a no-op).
  __setPinnedShaForTest({ win32: '', linux: '', darwin: '' });
});

afterEach(() => {
  // Defensive: kill any leftover child from a test that didn't call killSidecar itself.
  killSidecar();
  __resetForTest();
});

// ---------------------------------------------------------------------------
// X-9: quit-while-running
// ---------------------------------------------------------------------------

describe('X-9: app-quit teardown', () => {
  it(
    'killSidecar() while a job is running kills the child and resolves to SIDECAR_CRASH',
    { timeout: 10_000 },
    async () => {
      __setSidecarPathForTest(MOCK_SIDECAR);
      __setSpawnForTest(mockSpawn('hang') as Parameters<typeof __setSpawnForTest>[0]);

      // Start the job without awaiting — the mock sidecar completes the ping/pong
      // handshake and then hangs, never sending a terminal frame.
      const jobPromise = runJob(DUMMY_REQ, undefined, () => {}, 'quit-test-job');

      // Allow enough time for: spawn → ping → pong → search request written.
      // 300 ms is well above the ~1–2 ms IPC round-trip in a local Node process.
      await new Promise<void>((r) => setTimeout(r, 300));

      // Simulate the app will-quit handler calling killSidecar().
      // This SIGKILLs the child synchronously.
      killSidecar();

      // The readline loop detects the child exit (no terminal frame was sent)
      // and resolves with SIDECAR_CRASH.  The finally block in runJob then waits
      // up to SHUTDOWN_WAIT_MS (3 s) before returning — the 10 s timeout above
      // provides the necessary headroom.
      const result = await jobPromise;

      expect(result.status).toBe('error');
      expect(result.errorCode).toBe('SIDECAR_CRASH');
      expect(result.jobId).toBe('quit-test-job');
    },
  );

  it('killSidecar() is idempotent — no error when no child is active', () => {
    // No job has been started; _activeChild is null.
    expect(() => killSidecar()).not.toThrow();
    // Calling again is still safe.
    expect(() => killSidecar()).not.toThrow();
  });

  it('killSidecar() is a no-op after a sealed sidecar-missing run', async () => {
    // With no binary at the default sealed path, runJob returns immediately
    // (existsSync check fails before spawn — _activeChild is never set).
    const result = await runJob(DUMMY_REQ, undefined, () => {}, 'sealed-job');
    expect(result.status).toBe('sidecar-missing');

    // killSidecar on a never-spawned child must not throw.
    expect(() => killSidecar()).not.toThrow();
  });
});
