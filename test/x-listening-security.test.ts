/**
 * V1 — X Listening Station security-regression + honesty suite.
 *
 * A lock-in suite: one assertion per Global-Constraint / review-finding the X
 * Listening Station must never regress. It consumes the interfaces the F1/F2/F3 +
 * X3/X5/X8 tasks already shipped and pins their security/honesty guarantees so a
 * future edit that reopens one of them turns this file red.
 *
 * SECURITY REGRESSION (one per checklist item):
 *  1. `assertTrustedSender` rejects an IPC frame that is not the app's own origin.
 *  2. No `shell.openExternal` (or an `electron` `shell` import) is reachable from
 *     the X module — a scraped URL must only ever reach the app's scheme-guarded
 *     `system.openExternal`, never a raw `shell.openExternal` (grep-in-test).
 *  3. Every store-backed IPC handler rejects a traversing caseId at its
 *     `ensureUuid` boundary sink — the traversal never reaches a store path
 *     (real-sink end-to-end regression, not a dead primitive).
 *  4. Every CSV export cell is formula-injection guarded (items + network CSV).
 *  5. No captured record field is a remote `http(s)` media URL (data: only — no beacon).
 *  6. A `<script>`-bearing scraped body renders ESCAPED in an exported document.
 *  7. No `demo-`/seed records exist in — or are injected into — a saved store.
 *
 * HONESTY:
 *  H1. A rounded `"1.2K"` metric is stored verbatim with `approx:true`, never a
 *      false-precision `1200`.
 *  H2. A verification/rate-limit challenge fixture BLOCKS capture (nothing persisted).
 *  H3. A field X did not render is recorded as honest absence (empty/omitted), never
 *      a fabricated guess.
 *
 * electron is mocked only because ipc.ts imports `session` at module load; every
 * assertion here is exercised through pure functions or injected deps (no network,
 * no BrowserWindow). `assertTrustedSender` is the REAL implementation from the
 * shared capture-window harness — not a mock.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) }
}));

import { assertTrustedSender } from '../src/main/capture/capture-window';
import { csvCell, escapeField } from '../src/main/capture/security';
import { channels } from '../src/shared/ipc-contracts';
import {
  normalizePost,
  parseMetricText,
  normalizeUserCell,
  networkToCsv,
  guardXPermalink,
  type RawPost,
  type NormalizeContext,
  type XNetworkArtifact,
} from '../src/main/x-listening/extract';
import {
  classifyPageState,
  captureVisibleTimeline,
  itemsToCsv,
  buildXItemsHtml,
  registerXListeningIpc,
  __resetXWindowForTests,
  type CaptureRequest,
  type TimelineCaptureDeps,
} from '../src/main/x-listening/ipc';
import { makeXStore, type XStoreDeps } from '../src/main/x-listening/store';
import type { HarvestedItem } from '../src/shared/socmint/types';

// ---- shared fixtures ---------------------------------------------------

const CTX: NormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'x-listening/1.0.0',
  harvestedAt: '2026-08-06T12:00:00.000Z',
  channelId: 'target',
  channelLabel: '@target timeline',
};

const rawPost = (o: Partial<RawPost> = {}): RawPost => ({
  id: '1789000000000000001',
  username: 'target',
  url: 'https://x.com/target/status/1789000000000000001',
  text: 'Visible tweet body',
  createdAt: '2026-08-06T11:59:00.000Z',
  isReply: false,
  isRepost: false,
  socialContext: '',
  metricsRaw: { replies: '12', reposts: '3', likes: '1.2K', views: '45.6K' },
  media: ['data:image/png;base64,AAAA'],
  ...o,
});

// The X-module source files a security regression must keep clean.
const X_SOURCE_FILES = [
  'src/main/x-listening/ipc.ts',
  'src/main/x-listening/extract.ts',
  'src/main/x-listening/store.ts',
  'src/main/capture/capture-window.ts',
  'src/main/capture/security.ts',
  'src/renderer/modules/x-listening/XListeningModule.tsx',
  'src/renderer/modules/x-listening/panels/NotesPanel.tsx',
];

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// ---- 1. assertTrustedSender rejects a non-app frame --------------------

describe('security: assertTrustedSender', () => {
  it('rejects an IPC frame whose origin is a remote (x.com) page', () => {
    const hostile = { senderFrame: { url: 'https://x.com/attacker' } } as unknown as Electron.IpcMainInvokeEvent;
    expect(() => assertTrustedSender(hostile)).toThrow();
  });

  it('rejects a frame with no sender URL (fail closed)', () => {
    expect(() => assertTrustedSender({ senderFrame: { url: '' } } as unknown as Electron.IpcMainInvokeEvent)).toThrow();
    expect(() => assertTrustedSender({} as unknown as Electron.IpcMainInvokeEvent)).toThrow();
  });

  it('admits the app’s own file://…/index.html renderer frame', () => {
    const trusted = { senderFrame: { url: 'file:///app/index.html' } } as unknown as Electron.IpcMainInvokeEvent;
    expect(() => assertTrustedSender(trusted)).not.toThrow();
  });
});

// ---- 2. no shell.openExternal reachable from the X module --------------

describe('security: no raw shell.openExternal in the X module', () => {
  it('no X-module source calls shell.openExternal', () => {
    for (const rel of X_SOURCE_FILES) {
      expect(readSource(rel).includes('shell.openExternal')).toBe(false);
    }
  });

  it('no X-module source imports `shell` from electron (only scheme-guarded system.openExternal is allowed)', () => {
    const shellImport = /import\s*(?:type\s*)?\{[^}]*\bshell\b[^}]*\}\s*from\s*['"]electron['"]/;
    for (const rel of X_SOURCE_FILES) {
      expect(shellImport.test(readSource(rel))).toBe(false);
    }
  });
});

// ---- 3. every store-backed IPC handler rejects a traversing caseId ------
// The REAL sink: `ensureUuid(caseId, 'caseId')` at each IPC boundary, applied
// BEFORE any store path is constructed (as every peer handler in register.ts
// does). A traversing caseId ("../../x") must throw at the boundary — it must
// never reach `scrapingCaseDir('x', caseId)` and write outside the case root.
// This drives the actual registered handlers end-to-end (not a dead primitive).

describe('security: store-backed IPC handlers reject a traversing caseId', () => {
  const TRUSTED = {
    senderFrame: { url: 'file:///app/index.html' },
  } as unknown as Electron.IpcMainInvokeEvent;
  const TRAVERSAL = '../../x';

  type Handler = (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => unknown;

  function handlers(): Map<string, Handler> {
    // No live capture window: a valid caseId would fall through to the
    // connectivity gate, but a traversing one is rejected before it ever
    // gets there — proving the guard fronts every other check.
    __resetXWindowForTests();
    const map = new Map<string, Handler>();
    registerXListeningIpc({ handle: (channel, fn) => void map.set(channel, fn as Handler) });
    return map;
  }

  // Each store-backed channel + a minimally well-formed payload carrying the
  // traversing caseId. Every non-caseId field is valid so the shape check passes
  // and control actually reaches the ensureUuid sink.
  const cases: Array<[string, (h: Map<string, Handler>) => unknown]> = [
    ['capture', (h) => h.get(channels.xListening.capture)!(TRUSTED, { caseId: TRAVERSAL, channelId: 'target' })],
    ['captureThreadComments', (h) => h.get(channels.xListening.captureThreadComments)!(TRUSTED, { caseId: TRAVERSAL, channelId: 'target', rootPostId: '1789000000000000001', rootPostUrl: 'https://x.com/target/status/1789000000000000001' })],
    ['runArchiveCycle', (h) => h.get(channels.xListening.runArchiveCycle)!(TRUSTED, { caseId: TRAVERSAL, channelId: 'target' })],
    ['runArchiveCycles', (h) => h.get(channels.xListening.runArchiveCycles)!(TRUSTED, { caseId: TRAVERSAL, channelId: 'target' })],
    ['captureFollowers', (h) => h.get(channels.xListening.captureFollowers)!(TRUSTED, { caseId: TRAVERSAL, target: 'target' })],
    ['captureFollowing', (h) => h.get(channels.xListening.captureFollowing)!(TRUSTED, { caseId: TRAVERSAL, target: 'target' })],
    ['exportNetwork', (h) => h.get(channels.xListening.exportNetwork)!(TRUSTED, TRAVERSAL)],
    ['saveNote', (h) => h.get(channels.xListening.saveNote)!(TRUSTED, { caseId: TRAVERSAL, findingId: 'f1', text: 'note' })],
    ['readNotes', (h) => h.get(channels.xListening.readNotes)!(TRUSTED, TRAVERSAL)],
    ['exportItems', (h) => h.get(channels.xListening.exportItems)!(TRUSTED, { caseId: TRAVERSAL, format: 'json' })],
  ];

  it.each(cases)(
    'the %s handler rejects "../../x" at the ensureUuid sink (nothing reaches a store path)',
    async (_name, invoke) => {
      const h = handlers();
      // A sync throw or a rejected promise both surface as a rejection here.
      await expect(Promise.resolve().then(() => invoke(h))).rejects.toThrow(/Invalid caseId/);
    },
  );

  it('admits a valid UUID — the capture guard passes it through to the connectivity gate', async () => {
    // Contrast case: the sink rejects TRAVERSAL specifically, not everything. A
    // well-formed UUID clears ensureUuid and reaches the next check ("not
    // connected", since no window is open) — proving the guard is a UUID gate,
    // not a blanket denier.
    const h = handlers();
    const validUuid = '11111111-1111-4111-8111-111111111111';
    await expect(
      Promise.resolve().then(() =>
        h.get(channels.xListening.capture)!(TRUSTED, { caseId: validUuid, channelId: 'target' }),
      ),
    ).rejects.toThrow(/not connected/);
  });
});

// ---- 4. every CSV export cell is formula-guarded -----------------------

describe('security: CSV exports are formula-injection guarded', () => {
  const mkItem = (over: Record<string, unknown> = {}): HarvestedItem => ({
    id: 'id-1',
    platform: 'x',
    authorHandle: '@alice',
    authorId: 'alice',
    text: 'benign body',
    channelId: 'alice',
    channelLabel: '@alice',
    messageId: '1001',
    publishedAt: '2026-08-01T00:00:00.000Z',
    harvestedAt: '2026-08-06T12:00:00.000Z',
    url: 'https://x.com/alice/status/1001',
    provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: 'case-a' },
    captureProvenance: 'visible-capture',
    verified: false,
    kind: 'post',
    media: [],
    metrics: {
      replies: { raw: '1', value: 1, approx: false },
      reposts: { raw: '0', value: 0, approx: false },
      likes: { raw: '1', value: 1, approx: false },
      views: { raw: '1', value: 1, approx: false },
    },
    ...over,
  } as unknown as HarvestedItem);

  it('csvCell neutralizes every spreadsheet formula-lead character', () => {
    for (const lead of ['=', '+', '-', '@']) {
      expect(csvCell(`${lead}cmd`).startsWith(`"'${lead}`)).toBe(true);
    }
    expect(csvCell('benign')).toBe('"benign"'); // benign is quoted, NOT apostrophe-prefixed
  });

  it('itemsToCsv apostrophe-prefixes a formula-leading tweet body', () => {
    const csv = itemsToCsv([mkItem({ text: '=HYPERLINK("http://evil")' })]);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
  });

  it('networkToCsv apostrophe-prefixes a formula-leading bio', () => {
    const art: XNetworkArtifact = {
      target: '@target',
      kind: 'followers',
      capturedAt: '2026-08-06T12:00:00.000Z',
      accounts: [{ handle: '@evil', displayName: 'Evil', bio: '=cmd|calc' }],
    };
    expect(networkToCsv([art])).toContain('"\'=cmd|calc"');
  });
});

// ---- 5. no captured record field is a remote http media URL ------------

describe('security: no remote media URL survives into a captured record', () => {
  it('normalizePost drops a remote http(s) media URL, keeping only data: thumbnails', () => {
    const item = normalizePost(
      rawPost({ media: ['https://pbs.twimg.com/media/a.jpg', 'data:image/png;base64,AAAA'] }),
      CTX,
    );
    expect(item.media).toEqual(['data:image/png;base64,AAAA']);
    expect(item.media.some((m) => /^https?:/i.test(m))).toBe(false);
    expect(item.mediaRef === undefined || item.mediaRef.startsWith('data:')).toBe(true);
  });

  it('no non-permalink field on the record is a remote media URL (the permalink is a guarded x.com link, not media)', () => {
    const item = normalizePost(
      rawPost({ media: ['https://pbs.twimg.com/media/a.jpg'] }),
      CTX,
    );
    // media resolution failed for this fixture (no data:) → media empty, mediaRef absent.
    expect(item.media).toEqual([]);
    expect(item.mediaRef).toBeUndefined();
    // the ONLY http(s) value the record may carry is the scheme-guarded x.com permalink.
    expect(item.url).toBe(guardXPermalink(rawPost().url));
    expect(item.url.startsWith('https://x.com/')).toBe(true);
  });
});

// ---- 6. a <script> body renders escaped in an export ------------------

describe('security: scraped markup is escaped at emit time', () => {
  it('escapeField neutralizes < > & " \'', () => {
    expect(escapeField('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(escapeField('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('buildXItemsHtml escapes a scripted tweet body — no live <script> node', () => {
    const mkItem = (): HarvestedItem => ({
      id: 'id-1', platform: 'x', authorHandle: '@a', authorId: 'a',
      text: '<script>steal()</script>', channelId: 'a', channelLabel: '@a',
      messageId: '1', publishedAt: '', harvestedAt: '2026-08-06T12:00:00.000Z',
      url: 'https://x.com/a/status/1',
      provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'j', caseId: 'case-a' },
      captureProvenance: 'visible-capture', verified: false, kind: 'post',
      media: ['https://pbs.twimg.com/media/evil.jpg', 'data:image/png;base64,AAAA'],
      metrics: {
        replies: { raw: '', value: 0, approx: false }, reposts: { raw: '', value: 0, approx: false },
        likes: { raw: '', value: 0, approx: false }, views: { raw: '', value: 0, approx: false },
      },
    } as unknown as HarvestedItem);
    const html = buildXItemsHtml('case-a', [mkItem()]);
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).not.toContain('<script>steal()');
    // and no remote media URL is inlined into an <img src>
    expect(html).not.toContain('pbs.twimg.com');
    expect(html).toContain('data:image/png;base64,AAAA');
  });
});

// ---- 7. no demo/seed records in a saved store --------------------------

describe('security: no demo data in the live store', () => {
  function memDeps(): XStoreDeps {
    const store = new Map<string, string>();
    const enoent = (p: string): Error => {
      const e = new Error(`ENOENT: ${p}`);
      (e as NodeJS.ErrnoException).code = 'ENOENT';
      return e;
    };
    return {
      readFile: async (p) => {
        if (!store.has(p)) throw enoent(p);
        return Buffer.from(store.get(p)!, 'utf8');
      },
      writeFile: async (p, d) => { store.set(p, d); },
      itemsPath: (c) => `x/${c}/x-items.json`,
      notesPath: (c) => `x/${c}/x-notes.json`,
      networksPath: (c) => `x/${c}/x-networks.json`,
      archiveStatePath: (c) => `x/${c}/x-archive-state.json`,
    };
  }

  it('a saved store contains exactly the captured items — nothing seeded, no demo- ids', async () => {
    const xStore = makeXStore(memDeps());
    const items = [normalizePost(rawPost({ id: '100' }), CTX), normalizePost(rawPost({ id: '200' }), CTX)];
    await xStore.saveItems('case-a', items);
    const back = await xStore.readItems('case-a');
    expect(back).toHaveLength(2); // no phantom demo record injected
    expect(back.every((i) => !String(i.id).startsWith('demo-'))).toBe(true);
    expect(back.every((i) => !String(i.messageId).startsWith('demo'))).toBe(true);
  });

  it('the X-module source seeds no demo/sample record set into any store', () => {
    // A hardcoded demo record (id:'demo-…' / a demoItems/sampleItems seed) is the
    // "demo data in the live store" class the constraint forbids. None may exist.
    for (const rel of X_SOURCE_FILES) {
      const src = readSource(rel);
      expect(/id:\s*['"]demo-/i.test(src)).toBe(false);
      expect(/\b(demoItems|sampleItems|seedItems|DEMO_ITEMS|SAMPLE_DATA)\b/.test(src)).toBe(false);
    }
  });
});

// ---- H1. rounded metric stored approx:true, never false precision ------

describe('honesty: rounded metrics are approximate, never false-precision', () => {
  it('a "1.2K" like count is stored verbatim with approx:true (not a bare 1200)', () => {
    const m = parseMetricText('1.2K');
    expect(m.raw).toBe('1.2K');   // verbatim display token
    expect(m.approx).toBe(true);  // honest: it is a rounded display
    expect(m.value).toBe(1200);   // best-effort expansion, valid ONLY paired with approx

    const item = normalizePost(rawPost({ metricsRaw: { replies: '12', reposts: '3', likes: '1.2K', views: '45.6K' } }), CTX);
    expect(item.metrics.likes.raw).toBe('1.2K');
    expect(item.metrics.likes.approx).toBe(true);
    expect(item.metrics.views.approx).toBe(true);
    // an exact small count carries approx:false
    expect(item.metrics.replies.raw).toBe('12');
    expect(item.metrics.replies.approx).toBe(false);
  });
});

// ---- H2. a challenge fixture blocks capture ---------------------------

describe('honesty: a verification/rate-limit challenge STOPS capture', () => {
  it('classifyPageState flags a challenge page as blocked', () => {
    for (const text of [
      'Verify your identity to continue',
      'Rate limit exceeded, try again later',
      'Please complete this security check (arkose)',
    ]) {
      expect(classifyPageState({ url: 'https://x.com/home', text, articles: 0 }).blocked).toBe(true);
    }
  });

  it('captureVisibleTimeline persists NOTHING when the gate reports blocked', async () => {
    const WIN = {} as unknown as Electron.BrowserWindow;
    const runCapture = vi.fn(async () => [rawPost()]);
    const saveItems = vi.fn(async () => ({ added: 0, skipped: 0 }));
    const deps: Partial<TimelineCaptureDeps> = {
      guard: async () => ({ blocked: true, reason: 'verification challenge' }),
      runCapture,
      resolveMedia: async () => null,
      saveItems,
      now: () => '2026-08-06T12:00:00.000Z',
    };
    const res = await captureVisibleTimeline(
      WIN,
      { caseId: 'case-a', jobId: 'job-1', channelId: 'target', channelLabel: '@target' } as CaptureRequest,
      deps,
    );
    expect(res.blocked).toBe(true);
    expect(res.items).toEqual([]);
    expect(runCapture).not.toHaveBeenCalled();
    expect(saveItems).not.toHaveBeenCalled();
  });
});

// ---- H3. a missing field is honest absence, never a guess -------------

describe('honesty: an unseen field is recorded as absence, never fabricated', () => {
  it('a post with no visible timestamp records an empty publishedAt (not a guessed date)', () => {
    const item = normalizePost(rawPost({ createdAt: '' }), CTX);
    expect(item.publishedAt).toBe('');
  });

  it('an empty metric yields an honest zero token, never an invented number', () => {
    const m = parseMetricText('');
    expect(m).toEqual({ raw: '', value: 0, approx: false });
  });

  it('a UserCell with no visible bio omits the field rather than storing a guess', () => {
    const acct = normalizeUserCell({
      username: 'bob', displayName: 'Bob', bio: '   ', url: 'https://x.com/bob', avatar: '',
    });
    expect(acct).not.toBeNull();
    expect(acct!.bio).toBeUndefined();
    expect(acct!.displayName).toBe('Bob'); // the visible display name is kept verbatim
  });
});
