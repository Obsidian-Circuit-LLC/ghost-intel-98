// @vitest-environment jsdom
/**
 * QUIET AMETHYST — RENDERED-CONTRAST ORACLE.
 *
 * The hand-written light-island / dim-text theme tests (theme-lightisland-readability,
 * theme-task9-readability, theme-longtail …) each pin a KNOWN site with bespoke markup. This
 * oracle is the driver that finds the sites we DON'T already know: it server-renders every
 * built-in module to static HTML, injects each into the real `.ga98-window-shell > .window >
 * .window-body` chain over the real stylesheet set (98.css + theme.css + 98.overrides.css + every
 * module css) in a REAL Chrome cascade+var engine under `data-ga98-theme='amethyst'`, and walks
 * every element flagging:
 *   (a) CONTRAST — visible text whose resolved colour fails WCAG against its nearest
 *       non-transparent ancestor background (< 4.5:1, or < 3:1 for >=18px / bold), and
 *   (b) LIGHT-ISLAND — any element whose resolved background luminance > 0.6 with a rendered box
 *       area above a small threshold (a bright island on the near-black amethyst desktop).
 *
 * WHY jsdom + real Chrome BOTH: the React components assume a browser at render (window/document/
 * matchMedia/stores), so they are server-rendered under jsdom with a COMPREHENSIVE window.api
 * auto-mock; the CONTRAST audit then runs in real Chrome because jsdom's getComputedStyle does not
 * resolve var()/cascade (standing constraint — the whole theme is var()-based).
 *
 * HONESTY: a module that cannot be server-rendered (throws) is NOT silently skipped — it lands on
 * an explicit COVERAGE-GAP list (key + error) that is printed and written to the inventory. The
 * exemption list is for GENUINE content-intrinsic colour only (named game boards, print paper) —
 * each entry carries a specific cite — and is asserted to stay small.
 *
 * This oracle is EXPECTED TO FAIL until the amethyst sweep greens every flagged site; that failure
 * is the driver. The full inventory is written to
 * docs/superpowers/plans/quiet-amethyst-oracle-inventory.md on every run.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditRenderedContrast,
  launchChrome,
  type ChromeSession,
  type ContrastFlag
} from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// The real stylesheet set, in cascade order — exactly what main.tsx bundles globally, plus every
// co-located module css (each module's css is imported at that module's top level, so at runtime
// all of them are present in the single global cascade).
const CSS: string[] = [
  read('node_modules/98.css/dist/98.css'),
  read('src/renderer/styles/theme.css'),
  read('src/renderer/styles/98.overrides.css'),
  read('src/renderer/modules/searchlight/searchlight.css'),
  read('src/renderer/modules/socmint/socmint.css'),
  read('src/renderer/modules/x/x-collector.css'),
  read('src/renderer/modules/ghostscrape/ghostscrape.css'),
  read('src/renderer/modules/investigation-graph/investigation.css'),
  read('src/renderer/modules/osint-toolkit/osint-toolkit.css')
];

// ── CURATED EXEMPTIONS — genuine content-intrinsic colour ONLY ────────────────────────────────
// Each entry must be a named content surface whose colour is DATA, not chrome: a game board with
// canonical colours, chart/map series, or print paper. NOT a place to silence a real light island.
// Kept deliberately tiny and asserted small below. (Empty for the inventory pass — we want the
// COMPLETE unfiltered inventory first; entries are added only with a specific cite as the sweep
// greens genuine content surfaces.)
const EXEMPT: string[] = [
  // Solitaire playing-card faces: canonical white card stock carrying red/black suit pips — this is
  // GAME-BOARD CONTENT (a named card game), not theming chrome. A white card under a dark skin is a
  // card, exactly the "named game board" the honesty rule cites. Tightly scoped to `.ga98-card`
  // (faces, backs, empty-foundation suit watermark) so it never masks a real chrome light island.
  '.ga98-card',
  // Chess board: the canonical lichess/chess.com two-tone board (#f0d9b5 light / #b58863 dark
  // squares) with white pieces (#fff) that carry a 2px black text-shadow outline making them
  // legible on the light squares (the WCAG fill-vs-bg ratio the walker computes ignores the
  // outline). This is content-intrinsic NAMED-GAME-BOARD colour, exactly the honesty-rule cite.
  // A stable class hook (`ga98-chess-board`, added in ChessModule) scopes the exemption to the
  // grid so it never masks a real chrome light island elsewhere.
  '.ga98-chess-board',
  // PDF Signer capture pad: a WYSIWYG white "paper" canvas you sign in black ink; the captured
  // strokes are composited onto the white PDF page, so the pad MUST match the output medium
  // (black-on-white). This is content-paper (the "print paper" cite), not chrome. Scoped to the
  // single `.ga98-sig-canvas` element.
  '.ga98-sig-canvas'
  // Minesweeper rendered no flagged content at static mount, so it needs no exemption.
];

// A module whose static render produces fewer than this many elements has no auditable chrome — it
// is a bare loading / PIN-gate / empty-state stub (e.g. `<div>Loading…</div>`) because its real
// surface is built only after an effect-driven data load that renderToStaticMarkup never runs. Such
// a module is NOT "audited clean"; it is a module the oracle CANNOT meaningfully render, so it goes
// on the explicit COVERAGE-GAP list (honesty rule) rather than silently passing with zero flags.
// Threshold is deliberately low with a wide margin: the four known stubs render 1 element each; the
// smallest module with real chrome renders ~12, so nothing substantive is near this line.
const SUBSTANTIVE_ELEMENT_MIN = 3;

interface ModuleRenderResult {
  key: string;
  title: string;
  html?: string;
  error?: string;
  /** Set when the module rendered but too shallowly to audit — routed to the coverage-gap list. */
  gap?: string;
}

let session: ChromeSession;
let renderResults: ModuleRenderResult[] = [];

/**
 * Install a COMPREHENSIVE window.api auto-mock + the browser globals the module components touch at
 * render time. window.api is a recursive callable Proxy: any property access yields another
 * callable, any call returns a resolved Promise — so a module reading `window.api.x.y()` never
 * throws on access. (Data-fetching happens in useEffect, which renderToStaticMarkup never runs, so
 * the real payloads are irrelevant; the stores supply their initial empty state.)
 */
function installBrowserStubs(): void {
  const makeApi = (): unknown => {
    const fn: (...a: unknown[]) => unknown = () => Promise.resolve(undefined);
    return new Proxy(fn, {
      get(_t, prop): unknown {
        if (prop === 'then') return undefined; // never a thenable
        if (prop === Symbol.iterator || prop === Symbol.asyncIterator) return undefined;
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === 'prototype') return undefined;
        return makeApi();
      },
      apply(): unknown {
        return Promise.resolve(undefined);
      }
    });
  };
  const w = globalThis as unknown as Record<string, unknown> & { window?: Record<string, unknown> };
  const win = (w.window ?? (w.window = {} as Record<string, unknown>)) as Record<string, unknown>;
  win.api = makeApi();
  (w as Record<string, unknown>).api = win.api;

  if (typeof win.matchMedia !== 'function') {
    const mm = (): unknown => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      }
    });
    win.matchMedia = mm;
    (w as Record<string, unknown>).matchMedia = mm;
  }
  // maplibre-gl (geoint) calls `window.URL.createObjectURL(new Blob(...))` at import time to spin up
  // its worker; jsdom's URL has no object-URL support. Stub it (+ revoke) inertly.
  const urlObj = (win.URL ?? (w as Record<string, unknown>).URL) as Record<string, unknown> | undefined;
  if (urlObj && typeof urlObj.createObjectURL !== 'function') {
    urlObj.createObjectURL = () => 'blob:oracle';
    urlObj.revokeObjectURL = () => {};
  }

  // doc-viewer instantiates `new Worker(...)` at module top level (pdf.js worker port); jsdom has
  // no Worker. An inert stub keeps that static import from throwing.
  if (typeof (w as Record<string, unknown>).Worker !== 'function') {
    class WorkerStub {
      onmessage: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(_url?: unknown, _opts?: unknown) {
        void _url;
        void _opts;
      }
      postMessage(): void {}
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    (w as Record<string, unknown>).Worker = WorkerStub;
    win.Worker = WorkerStub;
  }
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    if (typeof (w as Record<string, unknown>)[name] !== 'function') {
      (w as Record<string, unknown>)[name] = Observer;
      win[name] = Observer;
    }
  }
  // pdfjs-dist (pulled in by doc-viewer / pdf-signer at import time) constructs `new DOMMatrix()`
  // during module init — jsdom ships none, so provide inert stubs to keep the static import chain
  // from throwing and taking down the whole registry import.
  class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(_init?: unknown) {
      void _init;
    }
    multiply(): DOMMatrixStub {
      return this;
    }
    translate(): DOMMatrixStub {
      return this;
    }
    scale(): DOMMatrixStub {
      return this;
    }
    inverse(): DOMMatrixStub {
      return this;
    }
  }
  class DOMPointStub {
    x = 0;
    y = 0;
    z = 0;
    e = 1;
  }
  class Path2DStub {
    addPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    closePath(): void {}
  }
  for (const [name, ctor] of [
    ['DOMMatrix', DOMMatrixStub],
    ['DOMPoint', DOMPointStub],
    ['Path2D', Path2DStub]
  ] as const) {
    if (typeof (w as Record<string, unknown>)[name] !== 'function') {
      (w as Record<string, unknown>)[name] = ctor;
      win[name] = ctor;
    }
  }
  if (typeof (w as Record<string, unknown>).requestAnimationFrame !== 'function') {
    const raf = (cb: (t: number) => void): number => {
      void cb;
      return 0;
    };
    (w as Record<string, unknown>).requestAnimationFrame = raf;
    win.requestAnimationFrame = raf;
    (w as Record<string, unknown>).cancelAnimationFrame = () => {};
    win.cancelAnimationFrame = () => {};
  }
}

beforeAll(async () => {
  installBrowserStubs();

  // Enumerate the real built-in module set from the registry (the single source of truth), then
  // server-render each adapter with an empty synthetic spec — the exact prop-wiring the app uses.
  // Import AFTER the browser stubs are installed so any module-top-level browser access is safe.
  const { registerBuiltins } = await import('../src/renderer/modules/register-builtins');
  const { listModules, _resetRegistryForTest } = await import('../src/renderer/state/registry');
  _resetRegistryForTest();
  registerBuiltins();

  const modules = listModules().filter((m) => m.builtin);
  renderResults = modules.map((m) => {
    const spec = { id: `oracle-${m.key}`, module: m.key, title: m.title, props: {} };
    try {
      const html = renderToStaticMarkup(createElement(m.component, { spec }));
      // Count real elements in the fragment (jsdom is the test environment). A stub render with no
      // auditable chrome is a coverage gap, not a clean pass — see SUBSTANTIVE_ELEMENT_MIN.
      const probe = document.createElement('div');
      probe.innerHTML = html;
      const elementCount = probe.querySelectorAll('*').length;
      if (elementCount < SUBSTANTIVE_ELEMENT_MIN) {
        const stubText = (probe.textContent ?? '').trim().slice(0, 60);
        return {
          key: m.key,
          title: m.title,
          html,
          gap:
            `non-substantive static render (${elementCount} element${elementCount === 1 ? '' : 's'}` +
            `${stubText ? `: "${stubText}"` : ''}) — real surface is gated behind an effect-driven ` +
            `data/PIN load that renderToStaticMarkup does not run; not exercised by this oracle`
        };
      }
      return { key: m.key, title: m.title, html };
    } catch (err) {
      return { key: m.key, title: m.title, error: (err as Error)?.message ?? String(err) };
    }
  });

  session = await launchChrome();
}, 60000);

afterAll(async () => {
  await session?.close();
});

/** Audit one already-rendered module fragment under amethyst. */
async function auditModule(html: string): Promise<ContrastFlag[]> {
  return auditRenderedContrast(session.page, {
    bodyHtml: html,
    css: CSS,
    theme: 'amethyst',
    exempt: EXEMPT
  });
}

describe('QUIET AMETHYST rendered-contrast oracle', () => {
  it('renders every built-in module, audits it, and writes the full inventory', async () => {
    const perModuleFlags: { key: string; title: string; flags: ContrastFlag[] }[] = [];
    const coverageGaps: { key: string; title: string; error: string }[] = [];

    for (const r of renderResults) {
      if (r.error != null || r.html == null) {
        coverageGaps.push({ key: r.key, title: r.title, error: r.error ?? 'no html produced' });
        continue;
      }
      // A module that rendered only a stub (loading/PIN gate) is reported as a coverage gap, NOT
      // audited as clean — the oracle cannot meaningfully render its real surface (honesty rule).
      if (r.gap != null) {
        coverageGaps.push({ key: r.key, title: r.title, error: r.gap });
        continue;
      }
      const flags = await auditModule(r.html);
      perModuleFlags.push({ key: r.key, title: r.title, flags });
    }

    const rendered = perModuleFlags.length;
    const totalFlags = perModuleFlags.reduce((n, m) => n + m.flags.length, 0);
    const flaggedModules = perModuleFlags.filter((m) => m.flags.length > 0);

    // ── Write the inventory artifact (always, so it tracks the live sweep). ──────────────────────
    const outPath = join(ROOT, 'docs/superpowers/plans/quiet-amethyst-oracle-inventory.md');
    const lines: string[] = [];
    lines.push('# QUIET AMETHYST — rendered-contrast oracle inventory');
    lines.push('');
    lines.push('Generated by `test/theme-rendered-contrast.test.ts` (do not hand-edit — rerun the oracle).');
    lines.push('');
    lines.push(`- modules rendered: **${rendered}**`);
    lines.push(`- modules with flagged sites: **${flaggedModules.length}**`);
    lines.push(`- total flagged sites: **${totalFlags}**`);
    lines.push(`- coverage gaps (could not render): **${coverageGaps.length}**`);
    lines.push(`- exemptions in force: ${EXEMPT.length ? EXEMPT.map((e) => '`' + e + '`').join(', ') : '_none_'}`);
    lines.push('');
    lines.push('## Flagged sites by module');
    lines.push('');
    if (flaggedModules.length === 0) {
      lines.push('_No flagged sites — the oracle is green._');
    }
    for (const m of flaggedModules) {
      lines.push(`### ${m.key} — ${m.title} (${m.flags.length})`);
      lines.push('');
      const contrast = m.flags.filter((f) => f.kind === 'contrast');
      const islands = m.flags.filter((f) => f.kind === 'light-island');
      if (contrast.length) {
        lines.push('**Contrast:**');
        lines.push('');
        for (const f of contrast) {
          lines.push(
            `- \`${f.descriptor}\` ratio **${f.ratio}** — fg \`${f.color}\` on bg \`${f.bg}\`` +
              ` (${f.fontSize}px${f.bold ? ' bold' : ''}) — "${(f.text ?? '').replace(/`/g, "'")}"`
          );
        }
        lines.push('');
      }
      if (islands.length) {
        lines.push('**Light islands:**');
        lines.push('');
        for (const f of islands) {
          lines.push(`- \`${f.descriptor}\` bg \`${f.bg}\` (lum ${f.bgLum}, area ${f.area}px²)`);
        }
        lines.push('');
      }
    }
    lines.push('## Coverage gaps (modules that could not be server-rendered)');
    lines.push('');
    if (coverageGaps.length === 0) {
      lines.push('_None — every built-in module server-rendered cleanly._');
    }
    for (const g of coverageGaps) {
      lines.push(`- **${g.key}** (${g.title}): ${g.error.replace(/\n/g, ' ').slice(0, 300)}`);
    }
    lines.push('');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, lines.join('\n'), 'utf8');

    // ── Console summary (visible in the vitest run). ────────────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      `[amethyst-oracle] rendered=${rendered} flaggedModules=${flaggedModules.length} ` +
        `totalFlags=${totalFlags} coverageGaps=${coverageGaps.length} → inventory at ${outPath}`
    );
    for (const g of coverageGaps) {
      // eslint-disable-next-line no-console
      console.log(`[amethyst-oracle][coverage-gap] ${g.key}: ${g.error.slice(0, 160)}`);
    }

    // ── Assertions. ─────────────────────────────────────────────────────────────────────────────
    // The exemption list must stay small (content-intrinsic only).
    expect(EXEMPT.length, 'exemptions must stay small — content-intrinsic only').toBeLessThanOrEqual(8);
    // At least most modules must actually render (a mass render failure would hide the audit).
    expect(rendered, 'a majority of built-in modules must server-render for the audit to be meaningful').toBeGreaterThan(
      renderResults.length / 2
    );

    // The DRIVER assertion: zero flagged sites. Expected to FAIL until the sweep greens every site.
    const summary = flaggedModules
      .map((m) => `${m.key}(${m.flags.length})`)
      .join(', ');
    expect(totalFlags, `flagged contrast/light-island sites remain: ${summary}`).toBe(0);
  }, 180000);
});
