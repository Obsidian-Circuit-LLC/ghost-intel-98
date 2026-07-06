import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import afterPack, { sufficientVoskModel, VOSK_MODEL_MIN_BYTES } from '../scripts/afterpack-verify.cjs';

describe('sufficientVoskModel size-floor', () => {
  it('rejects an empty/truncated model', () => {
    expect(sufficientVoskModel(0)).toBe(false);
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES - 1)).toBe(false);
  });
  it('accepts a full-size model (floor inclusive)', () => {
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES)).toBe(true);
    expect(sufficientVoskModel(40 * 1024 * 1024)).toBe(true);
  });
});

// Exercises the ACTUAL integration wiring (assertVoskModel/afterPack), not just the pure
// sufficientVoskModel predicate — a regression here (typo'd path, inverted condition, or a
// deleted assertVoskModel call) would previously slip past `pnpm test` undetected.
describe('afterPack — Vosk model presence/size guard (integration)', () => {
  const dirs: string[] = [];
  function makeAppOutDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'afterpack-vosk-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it('throws when resources/vosk/model.tar.gz is missing', async () => {
    const appOutDir = makeAppOutDir();
    await expect(afterPack({ appOutDir, electronPlatformName: 'linux' })).rejects.toThrow(/MISSING/);
  });

  it('throws when resources/vosk/model.tar.gz is present but under the size floor', async () => {
    const appOutDir = makeAppOutDir();
    const voskDir = join(appOutDir, 'resources', 'vosk');
    mkdirSync(voskDir, { recursive: true });
    writeFileSync(join(voskDir, 'model.tar.gz'), Buffer.alloc(VOSK_MODEL_MIN_BYTES - 1));
    await expect(afterPack({ appOutDir, electronPlatformName: 'linux' })).rejects.toThrow(/too small/);
  });

  it('does not throw when resources/vosk/model.tar.gz meets the size floor', async () => {
    const appOutDir = makeAppOutDir();
    const voskDir = join(appOutDir, 'resources', 'vosk');
    mkdirSync(voskDir, { recursive: true });
    writeFileSync(join(voskDir, 'model.tar.gz'), Buffer.alloc(VOSK_MODEL_MIN_BYTES));
    // Non-win32 platform: afterPack returns right after the Vosk check, so this also proves the
    // guard runs unconditionally ahead of the win32-only embedding-stack checks.
    await expect(afterPack({ appOutDir, electronPlatformName: 'linux' })).resolves.toBeUndefined();
  });
});
