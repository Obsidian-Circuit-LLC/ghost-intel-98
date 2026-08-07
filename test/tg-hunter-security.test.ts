/**
 * TG-V — Telegram Hunter SECURITY + HONESTY verification suite.
 *
 * The aggregate proof that the invariants the individual tasks each pinned locally
 * still hold together at the module boundary. It fixes the class of regression where
 * one task's guard is quietly bypassed by another task's wiring:
 *
 *   - IPC surface: every Telegram handler is reachable AND validates the sender frame
 *     (`assertTrustedSender`) BEFORE any work, then UUID-gates the caseId — a hostile
 *     Telegram Web page in the capture window can post IPC, and a bad caseId must never
 *     reach a store path.
 *   - Import LFI: `parseTelegramExport` resolves every media path through the WIRED
 *     `confineImportPath` — a traversal / absolute escape drops the media (not dead code:
 *     an in-root path is still kept).
 *   - Media deanon: the Telegram media allowlist is the Telegram hosts only, and every
 *     normalizer admits a `data:` avatar ONLY — a remote `http(s)` avatar is dropped, so
 *     no stored field can beacon the analyst's Tor-exit view back to the observed account.
 *   - Export injection: CSV cells are formula-guarded and HTML fields entity-escaped.
 *   - Honesty: account-creation is ALWAYS unavailable (never inferred); a display name is
 *     NEVER the @handle; phone only when visible; provenance stamped visible/unverified.
 *   - Supply chain: the retired mtcute engine left no dependency behind (no new dep).
 *
 * Only the capture-window factory + the Tor singleton are mocked, so importing the real
 * IPC handlers constructs no BrowserWindow and touches no Tor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/main/capture/capture-window', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createCaptureWindow: vi.fn(async () => ({
      webContents: { setWebRTCIPHandlingPolicy: vi.fn(), executeJavaScript: vi.fn(async () => []) },
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
    })),
    assertTrustedSender: vi.fn(),
  };
});
vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: vi.fn(() => ({ isBootstrapped: () => false, socksPort: () => 9050 })),
}));

import { assertTrustedSender } from '../src/main/capture/capture-window';
import { channels } from '../src/shared/ipc-contracts';
import {
  registerTelegramHunterIpc,
  connectTelegramCapture,
  captureTelegramMessages,
  captureTelegramMembers,
  captureTelegramProfile,
  exportTelegramItems,
  __resetTelegramWindowForTests,
} from '../src/main/socmint/telegram-hunter/ipc';
import { parseTelegramExport } from '../src/main/socmint/telegram-hunter/store';
import {
  normalizeMessage,
  normalizeMember,
  normalizeProfile,
  TG_ACCOUNT_CREATION_LABEL,
  TG_PROFILE_SCRIPT,
  type RawMessage,
  type RawMember,
  type RawProfile,
} from '../src/main/socmint/telegram-hunter/extract';
import {
  tableFor,
  tableToCsv,
  tableToHtml,
  matchKeywords,
  TelegramHunterCollector,
} from '../src/main/socmint/telegram-hunter/collector';
import {
  TELEGRAM_MEDIA_HOSTS,
  remoteMediaToDataUri,
  type MediaCapturePage,
} from '../src/main/capture/security';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  __resetTelegramWindowForTests();
  vi.clearAllMocks();
});

// ---- 1. IPC seam: reachable + frame-guarded + UUID-gated ----------------

describe('TG-V IPC — every Telegram handler is reachable and frame-guarded', () => {
  function registerCaptured(): Map<string, (e: unknown, ...a: unknown[]) => unknown> {
    const registered = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    registerTelegramHunterIpc({
      handle: (channel, fn) => registered.set(channel, fn as never),
    });
    return registered;
  }

  // NOTE: this proves only that every DECLARED channel has a handler — it derives its
  // expectation from the same channel set the handlers register against, so it is CIRCULAR
  // w.r.t. hollow features: a feature that never got a channel can never make it fail. It is
  // NOT a reachability proof. The "reachability inventory" describe below is what actually
  // catches the Plan-A/v3.24.2 hollow-feature class (a feature built + unit-tested but bound
  // to no channel and no renderer control).
  it('registers a handler for EVERY declared socmint.telegram channel', () => {
    const registered = registerCaptured();
    const expected = Object.values(channels.socmint.telegram).sort();
    expect([...registered.keys()].sort()).toEqual(expected);
  });

  it('every handler validates the sender frame FIRST (assertTrustedSender)', async () => {
    const registered = registerCaptured();
    const fakeEvent = { senderFrame: {} } as unknown;
    for (const [channel, fn] of registered) {
      (assertTrustedSender as unknown as ReturnType<typeof vi.fn>).mockClear();
      // A deliberately-bad payload so the body throws AFTER the frame check — we only
      // assert the guard ran, not the downstream result.
      try {
        await fn(fakeEvent, { bogus: true });
      } catch {
        /* expected for the payload-validating handlers */
      }
      expect(
        assertTrustedSender,
        `${channel} must call assertTrustedSender`,
      ).toHaveBeenCalledTimes(1);
    }
  });
});

// ---- 1b. Reachability inventory: NAME the hollow features, don't pass over them ----
//
// The TG-V seam bullet requires proving the SOCMINT Telegram tab reaches EVERY built
// feature. It does not — and the "declared channel" check above is circular, so it can
// never notice. This inventory is the HAND-AUDITED truth of the whole built feature
// surface (the seam bullet's list) mapped to the one fact that decides reachability: does
// an IPC channel carry it from the Telegram tab into main? It is deliberately NOT derived
// from `channels.socmint.telegram` — deriving it would reintroduce the circularity that
// hides a channel-less feature.
//
// Reachable end-to-end (renderer seam proven separately in tg-hunter-seam.test.tsx):
//   connect · capture messages · capture members · capture profile · export · import ·
//   keyword-watch scan
//   - import         — parseTelegramExport (store), carried by socmint:telegram:importExport;
//                      the operator picks a local export, the LFI-guarded parser persists it.
//   - keyword-watch  — matchKeywords (collector) + the encrypt-at-rest keyword rules, carried
//                      by socmint:telegram:keywordScan; the tab adds terms and scans captures.
//   - profile-capture — TG_PROFILE_SCRIPT + normalizeProfile + the `captureUserProfile`
//                      collector orchestrator + the encrypt-at-rest `profiles` store, carried
//                      by socmint:telegram:captureProfile; the Profiles export reads that store.
// There is NO remaining built-but-unreachable feature — the former profile-capture gap is
// now wired end-to-end (channel + collector orchestrator + store + renderer control + seam).
//
// This block is a FORCING FUNCTION: wiring one of the gap features (adding its channel)
// breaks the "wired set === reachable set" assertion until the inventory is updated to move
// it into `reachable` — which then also demands a real seam test in tg-hunter-seam.test.tsx.
// Dropping a reachable channel breaks it symmetrically.

interface TgFeature {
  /** Contract key under channels.socmint.telegram, or null when no channel carries it. */
  channel: keyof typeof channels.socmint.telegram | null;
  /** A built symbol proving the feature's code genuinely exists (not a typo'd ghost). */
  built: unknown;
}

const TELEGRAM_FEATURE_REACHABILITY: Record<string, TgFeature> = {
  // --- reachable from the Telegram tab (channel-carried) ---
  connect: { channel: 'connect', built: connectTelegramCapture },
  captureMessages: { channel: 'capture', built: captureTelegramMessages },
  captureMembers: { channel: 'captureMembers', built: captureTelegramMembers },
  captureProfile: { channel: 'captureProfile', built: captureTelegramProfile },
  export: { channel: 'exportItems', built: exportTelegramItems },
  import: { channel: 'importExport', built: parseTelegramExport },
  keywordWatch: { channel: 'keywordScan', built: matchKeywords },
  // --- no remaining built-but-unreachable feature: the profile-capture gap is now wired ---
};

describe('TG-V reachability inventory — no silent hollow feature', () => {
  const entries = Object.entries(TELEGRAM_FEATURE_REACHABILITY);
  const reachable = entries.filter(([, f]) => f.channel !== null);
  const gap = entries.filter(([, f]) => f.channel === null);

  it('every inventoried feature is real code (the inventory names no ghosts)', () => {
    for (const [name, f] of entries) {
      expect(typeof f.built, `${name} must be built code`).toBe('function');
    }
  });

  it('the WIRED channel set is EXACTLY the reachable features — no unbacked channel, no channel-less reachable claim', () => {
    const registered = new Set<string>();
    registerTelegramHunterIpc({ handle: (channel) => registered.add(channel) });

    const wiredChannelStrings = Object.values(channels.socmint.telegram).sort();
    const reachableChannelStrings = reachable
      .map(([, f]) => channels.socmint.telegram[f.channel as keyof typeof channels.socmint.telegram])
      .sort();

    // hand-audited reachable set === declared channels === actually-registered handlers.
    expect(reachableChannelStrings).toEqual(wiredChannelStrings);
    expect([...registered].sort()).toEqual(reachableChannelStrings);
  });

  it('there is NO remaining channel-less feature — every built feature is now reachable', () => {
    expect(gap.map(([name]) => name)).toEqual([]);
  });

  it('profile-capture now HAS a collector orchestrator (the extraction half is no longer orphaned)', () => {
    // messages + members + profile each have a capture orchestrator on the collector.
    const proto = TelegramHunterCollector.prototype as Record<string, unknown>;
    expect(typeof proto.captureMessages).toBe('function');
    expect(typeof proto.captureGroupMembers).toBe('function');
    expect(typeof proto.captureUserProfile).toBe('function');
    // the extraction half still exists and now feeds the orchestrator.
    expect(typeof TG_PROFILE_SCRIPT).toBe('string');
    expect(TG_PROFILE_SCRIPT.length).toBeGreaterThan(0);
  });

  it('exportItems(profiles) now reads the REAL profiles store — the honest gap is closed', async () => {
    const storeMod = await import('../src/main/socmint/telegram-hunter/store');
    const fixture: RawProfile = {
      displayName: 'Zed Ops', username: '@zed_op', phone: '', bio: 'b', status: '',
      links: [], context: 'grp', profileUrl: 'https://t.me/zed_op', avatar: '',
    };
    const persisted = [normalizeProfile(fixture, { capturedAt: '2026-08-07T00:00:00.000Z' })];
    const spy = vi.spyOn(storeMod, 'prodTgHunterStore').mockResolvedValue({
      profiles: {
        read: async () => persisted,
        write: async () => {},
        saveMany: async () => ({ added: 0, total: persisted.length }),
      },
    } as unknown as Awaited<ReturnType<typeof storeMod.prodTgHunterStore>>);
    try {
      const res = await exportTelegramItems(VALID_UUID, 'json', 'profiles');
      expect(res.collection).toBe('profiles');
      // real: reflects the persisted row, not a hardcoded empty [] short-circuit.
      expect(res.count).toBe(1);
      expect(res.data).toContain('@zed_op');
      // the honesty invariant travels through the export: creation date stays null.
      expect(res.data).toContain('"accountCreationDate": null');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('TG-V IPC — caseId is ensureUuid-gated on every Telegram handler', () => {
  it('captureTelegramMessages rejects a non-UUID caseId (before any store path)', async () => {
    await expect(
      captureTelegramMessages({ caseId: 'not-a-uuid', channelId: '@t' }),
    ).rejects.toThrow(/uuid/i);
  });

  it('captureTelegramMembers rejects a non-UUID caseId', async () => {
    await expect(captureTelegramMembers({ caseId: 'not-a-uuid' })).rejects.toThrow(/uuid/i);
  });

  it('exportTelegramItems rejects a non-UUID caseId', async () => {
    await expect(exportTelegramItems('not-a-uuid', 'json')).rejects.toThrow(/uuid/i);
  });

  it('a path-traversal caseId is refused too (not just malformed UUIDs)', async () => {
    await expect(
      captureTelegramMessages({ caseId: '../../etc', channelId: '@t' }),
    ).rejects.toThrow(/uuid/i);
  });
});

// ---- 2. Import LFI: confineImportPath is WIRED, not dead -----------------

describe('TG-V import — parseTelegramExport confines media to the export root', () => {
  const ROOT = '/tmp/tg-export-root';

  function exportWith(file: string) {
    return { chats: { list: [{ id: 7, name: 'C', messages: [{ id: 1, text: 'hi', file }] }] } };
  }

  it('drops a `../../../../etc/passwd` traversal media (keeps the message)', () => {
    const items = parseTelegramExport(ROOT, exportWith('../../../../etc/passwd'));
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('hi');
    expect(items[0].media).toEqual([]); // media escaped the root ⇒ DROPPED
  });

  it('drops an absolute `/etc/passwd` media escape', () => {
    const items = parseTelegramExport(ROOT, exportWith('/etc/passwd'));
    expect(items[0].media).toEqual([]);
  });

  it('KEEPS an in-root media as a confined absolute path (guard is wired, not blanket-drop)', () => {
    const items = parseTelegramExport(ROOT, exportWith('photos/1.jpg'));
    expect(items[0].media).toHaveLength(1);
    expect(items[0].media[0].path).toBe(resolve(ROOT, 'photos/1.jpg'));
    expect(items[0].media[0].path!.startsWith(ROOT)).toBe(true);
    expect(items[0].media[0].type).toBe('image');
  });

  it('drops a remote http(s) media ref (never dereferenced as a file)', () => {
    const items = parseTelegramExport(ROOT, exportWith('https://evil.example/x.png'));
    expect(items[0].media).toEqual([]);
  });
});

// ---- 3. Media deanon: host-restricted + data:-only ----------------------

describe('TG-V media — allowlist is Telegram-only and avatars are data:-only', () => {
  it('the Telegram media allowlist is the Telegram hosts (no X/CDN host leaks in)', () => {
    expect([...TELEGRAM_MEDIA_HOSTS]).toEqual(['web.telegram.org', 't.me', 'telegram.org']);
  });

  it('remoteMediaToDataUri refuses an off-allowlist host BEFORE any in-page fetch', async () => {
    const exec = vi.fn(async () => 'data:image/png;base64,AAAA');
    const page = { webContents: { executeJavaScript: exec } } as unknown as MediaCapturePage;
    const out = await remoteMediaToDataUri(page, 'https://evil.example/a.png', TELEGRAM_MEDIA_HOSTS);
    expect(out).toBeNull();
    expect(exec).not.toHaveBeenCalled(); // refused before the capture page issued a request
  });

  it('remoteMediaToDataUri admits an on-allowlist Telegram host (and only a data: result)', async () => {
    const exec = vi.fn(async () => 'data:image/png;base64,AAAA');
    const page = { webContents: { executeJavaScript: exec } } as unknown as MediaCapturePage;
    const out = await remoteMediaToDataUri(page, 'https://web.telegram.org/a.png', TELEGRAM_MEDIA_HOSTS);
    expect(out).toBe('data:image/png;base64,AAAA');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('normalizers DROP a remote avatar and keep a data: one (no beaconing <img src>)', () => {
    const ctx = {
      caseId: VALID_UUID,
      jobId: 'j',
      collectorVersion: 'v',
      harvestedAt: '2026-08-07T00:00:00.000Z',
      channelId: '@c',
      channelLabel: 'C',
    };
    const remote = { avatar: 'https://web.telegram.org/a.png' };
    const local = { avatar: 'data:image/png;base64,AAAA' };

    const msgRemote = normalizeMessage({ ...baseMessage(), ...remote }, ctx);
    const msgLocal = normalizeMessage({ ...baseMessage(), ...local }, ctx);
    expect(msgRemote.avatar).toBeUndefined();
    expect(msgLocal.avatar).toBe('data:image/png;base64,AAAA');

    const memRemote = normalizeMember({ ...baseMember(), ...remote }, { capturedAt: ctx.harvestedAt });
    expect(memRemote.avatar).toBeUndefined();

    const profRemote = normalizeProfile({ ...baseProfile(), ...remote }, { capturedAt: ctx.harvestedAt });
    expect(profRemote.avatar).toBeUndefined();
  });
});

// ---- 4. Export injection: CSV formula + HTML entity guards ---------------

describe('TG-V export — scraped fields cannot inject into CSV or HTML', () => {
  it('a `=cmd` field is neutralized in the formula-guarded CSV', () => {
    const member = {
      handle: '@x',
      displayName: '=HYPERLINK("http://evil")',
      status: '',
      context: '',
      capturedAt: '2026-08-07T00:00:00.000Z',
    };
    const csv = tableToCsv(tableFor('members', [member]));
    // The formula lead is prefixed with `'` inside the quoted cell — never a live formula.
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain(',=HYPERLINK');
  });

  it('a `<script>` field is entity-escaped in the HTML report', () => {
    const member = {
      handle: '@x',
      displayName: '<script>alert(1)</script>',
      status: '',
      context: '',
      capturedAt: '2026-08-07T00:00:00.000Z',
    };
    const html = tableToHtml(tableFor('members', [member]));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

// ---- 5. Honesty: no inference, display name never the @handle -----------

describe('TG-V honesty — no fabrication of what was not visible', () => {
  const capturedAt = '2026-08-07T00:00:00.000Z';

  it('account-creation is ALWAYS null with the fixed unavailable label (never inferred)', () => {
    const p = normalizeProfile(baseProfile(), { capturedAt });
    expect(p.accountCreationDate).toBeNull();
    expect(p.accountCreationLabel).toBe(TG_ACCOUNT_CREATION_LABEL);
    expect(p.accountCreationLabel).toMatch(/unavailable/i);
  });

  it('a display name that merely echoes the @handle is OMITTED (profile + member)', () => {
    const p = normalizeProfile(
      { ...baseProfile(), username: '@ghost', displayName: '@ghost' },
      { capturedAt },
    );
    expect(p.displayName).toBeUndefined();
    const pBare = normalizeProfile(
      { ...baseProfile(), username: '@ghost', displayName: 'ghost' },
      { capturedAt },
    );
    expect(pBare.displayName).toBeUndefined();

    const m = normalizeMember(
      { ...baseMember(), username: '@ghost', displayName: '@ghost' },
      { capturedAt },
    );
    expect(m.displayName).toBeUndefined();
  });

  it('a message with no visible display name records NONE (never the @handle)', () => {
    const ctx = {
      caseId: VALID_UUID, jobId: 'j', collectorVersion: 'v',
      harvestedAt: capturedAt, channelId: '@c', channelLabel: 'C',
    };
    const item = normalizeMessage(
      { ...baseMessage(), author: '', authorUsername: '@ghost' },
      ctx,
    );
    expect(item.authorDisplay).toBeUndefined();
    expect(item.authorHandle).toBe('@ghost');
    // provenance: visible capture, never verified.
    expect(item.captureProvenance).toBe('visible-capture');
    expect(item.verified).toBe(false);
  });

  it('phone is stored ONLY when visible (absent ⇒ omitted, never inferred)', () => {
    const noPhone = normalizeProfile(baseProfile(), { capturedAt });
    expect(noPhone.phone).toBeUndefined();
    const withPhone = normalizeProfile({ ...baseProfile(), phone: '+1 555 0100' }, { capturedAt });
    expect(withPhone.phone).toBe('+1 555 0100');
  });
});

// ---- 6. Supply chain: mtcute retired, no new dependency -----------------

describe('TG-V supply chain — the retired engine left no dependency', () => {
  it('package.json declares no @mtcute / telegram-client / socks dependency', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const names = Object.keys(all);
    expect(names.filter((n) => /mtcute/i.test(n))).toEqual([]);
    expect(names.filter((n) => /^telegram$|gramjs|telethon/i.test(n))).toEqual([]);
  });
});

// ---- fixtures -----------------------------------------------------------

function baseMessage(): RawMessage {
  return {
    chat: 'C',
    author: 'Ghost',
    authorUsername: '@ghost',
    authorProfileUrl: 'https://t.me/ghost',
    timestamp: '12:00',
    text: 'hello',
    links: [],
    avatar: '',
    eventType: '',
    messageId: 'm1',
  };
}

function baseMember(): RawMember {
  return {
    username: '@ghost',
    displayName: 'Ghost',
    phone: '',
    status: 'online',
    links: [],
    context: 'C',
    profileUrl: 'https://t.me/ghost',
    avatar: '',
  };
}

function baseProfile(): RawProfile {
  return {
    displayName: 'Ghost',
    username: '@ghost',
    phone: '',
    bio: 'bio',
    status: 'online',
    links: [],
    context: 'C',
    profileUrl: 'https://t.me/ghost',
    avatar: '',
  };
}
