/**
 * X5 — Follower / following network extractor + export (pure pieces).
 *
 * Ported from the quarantine `readVisibleUserCells` / `ingestRelationships`
 * (`electron/main.cjs:982-1044`) and `exportRelationshipsCsv` (`:1146-1170`):
 *
 *  1. `USER_CELL_SCRIPT` — the STATIC in-page payload that reads the visible
 *     `[data-testid="UserCell"]` rows. No `${…}` interpolation.
 *
 *  2. `normalizeUserCell` / `normalizeNetwork` — turn captured UserCell rows into
 *     `XNetworkAccount[]`: the ACTUAL visible accounts, deduped, invalid handles
 *     dropped, remote avatar URLs dropped (data:-only). HONESTY: the artifact
 *     carries the accounts it saw — NEVER a scraped follower/following count-number.
 *
 *  3. `networkToCsv` — every cell routed through `csvCell`, so a scraped bio like
 *     `=HYPERLINK("http://evil")` is neutralized as literal text (the review's
 *     formula-injection finding).
 *
 * The orchestration that drives these against a live capture window (X2 challenge-refusal
 * probe, navigate-then-guard, persist to the `networks` artifact store) used to be pinned
 * here too (`captureFollowers`/`captureFollowing`, `ipc.ts`) — that was the clearnet-only
 * legacy surface retired wholesale at Task 16. The Enterprise-port design does not (yet) wire
 * an active Tor-safe follower/following capture path; only the accumulator these normalizers
 * feed (`store.networks`, consumed via `networksList`/`analysis`) survives, plus `demo.ts`'s
 * synthetic seeding through the same `normalizeNetwork` opts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  USER_CELL_SCRIPT,
  normalizeUserCell,
  normalizeNetwork,
  networkToCsv,
  type RawUserCell,
} from '../src/main/x-listening/extract';
import type { XNetworkArtifact } from '../src/main/x-listening/store';

/**
 * The SOURCE body of a `` export const NAME = `…` `` static-script template literal,
 * read off disk. This is what the "no `${}` interpolation" guard must inspect — the
 * RUNTIME value of the constant can never contain `${…}` (a template literal resolves
 * its substitutions at evaluation time), so asserting `SCRIPT.includes('${')` is
 * vacuous and can never fail on a regression. Reading the un-evaluated source can.
 */
function scriptSourceBody(relPath: string, name: string): string {
  const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*`([\\s\\S]*?)`'));
  if (!m) throw new Error(`static script ${name} not found in ${relPath}`);
  return m[1];
}

const cell = (o: Partial<RawUserCell> = {}): RawUserCell => ({
  username: 'alice',
  displayName: 'Alice',
  bio: 'analyst',
  url: 'https://x.com/alice',
  avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg',
  ...o,
});

// ---- 1. static payload -------------------------------------------------

describe('USER_CELL_SCRIPT', () => {
  it('is a static payload with no interpolation (nothing scraped is spliced into executed code)', () => {
    // Guard the un-evaluated SOURCE template literal — the only form in which a
    // regression that splices `${scraped}` into the payload is actually detectable.
    const body = scriptSourceBody('src/main/x-listening/extract.ts', 'USER_CELL_SCRIPT');
    expect(body).not.toContain('${');
    expect(body).toContain('UserCell');
    // The runtime constant is the same static payload (a distinctive selector proves
    // the scanned source template is the one actually exported).
    expect(USER_CELL_SCRIPT).toContain('[data-testid="UserCell"]');
    expect(body).toContain('[data-testid="UserCell"]');
  });
});

// ---- 2. pure normalizers (visible accounts, no fabricated count) -------

describe('normalizeUserCell', () => {
  it('maps a visible UserCell to an account with an @handle', () => {
    const acct = normalizeUserCell(cell());
    expect(acct).not.toBeNull();
    expect(acct!.handle).toBe('@alice');
    expect(acct!.displayName).toBe('Alice');
    expect(acct!.bio).toBe('analyst');
  });

  it('drops a remote avatar URL (data:-only — no remote media inlining)', () => {
    expect(normalizeUserCell(cell())!.avatar).toBeUndefined();
    const withData = normalizeUserCell(cell({ avatar: 'data:image/png;base64,AAAA' }));
    expect(withData!.avatar).toBe('data:image/png;base64,AAAA');
  });

  it('rejects an invalid handle (returns null, never a fabricated row)', () => {
    expect(normalizeUserCell(cell({ username: 'not a handle!' }))).toBeNull();
    expect(normalizeUserCell(cell({ username: '' }))).toBeNull();
    expect(normalizeUserCell(cell({ username: 'wayyyytoolongausername' }))).toBeNull();
  });

  it('tolerates a leading @ and omits an empty bio', () => {
    const acct = normalizeUserCell(cell({ username: '@bob', bio: '   ' }));
    expect(acct!.handle).toBe('@bob');
    expect(acct!.bio).toBeUndefined();
  });

  it('does NOT fall back to the @handle when no display name is visible (honest absence)', () => {
    // A UserCell with a valid handle but NO visible display name (X sometimes renders
    // only the @handle line). The display name must be recorded as absent — never
    // silently backfilled from the handle, which would present an unobserved value
    // as captured. The renderer surfaces the absent field as "Not visible".
    const acct = normalizeUserCell(cell({ username: 'alice', displayName: '' }));
    expect(acct).not.toBeNull();
    expect(acct!.handle).toBe('@alice');
    expect(acct!.displayName).toBeUndefined();
    // Explicitly: it is neither the bare handle nor the @-prefixed handle.
    expect(acct!.displayName).not.toBe('alice');
    expect(acct!.displayName).not.toBe('@alice');
  });

  it('treats a whitespace-only display name as absent, not as a captured value', () => {
    const acct = normalizeUserCell(cell({ username: 'alice', displayName: '   ' }));
    expect(acct!.displayName).toBeUndefined();
  });
});

describe('normalizeNetwork', () => {
  const rows = [
    cell({ username: 'alice' }),
    cell({ username: 'bob', displayName: 'Bob' }),
    cell({ username: 'ALICE', displayName: 'dupe' }), // dedup (case-insensitive)
    cell({ username: 'bad handle!' }),                // invalid → dropped
  ];

  it('returns the ACTUAL visible accounts (deduped, invalid dropped) — never a count-number', () => {
    const art = normalizeNetwork(rows, 'target', 'followers', '2026-08-06T12:00:00.000Z');
    expect(art.accounts.map((a) => a.handle)).toEqual(['@alice', '@bob']);
    expect(art.target).toBe('@target');
    expect(art.kind).toBe('followers');
    expect(art.capturedAt).toBe('2026-08-06T12:00:00.000Z');
    // HONESTY: no fabricated follower/following total anywhere on the artifact.
    expect('count' in art).toBe(false);
    expect('total' in art).toBe(false);
    expect((art as Record<string, unknown>).followerCount).toBeUndefined();
  });

  it('handles an empty/undefined row set as an empty (honest) account list', () => {
    expect(normalizeNetwork(undefined, '@t', 'following', 'now').accounts).toEqual([]);
    expect(normalizeNetwork([], '@t', 'following', 'now').kind).toBe('following');
  });
});

// ---- Task 7: evidenceHash + first/lastObservedAt + synthetic -----------

describe('normalizeNetwork — evidence hash + accumulator stamps (Task 7)', () => {
  const rows = [cell({ username: 'alice', displayName: 'Alice', bio: 'analyst' })];

  it('stamps every account with an evidenceHash and first/lastObservedAt == capturedAt', () => {
    const art = normalizeNetwork(rows, 'target', 'followers', '2026-08-11T12:00:00.000Z');
    const [alice] = art.accounts;
    expect(alice.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(alice.firstObservedAt).toBe('2026-08-11T12:00:00.000Z');
    expect(alice.lastObservedAt).toBe('2026-08-11T12:00:00.000Z');
  });

  it('evidenceHash is a pure function of (target, kind, handle, displayName, bio) — changes when the visible bio changes', () => {
    const a = normalizeNetwork(rows, 'target', 'followers', 't1').accounts[0];
    const changedBio = normalizeNetwork(
      [cell({ username: 'alice', displayName: 'Alice', bio: 'DIFFERENT bio' })],
      'target', 'followers', 't1',
    ).accounts[0];
    expect(changedBio.evidenceHash).not.toBe(a.evidenceHash);
    // ...but is identical across two capture RUNS that saw the exact same visible fields
    // (evidenceHash must not depend on capturedAt, or a re-scan of an unchanged account
    // would spuriously invalidate its own evidence trail).
    const rescan = normalizeNetwork(rows, 'target', 'followers', 't2-much-later').accounts[0];
    expect(rescan.evidenceHash).toBe(a.evidenceHash);
  });

  it('evidenceHash differs between followers and following for the same target/handle (kind is evidentiary)', () => {
    const followers = normalizeNetwork(rows, 'target', 'followers', 't1').accounts[0];
    const following = normalizeNetwork(rows, 'target', 'following', 't1').accounts[0];
    expect(followers.evidenceHash).not.toBe(following.evidenceHash);
  });

  it('opts.synthetic stamps every account synthetic:true; a real capture never sets it', () => {
    const real = normalizeNetwork(rows, 'target', 'followers', 't1').accounts[0];
    expect(real.synthetic).toBeUndefined();
    const demo = normalizeNetwork(rows, 'target', 'followers', 't1', { synthetic: true }).accounts[0];
    expect(demo.synthetic).toBe(true);
  });
});

// ---- 3. CSV export: every cell formula-guarded -------------------------

describe('networkToCsv', () => {
  const art: XNetworkArtifact = {
    target: '@target',
    kind: 'followers',
    capturedAt: '2026-08-06T12:00:00.000Z',
    accounts: [
      { handle: '@alice', displayName: 'Alice', bio: 'analyst' },
      { handle: '@evil', displayName: 'Evil', bio: '=HYPERLINK("http://evil")' },
      { handle: '@cmd', displayName: 'Cmd', bio: '+cmd|calc' },
    ],
  };

  it('neutralizes a formula-leading bio cell (Excel/Sheets injection guard)', () => {
    const csv = networkToCsv([art]);
    // the =HYPERLINK bio is quoted AND prefixed with a lone apostrophe
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    // the +cmd bio is likewise prefixed
    expect(csv).toContain('"\'+cmd|calc"');
    // a benign bio is quoted but NOT apostrophe-prefixed
    expect(csv).toContain('"analyst"');
    expect(csv).not.toContain("\"'analyst\"");
  });

  it('emits a header row and a BOM, one line per account', () => {
    const csv = networkToCsv([art]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toContain('handle');
    expect(lines).toHaveLength(1 + art.accounts.length);
  });
});
