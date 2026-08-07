/**
 * TG-V — Telegram Hunter TOR-FAIL-CLOSED leak verification.
 *
 * The load-bearing trust-domain invariant of the Telegram surface (unlike the X
 * Listening Station, which is clearnet on the operator's own IP): Telegram capture
 * is pinned to Tor and FAILS CLOSED. This aggregate suite proves it two ways that a
 * single-task test does not:
 *
 *   A. BEHAVIOURAL, mutation-style — drive the REAL `openTelegramCapture` (TF1) and
 *      the REAL `TelegramHunterCollector` (TG5) with the Plan-A window factory and the
 *      Tor singleton mocked. Flip the ONE gate bit (`isBootstrapped`) and assert:
 *        - not bootstrapped ⇒ NO window is created and the caller is blocked (collector
 *          `open()` returns blocked; `connect()` THROWS) — there is never a clearnet
 *          fallback;
 *        - bootstrapped ⇒ exactly one proxied window, carrying the Tor SOCKS proxy, with
 *          WebRTC locked to `disable_non_proxied_udp`;
 *        - a dead/zero SOCKS port still routes ONLY to the SOCKS rule (connection-refused,
 *          never a direct clearnet request).
 *
 *   B. STATIC no-direct-egress source scan — the Telegram Hunter module may reach the
 *      network ONLY through the Tor-proxied capture window (`createCaptureWindow`, whose
 *      proxy-before-load ordering `capture-window.test.ts` owns) and the in-page,
 *      host-restricted `remoteMediaToDataUri` (which fetches INSIDE that proxied page).
 *      No source file may open a main-process clearnet sink (`fetch(`, `net.request`,
 *      `http(s)` client, `WebSocket`, `.loadURL(`, `session.setProxy` off the factory),
 *      and the proxied-window factory + the Tor gate must appear in `session.ts` ALONE —
 *      the single, gated network entry point.
 *
 * The mocks target ONLY the two collaborators, so the gate/wiring under test is genuine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const rec = vi.hoisted(() => ({
  createCalls: [] as Array<Record<string, unknown>>,
  webrtcCalls: [] as string[],
  bootstrapped: false,
  socksPort: 9050,
}));

vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async (opts: Record<string, unknown>) => {
    rec.createCalls.push(opts);
    return {
      webContents: {
        setWebRTCIPHandlingPolicy: (policy: string) => rec.webrtcCalls.push(policy),
      },
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
    };
  }),
  assertTrustedSender: vi.fn(),
}));

vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: vi.fn(() => ({
    isBootstrapped: () => rec.bootstrapped,
    socksPort: () => rec.socksPort,
  })),
}));

import { openTelegramCapture } from '../src/main/socmint/telegram-hunter/session';
import { TelegramHunterCollector } from '../src/main/socmint/telegram-hunter/collector';

beforeEach(() => {
  rec.createCalls = [];
  rec.webrtcCalls = [];
  rec.bootstrapped = false;
  rec.socksPort = 9050;
});

// ---- A. behavioural, mutation-style fail-closed -------------------------

describe('TG-V Tor fail-closed — the gate bit alone decides capture', () => {
  it('NOT bootstrapped ⇒ openTelegramCapture is blocked and creates NO window', async () => {
    rec.bootstrapped = false;
    const out = await openTelegramCapture('persist:socmint-telegram');
    expect(out).toMatchObject({ blocked: true });
    expect(rec.createCalls).toHaveLength(0);
    expect(rec.webrtcCalls).toHaveLength(0);
  });

  it('flip the gate to bootstrapped ⇒ exactly one proxied, WebRTC-locked window', async () => {
    // Same input, only the gate bit changes — proving the gate is the sole decider.
    rec.bootstrapped = true;
    rec.socksPort = 9151;
    const out = await openTelegramCapture('persist:socmint-telegram');
    expect('win' in out).toBe(true);
    expect(rec.createCalls).toHaveLength(1);
    const opts = rec.createCalls[0]!;
    expect((opts.proxy as { socks: string }).socks).toContain('127.0.0.1:9151');
    expect(opts.allowHosts).toEqual(['web.telegram.org', 't.me']);
    expect(rec.webrtcCalls).toEqual(['disable_non_proxied_udp']);
  });

  it('a dead/zero SOCKS port still routes ONLY to the SOCKS rule (never direct)', async () => {
    rec.bootstrapped = true;
    rec.socksPort = 0;
    const out = await openTelegramCapture('persist:socmint-telegram');
    expect('win' in out).toBe(true);
    const opts = rec.createCalls[0]!;
    // A proxy rule to the dead port ⇒ connection-refused, never a clearnet fallback.
    expect((opts.proxy as { socks: string }).socks).toBe('127.0.0.1:0');
  });
});

describe('TG-V Tor fail-closed — the collector never falls back to clearnet', () => {
  it('collector.open() is blocked and opens NO window when Tor is not ready', async () => {
    rec.bootstrapped = false;
    const collector = new TelegramHunterCollector();
    const res = await collector.open();
    expect(res).toMatchObject({ blocked: true });
    expect(collector.isOpen()).toBe(false);
    expect(rec.createCalls).toHaveLength(0);
  });

  it('collector.connect() THROWS when Tor is not ready (fail-closed, no fallback)', async () => {
    rec.bootstrapped = false;
    const collector = new TelegramHunterCollector();
    await expect(collector.connect()).rejects.toThrow(/tor is not ready/i);
    expect(rec.createCalls).toHaveLength(0);
  });

  it('capture is refused before a window exists — no window, no scrape', async () => {
    rec.bootstrapped = false;
    const collector = new TelegramHunterCollector();
    await collector.open().catch(() => {});
    await expect(
      collector.captureMessages({ caseId: 'c', jobId: 'j', channelId: '@t', channelLabel: '@t' }),
    ).rejects.toThrow(/not connected/i);
    expect(rec.createCalls).toHaveLength(0);
  });

  it('once Tor bootstraps, connect() opens exactly one proxied window', async () => {
    rec.bootstrapped = true;
    const collector = new TelegramHunterCollector();
    await collector.connect();
    expect(collector.isOpen()).toBe(true);
    expect(rec.createCalls).toHaveLength(1);
    expect((rec.createCalls[0]!.proxy as { socks: string }).socks).toContain('127.0.0.1:');
  });
});

// ---- B. static no-direct-egress source scan -----------------------------

const MODULE_DIR = 'src/main/socmint/telegram-hunter';

/** Strip block + line comments so a token mentioned only in a doc-comment is never
 *  counted as code (leaving `http://`-style URLs intact by only stripping `//` that
 *  does not follow a `:`). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function moduleSources(): Array<{ file: string; code: string }> {
  const dir = resolve(process.cwd(), MODULE_DIR);
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: f, code: stripComments(readFileSync(join(dir, f), 'utf8')) }));
}

/** Main-process clearnet egress sinks that must NEVER appear in the Telegram module.
 *  The ONLY sanctioned network paths are the Tor-proxied `createCaptureWindow`
 *  (session.ts) and the in-page host-restricted `remoteMediaToDataUri`. */
const EGRESS_SINKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['new WebSocket', /\bnew\s+WebSocket\b/],
  ['net.request/connect', /\bnet\s*\.\s*(?:request|connect|createConnection)\b/],
  ['http(s) client', /\bhttps?\s*\.\s*(?:request|get)\s*\(/],
  ['webContents.loadURL', /\.loadURL\s*\(/],
  ['session.setProxy', /\bsetProxy\s*\(/],
  ['import http/https/net', /\bfrom\s*['"](?:node:)?(?:http|https|net)['"]/],
  ['require http/https/net', /\brequire\s*\(\s*['"](?:node:)?(?:http|https|net)['"]\s*\)/],
  ['axios', /\baxios\b/],
];

describe('TG-V no direct clearnet egress — Tor is the only network path', () => {
  const sources = moduleSources();

  it('scans a non-empty set of Telegram Hunter module source files', () => {
    expect(sources.length).toBeGreaterThan(0);
    // sanity: the known files are present.
    const names = sources.map((s) => s.file).sort();
    expect(names).toEqual(
      expect.arrayContaining(['collector.ts', 'extract.ts', 'ipc.ts', 'session.ts', 'store.ts']),
    );
  });

  it('NO module file opens a main-process clearnet sink', () => {
    const violations: string[] = [];
    for (const { file, code } of sources) {
      for (const [label, re] of EGRESS_SINKS) {
        if (re.test(code)) violations.push(`${file} → ${label}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the Tor-proxied window factory is referenced in session.ts ALONE (single gated entry)', () => {
    const withFactory = sources
      .filter((s) => /\bcreateCaptureWindow\s*\(/.test(s.code) || /\bcreateCaptureWindow\b/.test(s.code))
      .map((s) => s.file);
    expect(withFactory).toEqual(['session.ts']);
  });

  it('the Tor bootstrap gate (getBgTor) is imported in session.ts ALONE', () => {
    const withGate = sources
      .filter((s) => /\bgetBgTor\b/.test(s.code) && /from\s*['"][^'"]*bgconn[^'"]*['"]/.test(s.code))
      .map((s) => s.file);
    expect(withGate).toEqual(['session.ts']);
  });

  it('session.ts holds BOTH the bootstrap gate and the WebRTC lock', () => {
    const session = sources.find((s) => s.file === 'session.ts')!;
    expect(/isBootstrapped\s*\(\s*\)/.test(session.code)).toBe(true);
    expect(session.code).toContain('disable_non_proxied_udp');
  });

  // POSITIVE CONTROLS — prove the sink matchers actually fire, so a green "no violations"
  // result means the scan works, not that the matchers are dead.
  it('every egress-sink matcher fires on a known-bad line', () => {
    const bad: Record<string, string> = {
      'fetch(': "const r = await fetch('http://evil');",
      XMLHttpRequest: 'const x = new XMLHttpRequest();',
      'new WebSocket': "new WebSocket('ws://x')",
      'net.request/connect': "net.connect(9999, 'evil')",
      'http(s) client': "https.request('http://evil')",
      'webContents.loadURL': "win.webContents.loadURL('http://evil')",
      'session.setProxy': 'ses.setProxy({})',
      'import http/https/net': "import http from 'node:http'",
      'require http/https/net': "const net = require('net')",
      axios: "import axios from 'axios'",
    };
    for (const [label, re] of EGRESS_SINKS) {
      const sample = bad[label];
      expect(sample, `no positive-control sample for ${label}`).toBeTruthy();
      expect(re.test(sample), `matcher for ${label} should fire on: ${sample}`).toBe(true);
    }
  });

  it('the matchers do NOT fire on the module boundary tokens they must tolerate', () => {
    // `executeJavaScript` (the in-page static-script runner) and a `data:` avatar are not
    // egress sinks; the scan must not mistake them for one.
    const benign = [
      "win.webContents.executeJavaScript(TG_MESSAGE_SCRIPT, true)",
      "if (avatar.startsWith('data:')) item.avatar = avatar;",
      "const { openTelegramCapture } = await import('./session');",
    ];
    for (const line of benign) {
      for (const [, re] of EGRESS_SINKS) {
        expect(re.test(line), `matcher over-fired on benign: ${line}`).toBe(false);
      }
    }
  });
});
