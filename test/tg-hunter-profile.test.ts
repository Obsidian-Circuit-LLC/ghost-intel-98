/**
 * Task TG3 — Telegram visible profile fields (honesty-critical).
 *
 * Plan B ports GhostExodus's Telegram Hunter profile scan onto the Plan-A hardened
 * window. These tests pin the honesty-critical guarantees on PURE functions plus the
 * static in-page payload — no electron, no network:
 *
 *  1. `TG_PROFILE_SCRIPT` is a STATIC in-page payload — its un-evaluated source holds
 *     NO `${…}` interpolation (scraped content can never be spliced into executed code)
 *     and NO in-page `fetch()` (unlike the source, which fetched the avatar blob
 *     unrestricted; the port returns the avatar SRC for host-restricted resolution in
 *     the collector). Ported from quarantine `renderer.js` `extractionScript` profile block.
 *  2. `normalizeProfile` maps a captured profile panel → a `TgProfile`, honest by
 *     construction:
 *       - the visible display name is stored ONLY when shown and is NEVER backfilled
 *         from the @handle (nor from a page heading — the source's `||heads[0]` refused);
 *       - the phone is stored ONLY when visible to the logged-in account;
 *       - the account-creation date is ALWAYS null with a fixed "unavailable" label and
 *         is NEVER inferred (Telegram Web does not expose it);
 *       - the avatar is admitted ONLY as a local `data:` thumbnail;
 *       - the profile permalink is scheme-guarded to Telegram hosts.
 *
 * extract.ts is quarantine-clean: this file imports it WITHOUT mocking electron,
 * proving it pulls in no electron graph at load.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TG_PROFILE_SCRIPT,
  TG_ACCOUNT_CREATION_LABEL,
  normalizeProfile,
  type RawProfile,
} from '../src/main/socmint/telegram-hunter/extract';

/** Read the un-evaluated body of a `` export const NAME = `…` `` static-script template. */
function scriptSourceBody(relPath: string, name: string): string {
  const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`'));
  if (!m) throw new Error(`static script ${name} not found in ${relPath}`);
  return m[1];
}

const rawProfile = (o: Partial<RawProfile> = {}): RawProfile => ({
  displayName: 'Alice Ops',
  username: '@alice_op',
  phone: '',
  bio: 'Operator. Signal only.',
  status: 'last seen recently',
  links: ['https://t.me/alice_op'],
  context: 'Operators Group',
  profileUrl: 'https://t.me/alice_op',
  avatar: 'data:image/png;base64,BBBB',
  ...o,
});

const CAP_AT = '2026-08-07T12:00:00.000Z';

// ---- 1. static payload, no interpolation, no in-page fetch --------------

describe('TG_PROFILE_SCRIPT: static, no interpolation, no in-page fetch', () => {
  it('is a non-empty string', () => {
    expect(typeof TG_PROFILE_SCRIPT).toBe('string');
    expect(TG_PROFILE_SCRIPT.length).toBeGreaterThan(0);
  });

  it('contains NO `${` interpolation (scraped content can never be spliced in)', () => {
    const body = scriptSourceBody('src/main/socmint/telegram-hunter/extract.ts', 'TG_PROFILE_SCRIPT');
    expect(body).not.toContain('${');
    // A distinctive selector proves the scanned source template is the exported one.
    expect(body).toContain('right-column');
    expect(TG_PROFILE_SCRIPT).toContain('right-column');
  });

  it('does NOT fetch remote media in-page (no unrestricted remote inlining)', () => {
    expect(TG_PROFILE_SCRIPT).not.toContain('fetch(');
  });
});

// ---- 2. normalizeProfile (pure honesty core) ----------------------------

describe('normalizeProfile: captured panel → TgProfile', () => {
  it('stores the visible display name honestly and NEVER falls back to the @handle', () => {
    const named = normalizeProfile(rawProfile({ displayName: 'Alice Ops' }), { capturedAt: CAP_AT });
    expect(named.displayName).toBe('Alice Ops');
    expect(named.handle).toBe('@alice_op');

    // NO display name shown → displayName ABSENT, never backfilled from the handle
    const anon = normalizeProfile(rawProfile({ displayName: '' }), { capturedAt: CAP_AT });
    expect(anon.displayName).toBeUndefined();
    expect(anon.handle).toBe('@alice_op');

    // a displayName that IS just the handle is NOT stored (the source's fallback, refused)
    const echoedAt = normalizeProfile(rawProfile({ displayName: '@alice_op' }), { capturedAt: CAP_AT });
    expect(echoedAt.displayName).toBeUndefined();
    const echoedBare = normalizeProfile(rawProfile({ displayName: 'alice_op' }), { capturedAt: CAP_AT });
    expect(echoedBare.displayName).toBeUndefined();
  });

  it('records account-creation as null with a fixed unavailable label — NEVER inferred', () => {
    const p = normalizeProfile(rawProfile(), { capturedAt: CAP_AT });
    expect(p.accountCreationDate).toBeNull();
    expect(p.accountCreationLabel).toBe(TG_ACCOUNT_CREATION_LABEL);
    expect(TG_ACCOUNT_CREATION_LABEL).toBe('Unavailable — Telegram does not expose it');
    // the label must not be derivable from any input — it is fixed regardless of what was seen
    const p2 = normalizeProfile(
      rawProfile({ bio: 'joined 2015', status: 'account created January 2016' }),
      { capturedAt: CAP_AT },
    );
    expect(p2.accountCreationDate).toBeNull();
    expect(p2.accountCreationLabel).toBe(TG_ACCOUNT_CREATION_LABEL);
  });

  it('stores the phone ONLY when visible to this account', () => {
    const shown = normalizeProfile(rawProfile({ phone: '+1 555 010 1234' }), { capturedAt: CAP_AT });
    expect(shown.phone).toBe('+1 555 010 1234');

    const hidden = normalizeProfile(rawProfile({ phone: '' }), { capturedAt: CAP_AT });
    expect(hidden.phone).toBeUndefined();
  });

  it('admits an avatar ONLY as a local data: thumbnail — a remote URL is dropped', () => {
    const kept = normalizeProfile(rawProfile({ avatar: 'data:image/png;base64,BBBB' }), { capturedAt: CAP_AT });
    expect(kept.avatar).toBe('data:image/png;base64,BBBB');

    const remote = normalizeProfile(rawProfile({ avatar: 'https://web.telegram.org/a/x.jpg' }), { capturedAt: CAP_AT });
    expect(remote.avatar).toBeUndefined();
    expect(remote.avatar ?? '').not.toMatch(/^https?:/);
  });

  it('scheme-guards the profile permalink to Telegram hosts', () => {
    const ok = normalizeProfile(rawProfile({ profileUrl: 'https://t.me/alice_op' }), { capturedAt: CAP_AT });
    expect(ok.profileUrl).toBe('https://t.me/alice_op');

    const offDomain = normalizeProfile(rawProfile({ profileUrl: 'https://evil.example/alice_op' }), { capturedAt: CAP_AT });
    expect(offDomain.profileUrl).toBeUndefined();

    const jsScheme = normalizeProfile(rawProfile({ profileUrl: 'javascript:alert(1)' }), { capturedAt: CAP_AT });
    expect(jsScheme.profileUrl).toBeUndefined();
  });

  it('captures bio / status / context / links and stamps the injected capturedAt clock', () => {
    const p = normalizeProfile(
      rawProfile({
        bio: 'Operator. Signal only.',
        status: 'last seen recently',
        context: 'Operators Group',
        links: ['https://t.me/alice_op', ''],
      }),
      { capturedAt: CAP_AT },
    );
    expect(p.bio).toBe('Operator. Signal only.');
    expect(p.status).toBe('last seen recently');
    expect(p.context).toBe('Operators Group');
    expect(p.links).toEqual(['https://t.me/alice_op']); // empty entries dropped
    expect(p.capturedAt).toBe(CAP_AT);
  });

  it('omits missing bio / status / context (a "Not visible" render concern, never fabricated)', () => {
    const p = normalizeProfile(
      rawProfile({ bio: '', status: '', context: '', links: [] }),
      { capturedAt: CAP_AT },
    );
    expect(p.bio).toBeUndefined();
    expect(p.status).toBeUndefined();
    expect(p.context).toBeUndefined();
    expect(p.links).toEqual([]);
  });
});
