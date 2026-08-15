/**
 * Ghost Social Media Manager — secure application-state store (Phase 1).
 *
 * Two concerns:
 *  1. Pure in-memory: the vault-locked gate (his `if (!unlocked) throw`), the default-state
 *     shape, state healing, and the SAFETY-CRITICAL `autoPostArmed` flag defaulting/coercion
 *     (G7 — only the literal `true` arms; a corrupt/absent flag reads as OFF).
 *  2. secure-fs round-trip: with the real `secureReadText`/`secureWriteFile` behind a reversible
 *     ENCX fake-vault, `saveGhostState` writes CIPHERTEXT (ENCX magic) to disk and `getGhostState`
 *     reads it back as plaintext — his raw `fs.writeFileSync` is replaced by encrypt-at-rest.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  defaultGhostState,
  normalizeGhostState,
  getGhostState,
  saveGhostState,
  isAutoPostArmed,
  setAutoPostArmed,
  type StoreDeps,
} from '../src/main/ghost-social/store';

// ── in-memory deps (gate + Map-backed IO) ─────────────────────────────────────
function memDeps(unlocked = true): { deps: StoreDeps; files: Map<string, string> } {
  const files = new Map<string, string>();
  const deps: StoreDeps = {
    isUnlocked: () => unlocked,
    read: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p) as string;
    },
    write: async (p, data) => {
      files.set(p, data);
    },
    exists: async (p) => files.has(p),
    statePath: '/mem/ghost-state.enc',
  };
  return { deps, files };
}

describe('ghost-social store — gate, defaults, healing, ARM flag', () => {
  it('returns the default state (one empty campaign, auto-post DISARMED) when no file exists', async () => {
    const { deps } = memDeps();
    const s = await getGhostState(deps);
    expect(s.selectedCampaignId).toBe('campaign-default');
    expect(s.campaigns).toHaveLength(1);
    expect(s.campaigns[0].accounts).toEqual([]);
    expect(s.autoPostArmed).toBe(false);
    expect(defaultGhostState().autoPostArmed).toBe(false);
  });

  it('refuses to read or write while the vault is locked (his gate)', async () => {
    const { deps } = memDeps(false);
    await expect(getGhostState(deps)).rejects.toThrow(/locked/i);
    await expect(saveGhostState(deps, defaultGhostState())).rejects.toThrow(/locked/i);
  });

  it('round-trips a saved state', async () => {
    const { deps } = memDeps();
    const next = defaultGhostState();
    next.campaigns[0].name = 'Renamed';
    next.scheduledPosts = [
      {
        id: 'j1',
        campaignId: 'campaign-default',
        text: 'hello',
        scheduledFor: '2026-08-20T00:00:00.000Z',
        destinationAccountIds: ['a1'],
        status: 'scheduled',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    ];
    await saveGhostState(deps, next);
    const back = await getGhostState(deps);
    expect(back.campaigns[0].name).toBe('Renamed');
    expect(back.scheduledPosts).toHaveLength(1);
    expect(back.scheduledPosts![0].text).toBe('hello');
  });

  it('heals array fields and NEVER reads a non-true ARM flag as armed (G7)', () => {
    // A truthy-but-not-true value (e.g. a string) must coerce to OFF.
    const healed = normalizeGhostState({
      campaigns: 'not-an-array',
      scheduledPosts: null,
      autoPostArmed: 'true',
    });
    expect(Array.isArray(healed.campaigns)).toBe(true);
    expect(healed.scheduledPosts).toEqual([]);
    expect(healed.autoPostArmed).toBe(false);

    expect(normalizeGhostState({ autoPostArmed: 1 }).autoPostArmed).toBe(false);
    expect(normalizeGhostState({ autoPostArmed: true }).autoPostArmed).toBe(true);
  });

  it('arm / disarm via the flag helpers', async () => {
    const { deps } = memDeps();
    expect(await isAutoPostArmed(deps)).toBe(false);
    await setAutoPostArmed(deps, true);
    expect(await isAutoPostArmed(deps)).toBe(true);
    await setAutoPostArmed(deps, false);
    expect(await isAutoPostArmed(deps)).toBe(false);
  });
});

// ── secure-fs ENCX round-trip ─────────────────────────────────────────────────
const DATA = join(tmpdir(), 'dcs98-ghost-social-store-test');
const MAGIC = Buffer.from('ENCX');
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff)),
  };
});

describe('ghost-social store — secure-fs encrypt-at-rest', () => {
  beforeEach(async () => {
    await mkdir(DATA, { recursive: true });
  });
  afterEach(async () => {
    await rm(DATA, { recursive: true, force: true });
  });

  it('writes ENCX ciphertext to disk and reads it back as plaintext state', async () => {
    const { secureReadText, secureWriteFile } = await import('../src/main/storage/secure-fs');
    const statePath = join(DATA, 'ghost-state.enc');
    const deps: StoreDeps = {
      isUnlocked: () => true,
      read: (p) => secureReadText(p),
      write: (p, data) => secureWriteFile(p, data),
      exists: async (p) => {
        const { access } = await import('node:fs/promises');
        try {
          await access(p);
          return true;
        } catch {
          return false;
        }
      },
      statePath,
    };

    const s = defaultGhostState();
    s.campaigns[0].name = 'Secret Campaign';
    await saveGhostState(deps, s);

    const onDisk = await readFile(statePath);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX'); // ciphertext on disk
    expect(onDisk.includes(Buffer.from('Secret Campaign'))).toBe(false); // plaintext not present

    const back = await getGhostState(deps);
    expect(back.campaigns[0].name).toBe('Secret Campaign'); // decrypts in-app
  });
});
