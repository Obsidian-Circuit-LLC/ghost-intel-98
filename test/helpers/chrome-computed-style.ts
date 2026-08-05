/**
 * Headless real-Chrome computed-style harness for the theme layer.
 *
 * WHY A REAL BROWSER (not jsdom): jsdom's `getComputedStyle` does NOT resolve `var()` custom
 * properties — a probe confirmed `color: var(--x)` comes back literally as the string
 * `"var(--x)"`, never the resolved `rgb(...)`. The QUIET AMETHYST theme is entirely `var()`-based
 * (a base `:root` tier + a `[data-ga98-theme='amethyst']` override tier), so every colour
 * assertion MUST run against a real cascade+var engine. The repo standing constraint mandates the
 * Chrome computed-style harness for exactly this reason ("jsdom is BLIND to CSS cascade").
 *
 * WHY RAW CDP (not the `playwright-core` wrapper the constraint names): `playwright-core` is not
 * installed in this environment (`require.resolve` fails; it exists only in transient npx caches),
 * and BOTH this plan's Global Constraints and the operator's charter forbid adding a new
 * dependency or any network egress to install one. So this harness drives the exact binary the
 * constraint names — `/opt/google/chrome/chrome`, `--no-sandbox`, headless — directly over the
 * DevTools Protocol using `ws` (already a project dependency) plus node built-ins. Zero new
 * dependencies, zero network, identical real-Chrome cascade+var-resolution guarantee.
 *
 * Tests mount within the `.ga98-window-shell > .window > .window-body` ancestor chain (the known
 * `.window{height:100%}` cascade trap only manifests with the shell present).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

const CHROME_BIN = '/opt/google/chrome/chrome';

export interface ChromePage {
  /** Replace the whole document with `html` (a full `<head>…</head><body>…</body>` fragment). */
  setContent(html: string): Promise<void>;
  /** Evaluate a JS expression in the page and return its value (by value). */
  evaluate<T = unknown>(expression: string): Promise<T>;
}

export interface ChromeSession {
  page: ChromePage;
  close(): Promise<void>;
}

interface CdpVersion {
  webSocketDebuggerUrl: string;
}

function getJSON<T>(port: number, path: string): Promise<T> {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          res(JSON.parse(d) as T);
        } catch (e) {
          rej(e);
        }
      });
    });
    req.on('error', rej);
  });
}

async function waitForVersion(port: number): Promise<CdpVersion> {
  for (let i = 0; i < 100; i++) {
    try {
      return await getJSON<CdpVersion>(port, '/json/version');
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Chrome did not expose a DevTools endpoint within 10s');
}

/**
 * Launch a headless Chrome, attach a page target, and return a minimal Page + a close() that
 * tears the whole thing down. The caller owns lifecycle (call `close()` in afterEach/finally).
 */
export async function launchChrome(): Promise<ChromeSession> {
  const port = 9200 + Math.floor(Math.random() * 700);
  const chrome: ChildProcess = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  const version = await waitForVersion(port);
  const ws = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });

  let nextId = 0;
  const pending = new Map<number, (o: { result?: unknown; error?: unknown }) => void>();
  ws.on('message', (raw: Buffer | string) => {
    const o = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: unknown };
    if (o.id != null && pending.has(o.id)) {
      pending.get(o.id)!(o);
      pending.delete(o.id);
    }
  });
  await new Promise<void>((r) => ws.on('open', () => r()));

  function browserCmd(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown }> {
    return new Promise((res) => {
      const id = ++nextId;
      pending.set(id, res as never);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const created = (await browserCmd('Target.createTarget', { url: 'about:blank' })).result as {
    targetId: string;
  };
  const attached = (
    await browserCmd('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  ).result as { sessionId: string };
  const sessionId = attached.sessionId;

  function sessionCmd(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> {
    return new Promise((res) => {
      const id = ++nextId;
      pending.set(id, res as never);
      ws.send(JSON.stringify({ id, sessionId, method, params }));
    });
  }

  await sessionCmd('Runtime.enable');
  await sessionCmd('Page.enable');

  const page: ChromePage = {
    async setContent(html: string): Promise<void> {
      const expr =
        'document.open();document.write(' + JSON.stringify('<!doctype html><html>' + html + '</html>') + ');document.close();';
      await sessionCmd('Runtime.evaluate', { expression: expr });
    },
    async evaluate<T>(expression: string): Promise<T> {
      const r = (await sessionCmd('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      })) as { result?: { result?: { value?: T }; exceptionDetails?: unknown }; error?: unknown };
      const inner = r.result as { result?: { value?: T }; exceptionDetails?: { text?: string } } | undefined;
      if (inner?.exceptionDetails) {
        throw new Error('page.evaluate threw: ' + JSON.stringify(inner.exceptionDetails));
      }
      return inner?.result?.value as T;
    }
  };

  return {
    page,
    async close(): Promise<void> {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      chrome.kill('SIGKILL');
    }
  };
}
