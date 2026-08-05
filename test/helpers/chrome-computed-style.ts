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

// ───────────────────────────────────────────────────────────────────────────
// Rendered-contrast oracle machinery (shared so the oracle and future tests can
// reuse the render+inject+walk pipeline). A caller server-renders a module to a
// static HTML fragment, hands it here with the real stylesheet set + the target
// theme, and this injects it into the `.ga98-window-shell > .window > .window-body`
// ancestor chain (the surface tokens `--ga98-grey` etc. only resolve to the window
// surface with that chain present) and walks every element in a REAL cascade+var
// engine, flagging:
//   (a) CONTRAST — any element with its own visible text whose resolved colour
//       fails WCAG against the nearest non-transparent ancestor background
//       (< 4.5:1 normal, < 3:1 for >=18px or bold), and
//   (b) LIGHT-ISLAND — any element whose resolved background luminance > 0.6 with a
//       rendered box area above a small threshold (a bright island on the near-black
//       amethyst desktop) unless it (or an ancestor) matches an exemption selector.
// ───────────────────────────────────────────────────────────────────────────

export interface ContrastFlag {
  kind: 'contrast' | 'light-island';
  /** Compact element descriptor: `tag#id.class` (first few classes). */
  descriptor: string;
  /** Trimmed direct text (contrast flags only). */
  text?: string;
  /** Resolved foreground colour (contrast flags only). */
  color?: string;
  /** Resolved effective background colour used for the comparison. */
  bg?: string;
  /** WCAG contrast ratio (contrast flags only), 2 d.p. */
  ratio?: number;
  /** Rendered font-size px (contrast flags only). */
  fontSize?: number;
  /** Whether the text is bold (contrast flags only). */
  bold?: boolean;
  /** Background relative luminance (light-island flags only), 3 d.p. */
  bgLum?: number;
  /** Rendered box area in px² (light-island flags only). */
  area?: number;
}

export interface AuditOptions {
  /** The module's server-rendered static HTML fragment (goes inside `.window-body`). */
  bodyHtml: string;
  /** Stylesheets, in cascade order (98.css, theme.css, 98.overrides.css, module css…). */
  css: string[];
  /** Theme to stamp on `<html>` (`'amethyst'` for the oracle); null = classic default. */
  theme?: string | null;
  /**
   * Content-intrinsic exemption selectors. An element matching any of these (or with a
   * matching ancestor) is skipped for BOTH checks — reserved for genuine content-paper /
   * content-intrinsic colour (named game boards, map data-layers, chart series, print paper).
   * Keep this list SMALL and each entry justified; do NOT allow-list a real light-island bug.
   */
  exempt?: string[];
}

/**
 * Inject a server-rendered fragment + the real stylesheet set into the running page and walk it
 * for contrast + light-island violations. Reuses one Chrome session across many calls (the caller
 * owns lifecycle). Returns the flat flag list (empty === clean).
 */
export async function auditRenderedContrast(page: ChromePage, opts: AuditOptions): Promise<ContrastFlag[]> {
  const styleTags = opts.css.map((c) => '<style>' + c + '</style>').join('');
  const themeAttr = opts.theme ? ` data-ga98-theme="${opts.theme}"` : '';
  // A wrapper <script> can't run via document.write reliably here, so we stamp the theme onto
  // <html> through the head style trick is not possible — instead we set it after content loads.
  const doc =
    '<head>' +
    styleTags +
    // Body carries the near-black desktop so the bgOf() fallback (text painted straight onto the
    // desktop with no surface of its own) is measured against the real desktop, not white.
    '<style>html,body{margin:0}body{background:var(--ga98-desktop-bg,#0c0a12)}' +
    '.ga98-window-shell{position:static;width:960px}</style>' +
    '</head><body' +
    themeAttr +
    '><div class="ga98-window-shell" data-focused="true"><div class="window"><div class="window-body">' +
    opts.bodyHtml +
    '</div></div></div></body>';
  await page.setContent(doc);
  // setContent writes into a fresh document; the theme attr in the <body> tag doesn't reach <html>,
  // so stamp it explicitly (matches App.tsx which sets it on documentElement).
  await page.evaluate(
    opts.theme
      ? `document.documentElement.dataset.ga98Theme = ${JSON.stringify(opts.theme)}; true`
      : `delete document.documentElement.dataset.ga98Theme; true`
  );

  const exemptJson = JSON.stringify(opts.exempt ?? []);
  return page.evaluate<ContrastFlag[]>(
    `(() => {
       const EXEMPT = ${exemptJson};
       const root = document.querySelector('.window-body') || document.body;
       const flags = [];
       const seen = new Set();
       function parseRGB(s){ const m = s && s.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
         const p = m[1].split(',').map((x)=>parseFloat(x)); return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]}; }
       function lin(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
       function lum(c){ return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b); }
       function contrast(a,b){ const L1=lum(a),L2=lum(b),hi=Math.max(L1,L2),lo=Math.min(L1,L2); return (hi+0.05)/(lo+0.05); }
       function isExempt(el){ for(let n=el; n && n!==document.documentElement; n=n.parentElement){
         for(const sel of EXEMPT){ try{ if(n.matches(sel)) return true; }catch(e){} } } return false; }
       function bgOf(el){ for(let n=el; n && n!==document.documentElement; n=n.parentElement){
         const c=parseRGB(getComputedStyle(n).backgroundColor); if(c && c.a>0) return c; }
         const b=parseRGB(getComputedStyle(document.body).backgroundColor); return (b&&b.a>0)?b:{r:255,g:255,b:255,a:1}; }
       function visible(el){ const cs=getComputedStyle(el);
         if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return false;
         return el.getClientRects().length>0; }
       function desc(el){ let d=el.tagName.toLowerCase(); if(el.id) d+='#'+el.id;
         if(el.className && typeof el.className==='string'){ const c=el.className.trim().split(/\\s+/).filter(Boolean).slice(0,3); if(c.length) d+='.'+c.join('.'); }
         return d; }
       function directText(el){ let t=''; for(const n of el.childNodes) if(n.nodeType===3) t+=n.nodeValue; return t.trim(); }
       const all = root.querySelectorAll('*');
       for(const el of all){
         if(!visible(el)) continue;
         if(isExempt(el)) continue;
         const cs = getComputedStyle(el);
         const txt = directText(el);
         if(txt){
           const fg = parseRGB(cs.color);
           if(fg && fg.a>0){
             const bg = bgOf(el);
             const ratio = contrast(fg,bg);
             const fsize = parseFloat(cs.fontSize);
             const bold = parseInt(cs.fontWeight,10) >= 700;
             const large = fsize>=18 || bold;
             const floor = large ? 3 : 4.5;
             if(ratio < floor){
               const key = 'c|'+desc(el)+'|'+txt.slice(0,24);
               if(!seen.has(key)){ seen.add(key);
                 flags.push({kind:'contrast',descriptor:desc(el),text:txt.slice(0,60),
                   color:cs.color,bg:'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')',
                   ratio:Math.round(ratio*100)/100,fontSize:fsize,bold:bold}); }
             }
           }
         }
         const own = parseRGB(cs.backgroundColor);
         if(own && own.a>0){
           const L = lum(own);
           if(L>0.6){
             const r = el.getBoundingClientRect();
             const area = r.width*r.height;
             if(area>100){
               const key = 'i|'+desc(el);
               if(!seen.has(key)){ seen.add(key);
                 flags.push({kind:'light-island',descriptor:desc(el),bg:cs.backgroundColor,
                   bgLum:Math.round(L*1000)/1000,area:Math.round(area)}); }
             }
           }
         }
       }
       return flags;
     })()`
  );
}
