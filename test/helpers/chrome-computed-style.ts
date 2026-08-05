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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  /**
   * Capture a PNG of the CURRENT page content at a fixed device size and return the raw base64
   * string (CDP `Page.captureScreenshot`, format png). Sizing the device metrics first makes the
   * capture deterministic regardless of the launcher's default viewport. This is a VISUAL ARTIFACT
   * only — never an audit input; `auditRenderedContrast` leaves its injected content in place, so a
   * screenshot taken right after an audit call frames exactly what was measured.
   */
  screenshot(opts: { width: number; height: number }): Promise<string>;
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
    },
    async screenshot(opts: { width: number; height: number }): Promise<string> {
      // Pin the device metrics so the frame is exactly opts.width×opts.height regardless of the
      // launcher's default viewport, then clip to that box for a byte-stable capture.
      await sessionCmd('Emulation.setDeviceMetricsOverride', {
        width: opts.width,
        height: opts.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      const r = (await sessionCmd('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: opts.width, height: opts.height, scale: 1 },
        captureBeyondViewport: true
      })) as { result?: { data?: string }; error?: unknown };
      const data = (r.result as { data?: string } | undefined)?.data;
      if (!data) throw new Error('Page.captureScreenshot returned no data: ' + JSON.stringify(r.error ?? r));
      return data;
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
//       fails WCAG against its effective (alpha-composited, gradient-aware) background
//       (< 4.5:1 normal; < 3:1 only for TRUE large text: >=24px, or bold and >=18.66px), and
//   (b) LIGHT-ISLAND — any element whose effective background luminance clears the amethyst
//       surface band (cutpoint derived from the resolved --ga98-desktop-bg/--ga98-grey tokens,
//       ~0.22; see ISLAND_CUT) with a rendered box area above a small threshold — a bright island
//       on the near-black amethyst desktop — unless it (or an ancestor) matches an exemption
//       selector. Both checks understand gradient/background-image surfaces and semi-transparent
//       (rgba / opacity<1) layers, which the earlier backgroundColor-only walk skipped silently.
//
// KNOWN LATENT GAPS (ACCEPTED LIMITATIONS — this oracle is a strong regression guard for rendered
// chrome + empty-state surfaces, NOT a proof of total contrast coverage; these are disclosed, not
// silently ignored):
//   1. RASTER background-image light-islands. The light-island check parses only CSS <gradient>
//      colour stops. A `background-image:url(...)` (PNG/JPG/SVG raster, incl. data: URIs) is not
//      decoded, so a bright bitmap tile painted onto the dark desktop is NOT caught. Gradient and
//      solid backgrounds ARE covered; raster fills are the blind spot. (The GeoINT star-field /
//      map tiles are the canonical example and are additionally exemption-scoped.)
//   2. ::before / ::after PSEUDO-ELEMENT text. The walk reads each element's OWN direct text
//      nodes; generated `content:` text (and any colour it carries) lives on a pseudo-element that
//      `querySelectorAll('*')` never returns, so pseudo-element glyph/icon contrast is unaudited.
//   3. SSR LAYOUT-AREA dependence. Light-island flags gate on `getBoundingClientRect()` area, and
//      contrast large-text classification gates on the resolved font-size. Both are measured in a
//      fixed 960px-wide headless viewport with the module's server-rendered (pre-effect) DOM. An
//      element whose real rendered size/position differs at runtime (flex/grid that only resolves
//      once data populates, media-query breakpoints, virtualised rows) can be mis-sized here — a
//      sub-threshold box may be under-counted, or an off-screen node measured at 0 area. The
//      empty-state shell is measured faithfully; populated/relaid-out geometry is not proven.
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
  /** True when the flagged background is a gradient/background-image surface (either kind). */
  gradient?: boolean;
  /** Manual-review note — set when alpha compositing (rgba fg/bg or opacity<1) influenced the math. */
  note?: string;
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
/**
 * Capture the page's current content as a PNG and write it to `filePath` (default 900×620, a
 * legible size). Creates parent directories as needed. Returns the absolute-ish path written.
 * Intended to be called immediately after `auditRenderedContrast` so the saved image frames exactly
 * the populated surface that was just measured.
 */
export async function captureScreenshot(
  session: ChromeSession,
  filePath: string,
  opts: { width?: number; height?: number } = {}
): Promise<string> {
  const width = opts.width ?? 900;
  const height = opts.height ?? 620;
  const base64 = await session.page.screenshot({ width, height });
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

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
       // Fix 4 (alpha): composite a possibly semi-transparent colour \`fg\` OVER an opaque colour \`bg\`.
       function over(fg,bg){ const a = fg.a===undefined?1:fg.a; if(a>=1) return {r:fg.r,g:fg.g,b:fg.b,a:1};
         return {r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a), a:1}; }
       // Resolve any CSS colour string (incl. hex token values) to rgb via a throwaway probe;
       // fast-path already-rgb strings so gradient stops (browser-normalised to rgb()) parse directly.
       const probe = document.createElement('span'); probe.style.cssText='display:none'; document.body.appendChild(probe);
       function toRGB(str){ if(!str) return null; str=(''+str).trim(); if(!str) return null;
         if(/^rgba?\\(/.test(str)) return parseRGB(str);
         probe.style.color=''; probe.style.color=str; return parseRGB(getComputedStyle(probe).color); }

       // ── Fix 1: light-island cutpoint DERIVED from the resolved amethyst surface tokens. ──
       const dv = getComputedStyle(document.documentElement);
       function tokenColor(name,fallback){ return toRGB(dv.getPropertyValue(name)) || toRGB(fallback); }
       const DESK = tokenColor('--ga98-desktop-bg','#0c0a12') || {r:12,g:10,b:18,a:1};
       const GREY = tokenColor('--ga98-grey','#1a1822') || {r:26,g:24,b:34,a:1};
       const surfaceBandMax = Math.max(lum(DESK), lum(GREY));
       // The four amethyst chrome surfaces (#0c0a12/#141119/#1a1822/#211d2b) resolve to lum ~0.003–0.014;
       // the LIGHTEST chrome surface --ga98-grey (#1a1822) is ~0.0099. A classic light surface leaking
       // through unthemed is Windows silver #c0c0c0 (0.527) or light-grey #b0b0b0 (0.434). Cut at
       // max(0.22 floor, 8× surface band): the 0.22 floor sits ~22× above the surface band yet BELOW
       // light-grey 0.434 and silver 0.527, so both classic surfaces are caught while all four dark
       // amethyst surfaces are ignored; the 8× term re-derives the cut upward automatically if the
       // surface tokens are ever lightened. (The old 0.6 sat ABOVE silver 0.527 → silver islands passed.)
       const ISLAND_CUT = Math.max(0.22, surfaceBandMax * 8);

       // An exemption is SCOPED to the element it names and that element's SUBTREE — nothing else.
       // An element is exempt iff it matches an exemption selector itself, OR it lies inside the
       // subtree of a matching element (its nearest ENCLOSING match). It is NOT exempt merely because
       // some element beside or far below it matches; and, crucially, the ancestor CHAIN that only
       // CONTAINS an exempt element (e.g. the rail row / panel wrapping a \`.ga98-geo-threat\` pill) is
       // NOT itself exempt — so a leaf exemption cannot silence chrome or text above or beside it.
       // \`Element.closest(sel)\` expresses exactly this self-or-enclosing-match relationship; the old
       // hand-rolled ancestor walk matched the same set but read as "check the element AND all its
       // ancestors", inviting the misreading that a contained exemption leaks upward. It does not.
       function isExempt(el){ for(const sel of EXEMPT){ try{ if(el.closest(sel)) return true; }catch(e){} } return false; }
       // Fold EVERY ancestor's opacity into a descendant's effective alpha. CSS opacity<1 on ANY
       // ancestor (e.g. a CommandRail category row at opacity:0.55) uniformly dims the whole subtree
       // it wraps — including this element's text — yet the element's OWN computed opacity does not
       // capture an ancestor's. Walk from the element up to the root, multiplying each element's own
       // computed opacity, to recover the real on-screen alpha the viewer perceives.
       function effectiveOpacity(el){ let o=1; for(let n=el; n && n!==document.documentElement; n=n.parentElement){
         const op=parseFloat(getComputedStyle(n).opacity); if(isFinite(op)) o*=op; } return o; }
       // WCAG 2.x SC 1.4.3 EXPLICITLY exempts "inactive user interface components" from the contrast
       // minimum: a disabled control is INTENTIONALLY dimmed (e.g. \`.ga98-report-tile:disabled{opacity:0.4}\`)
       // to signal unavailability — that dimming is an affordance, not a defect. So text inside a
       // disabled / aria-disabled control is not contrast-checked. This is NARROW — it fires only on a
       // genuinely inactive control; a merely de-emphasised but still-active element (e.g. an "off"
       // filter toggle at opacity:0.55) is NOT exempt and stays fully audited by the ancestor-opacity path.
       function inInactiveControl(el){ for(let n=el; n && n!==document.documentElement; n=n.parentElement){
         try{ if(n.matches(':disabled, [disabled], [aria-disabled="true"]')) return true; }catch(e){} } return false; }
       // Fix 2: parse a gradient/background-image's colour stops (computed value normalises them to
       // rgb()); returns the opaque stops, or null when the element has no gradient image.
       function gradientStops(cs){ const bi = cs.backgroundImage;
         if(!bi || bi==='none' || bi.indexOf('gradient')===-1) return null;
         const stops=[]; const re=/rgba?\\([^)]*\\)/g; let m;
         while((m=re.exec(bi))){ const c=parseRGB(m[0]); if(c && c.a>0) stops.push(c); }
         return stops.length?stops:null; }
       // Effective OPAQUE backdrop candidate(s) for \`el\`. Walks ancestors (self included when
       // includeSelf): the first solid opaque bg OR gradient (Fix 2: gradients are opaque, stop the
       // walk) is the base; semi-transparent solid layers above it are composited down (Fix 4). A
       // gradient base yields ONE candidate PER stop so the caller can take the worst case. Falls back
       // to the body/desktop background, else white.
       function bgCandidates(el, includeSelf){
         const solids=[]; let base=null;
         for(let n=includeSelf?el:el.parentElement; n && n!==document.documentElement; n=n.parentElement){
           const cs=getComputedStyle(n); const solid=parseRGB(cs.backgroundColor);
           if(solid && solid.a>0){ if(solid.a>=1){ base=[solid]; break; } solids.push(solid); continue; }
           const stops=gradientStops(cs); if(stops){ base=stops.slice(); break; } }
         if(!base){ const b=parseRGB(getComputedStyle(document.body).backgroundColor);
           base=[ (b&&b.a>0) ? (b.a>=1?b:over(b,{r:255,g:255,b:255})) : {r:255,g:255,b:255,a:1} ]; }
         // Composite the collected semi-transparent solids (bottom-most first) onto each base candidate.
         return base.map((bc)=>{ let acc={r:bc.r,g:bc.g,b:bc.b,a:1};
           for(let i=solids.length-1;i>=0;i--){ acc=over(solids[i],acc); } return acc; });
       }
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
           const fgRaw = parseRGB(cs.color);
           // Skip contrast for text inside an inactive (disabled) control — WCAG SC 1.4.3 exempts it.
           if(fgRaw && fgRaw.a>0 && !inInactiveControl(el)){
             const cands = bgCandidates(el, true);
             // Fix 4 + ANCESTOR OPACITY: fold rgba() text alpha AND the ACCUMULATED opacity of this
             // element plus every ancestor into the effective foreground alpha, then composite it over
             // each backdrop candidate — never measure alpha/dimmed text at full opacity. An ancestor
             // wrapper at opacity:0.55 dims its descendant text just as surely as the text's own alpha.
             const accOpacity = effectiveOpacity(el);
             const aEff = (fgRaw.a===undefined?1:fgRaw.a) * accOpacity;
             // aEff===0 means an ancestor (or the element) is opacity:0 → the text is invisible, not a
             // contrast defect; skip it rather than flagging fully-transparent text as "low contrast".
             if(aEff>0){
             // Worst-case (lowest) contrast across gradient-stop candidates.
             let worst=Infinity, worstBg=null;
             for(const bc of cands){ const fg=over({r:fgRaw.r,g:fgRaw.g,b:fgRaw.b,a:aEff}, bc);
               const r=contrast(fg,bc); if(r<worst){ worst=r; worstBg=bc; } }
             const fsize = parseFloat(cs.fontSize);
             const bold = parseInt(cs.fontWeight,10) >= 700;
             // Fix 3: WCAG large text = fontSize>=24px, OR (bold AND fontSize>=18.66px). Else 4.5:1.
             const large = fsize>=24 || (bold && fsize>=18.66);
             const floor = large ? 3 : 4.5;
             if(worst < floor){
               const key = 'c|'+desc(el)+'|'+txt.slice(0,24);
               if(!seen.has(key)){ seen.add(key);
                 const alpha = (fgRaw.a<1) || (accOpacity<1) || cands.length>1;
                 flags.push({kind:'contrast',descriptor:desc(el),text:txt.slice(0,60),
                   color:cs.color,bg:'rgb('+Math.round(worstBg.r)+','+Math.round(worstBg.g)+','+Math.round(worstBg.b)+')',
                   ratio:Math.round(worst*100)/100,fontSize:fsize,bold:bold,
                   gradient: cands.length>1 || undefined,
                   note: alpha ? 'alpha-composited (rgba/opacity<1 or gradient stop) — verify manually' : undefined}); }
             }
             } // end if(aEff>0)
           }
         }
         // ── Light-island check on the element's OWN background (solid or gradient — Fix 1 + Fix 2). ──
         const ownSolid = parseRGB(cs.backgroundColor);
         const ownStops = gradientStops(cs);
         let islandLum=-1, islandBg=null, isGrad=false;
         if(ownSolid && ownSolid.a>0){ islandLum=lum(ownSolid.a>=1?ownSolid:over(ownSolid,DESK)); islandBg=cs.backgroundColor; }
         if(ownStops){ let mx=-1; for(const s of ownStops){ const l=lum(s); if(l>mx) mx=l; } // worst case = lightest stop
           if(mx>islandLum){ islandLum=mx; islandBg=(cs.backgroundImage||'').slice(0,120); isGrad=true; } }
         if(islandLum > ISLAND_CUT){
           const r = el.getBoundingClientRect();
           const area = r.width*r.height;
           if(area>100){
             const key = 'i|'+desc(el);
             if(!seen.has(key)){ seen.add(key);
               flags.push({kind:'light-island',descriptor:desc(el),bg:islandBg,
                 bgLum:Math.round(islandLum*1000)/1000,area:Math.round(area),
                 gradient: isGrad || undefined}); }
           }
         }
       }
       return flags;
     })()`
  );
}
