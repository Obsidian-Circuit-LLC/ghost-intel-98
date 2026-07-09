# Ghost Ledger 98 Midnight-Purple Theme + Header Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the Ghost Ledger 98 module midnight purple (scoped, readable), fill the header's empty space with an animated purple cube-dissolve + matrix-rain canvas beside the left-pinned recolored banner, and move OSINT Toolkit above Games in the Access menu.

**Architecture:** A palette-constants module (`ledger-theme.ts`) with a testable `contrastRatio` guard; scoped purple CSS under the existing `.ga98-invoices` module root (nothing else changes); a self-contained `<LedgerFill>` canvas component; a header layout that left-pins the (already-purple) banner beside the canvas. Exports (`renderInvoiceHtml`/`renderInvoiceDocx`) are untouched and guarded by a no-leak test.

**Tech Stack:** React + TypeScript, Canvas 2D, vitest + jsdom.

## Global Constraints

- **No new dependency, no egress.** The fill is a pure `<canvas>` animation; the recolor is a build-time asset.
- **Readability = WCAG AA (≥4.5:1).** Every theme text/background pair is verified by a unit test over the palette constants.
- **Exports untouched.** No theme color in `renderInvoiceHtml`/`renderInvoiceDocx`; a test asserts the export output contains none of the theme hex values.
- **Scoped to Ghost Ledger only.** All purple CSS is prefixed with `.ga98-invoices` (the module root) — no bare/global restyle. The window title bar stays standard Win98 grey (shell chrome, out of scope).
- **Banner is pre-placed.** The controller has replaced `src/renderer/assets/ghost-ledger-banner.png` with the midnight-purple recolor before this run (a +38° HSV hue shift of the shipped blue banner, same 1983×793). Tasks treat it as present.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage the known-dirty files. NEVER checkout/merge/delete branches or touch main — commit only on the feature branch; the controller merges.
- **Branch:** `feat/ghost-ledger-purple`.
- **Commands:** `pnpm test`, `pnpm typecheck`.

## File Structure

**New:** `src/renderer/modules/invoices/ledger-theme.ts`, `src/renderer/modules/invoices/LedgerFill.tsx`, `test/ledger-theme.test.ts`, `test/ledger-fill.test.tsx`.
**Modified:** `src/renderer/shell/AccessMenu.tsx` (menu order), `src/renderer/modules/invoices/InvoicesModule.tsx` (header layout), `src/renderer/styles/theme.css` (scoped purple + banner left-pin + fill sizing). **Asset (pre-placed):** `src/renderer/assets/ghost-ledger-banner.png`.

**Sequencing:** T1 menu → T2 theme (palette + scoped CSS + export guard) → T3 header fill (canvas + layout). Independent enough; this order is fine.

---

### Task 1: Menu — OSINT Toolkit above Games

**Files:** Modify `src/renderer/shell/AccessMenu.tsx`; Test: extend `test/access-menu.test.tsx`.

- [ ] **Step 1: Failing test** — add to `test/access-menu.test.tsx`: OSINT Toolkit appears before Games in DOM order.

```tsx
it('OSINT Toolkit is listed above Games', async () => {
  await act(async () => { root.render(<AccessMenu onClose={() => {}} />); });
  const order = Array.from(container.querySelectorAll('.ga98-access-entry')).map((e) => e.textContent || '');
  expect(order.findIndex((l) => /OSINT Toolkit/.test(l))).toBeLessThan(order.findIndex((l) => /Games/.test(l)));
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test access-menu`.

- [ ] **Step 3: Implement.** In `AccessMenu.tsx`, move the **OSINT Toolkit** flyout block (currently after `<CategoryFlyout label="Games" …/>`) to *before* the Games `CategoryFlyout`, so render order is: the five categories → OSINT Toolkit flyout → `<CategoryFlyout label="Games" …/>` → footer. No behavior change beyond order.

- [ ] **Step 4: Run tests + typecheck** → PASS/clean.
- [ ] **Step 5: Commit** — `feat(shell): move OSINT Toolkit above Games in the Access menu`.

---

### Task 2: Scoped midnight-purple theme + palette/contrast guard + export no-leak

**Files:** Create `src/renderer/modules/invoices/ledger-theme.ts`, `test/ledger-theme.test.ts`; Modify `src/renderer/styles/theme.css`.

**Interfaces:**
- Produces: `LEDGER` palette constants; `relLum(hex)`, `contrastRatio(a, b)`.

- [ ] **Step 1: Failing test** `test/ledger-theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEDGER, contrastRatio } from '../src/renderer/modules/invoices/ledger-theme';
import { renderInvoiceHtml } from '../src/renderer/modules/invoices/invoice-html';
import { renderInvoiceDocx } from '../src/main/invoices/docx';
import AdmZip from 'adm-zip';
import type { Invoice } from '../src/shared/invoice-types';

describe('ledger theme readability (WCAG AA ≥ 4.5:1)', () => {
  it('body + input text on their surfaces meet AA', () => {
    for (const bg of [LEDGER.base, LEDGER.panel, LEDGER.inset]) {
      expect(contrastRatio(LEDGER.text, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('contrastRatio is symmetric + white/black is 21', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio(LEDGER.text, LEDGER.base)).toBeCloseTo(contrastRatio(LEDGER.base, LEDGER.text), 5);
  });
});

const inv: Invoice = {
  id: 'i', number: '1', issueDate: '2026-07-10', currency: 'USD', rate: 20,
  sender: { name: 'a', company: 'b' }, client: { name: 'c', company: 'd' }, lines: [], createdAt: 'x', updatedAt: 'x',
};
describe('theme cannot leak into an export', () => {
  it('the PDF-HTML and .docx contain none of the theme hex values', () => {
    const html = renderInvoiceHtml(inv, {});
    const xml = new AdmZip(renderInvoiceDocx(inv, {})).readAsText('word/document.xml');
    for (const hex of [LEDGER.base, LEDGER.panel, LEDGER.inset, LEDGER.accent]) {
      expect(html.toLowerCase()).not.toContain(hex.toLowerCase());
      expect(xml.toLowerCase()).not.toContain(hex.toLowerCase());
    }
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test ledger-theme`.

- [ ] **Step 3: Implement.** `src/renderer/modules/invoices/ledger-theme.ts`:

```ts
/** Ghost Ledger 98 midnight-purple palette + a WCAG contrast guard. The palette lives here (not only
 *  in CSS) so a unit test can prove every text/surface pair meets AA — readability is a requirement. */
export const LEDGER = {
  base: '#1a0f2e',   // module background
  panel: '#241539',  // fieldsets / table header
  inset: '#12081f',  // input fills
  text: '#ece6f7',   // lavender-white body text
  accent: '#7c4dff', // violet accent / focus
  border: '#5a3aa8', // violet borders
} as const;

/** WCAG relative luminance of an #rrggbb color. */
export function relLum(hex: string): number {
  const n = hex.replace('#', '');
  const c = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio (1..21), order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Scoped CSS** in `theme.css` — a block scoped under `.ga98-invoices` applying `LEDGER` values (keep the hex in sync with `ledger-theme.ts`):

```css
/* Ghost Ledger 98 midnight-purple theme — scoped to the module root so nothing else changes.
   Title bar / window frame stay standard Win98 grey (shell chrome). Text meets WCAG AA. */
.ga98-invoices { background: #1a0f2e; color: #ece6f7; }
.ga98-invoices .ga98-invoice-party,
.ga98-invoices fieldset,
.ga98-invoices .ga98-invoice-totals { background: #241539; color: #ece6f7; border-color: #5a3aa8; }
.ga98-invoices legend { color: #ece6f7; }
/* Inputs: dark inset fill + light text + violet focus (restate on the element so 98.css white is beaten). */
.ga98-invoices input, .ga98-invoices select, .ga98-invoices textarea {
  background: #12081f; color: #ece6f7; border: 1px solid #5a3aa8;
}
.ga98-invoices input:focus, .ga98-invoices select:focus, .ga98-invoices textarea:focus { outline: 2px solid #7c4dff; }
/* Table: restate bg on the class selector to beat bundled 98.css `table{background:#fff}` (cascade note). */
.ga98-invoices .ga98-invoice-lines { background: #1a0f2e; color: #ece6f7; }
.ga98-invoices .ga98-invoice-lines th { background: #241539; color: #ece6f7; border-color: #5a3aa8; }
.ga98-invoices .ga98-invoice-lines td { background: #12081f; color: #ece6f7; border-color: #5a3aa8; }
.ga98-invoices button { background: #241539; color: #ece6f7; border-color: #7c4dff; }
.ga98-invoices .ga98-invoice-logo-box, .ga98-invoices .ga98-invoice-sig-box { background: #12081f; border-color: #5a3aa8; }
```

- [ ] **Step 5: Run tests + typecheck** → PASS/clean.
- [ ] **Step 6: Commit** — `feat(invoices): scoped midnight-purple theme + WCAG-AA palette guard + export no-leak test`.

---

### Task 3: Left-pinned banner + animated `LedgerFill` canvas header

**Files:** Create `src/renderer/modules/invoices/LedgerFill.tsx`, `test/ledger-fill.test.tsx`; Modify `src/renderer/modules/invoices/InvoicesModule.tsx`, `src/renderer/styles/theme.css`.

**Interfaces:** Produces `LedgerFill` (no props).

- [ ] **Step 1: Failing test** `test/ledger-fill.test.tsx` (jsdom; stub getContext so the draw path is exercised):

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LedgerFill } from '../src/renderer/modules/invoices/LedgerFill';

let container: HTMLDivElement; let root: Root;
const fakeCtx = () => ({ fillRect: vi.fn(), fillText: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), fill: vi.fn(), set font(v){}, set fillStyle(v){}, set textAlign(v){} });

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => fakeCtx());
  (globalThis as any).ResizeObserver = class { observe(){} disconnect(){} };
  (globalThis as any).IntersectionObserver = class { constructor(cb){} observe(){} disconnect(){} };
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('LedgerFill', () => {
  it('renders an aria-hidden canvas', async () => {
    await act(async () => { root.render(<LedgerFill />); });
    const c = container.querySelector('canvas');
    expect(c).toBeTruthy(); expect(c!.getAttribute('aria-hidden')).toBe('true');
  });
  it('starts NO animation loop under prefers-reduced-motion (draws once)', async () => {
    (globalThis as any).matchMedia = vi.fn(() => ({ matches: true }));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    await act(async () => { root.render(<LedgerFill />); });
    expect(raf).not.toHaveBeenCalled();
  });
  it('runs the loop when motion is allowed', async () => {
    (globalThis as any).matchMedia = vi.fn(() => ({ matches: false }));
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1 as any);
    await act(async () => { root.render(<LedgerFill />); });
    expect(raf).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test ledger-fill`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/LedgerFill.tsx`:

```tsx
/** Animated header fill beside the left-pinned banner: purple pixel-cubes dissolving out of the banner
 *  edge (denser at the left seam) + a sparse matrix code-rain behind them, gradient-blended at the seam,
 *  with a low-opacity "NO CHEATING!" watermark up the right edge. Pure decoration: throttled RAF, paused
 *  off-screen, one static frame under prefers-reduced-motion, all handles cleaned up on unmount. */
import { useEffect, useRef } from 'react';

const GLYPHS = '01<>{}[]#$%&*/\\=+ﾊﾋﾐ日ﾎ'.split('');

export function LedgerFill(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0; let onScreen = true; let last = 0; let cols: number[] = [];

    const size = (): void => { const r = canvas.getBoundingClientRect(); canvas.width = Math.max(1, Math.floor(r.width)); canvas.height = Math.max(1, Math.floor(r.height)); };
    size();
    const ro = new ResizeObserver(size); ro.observe(canvas);
    const io = new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; if (onScreen && !reduce && !raf) raf = requestAnimationFrame(loop); }); io.observe(canvas);

    function draw(): void {
      const w = canvas.width; const h = canvas.height; const fs = 12;
      ctx.fillStyle = 'rgba(18,8,31,0.35)'; ctx.fillRect(0, 0, w, h); // trailing fade
      // matrix rain (behind)
      const n = Math.max(1, Math.floor(w / fs));
      if (cols.length !== n) cols = Array.from({ length: n }, () => Math.random() * h);
      ctx.font = `${fs}px monospace`;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = 'rgba(160,120,255,0.5)';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * fs, cols[i]);
        cols[i] = cols[i] > h + Math.random() * 120 ? 0 : cols[i] + fs * 0.6;
      }
      // pixel cubes dissolving from the left seam (denser at left)
      const cube = 10;
      for (let x = 0; x < w; x += cube + 4) {
        const density = Math.max(0, 1 - x / (w * 0.8)); // 1 at seam → 0 rightward
        for (let y = 0; y < h; y += cube + 4) {
          if (Math.random() < density * 0.5) {
            ctx.fillStyle = `rgba(124,77,255,${0.25 + density * 0.5})`;
            ctx.fillRect(x, y, cube, cube);
            ctx.fillStyle = 'rgba(200,170,255,0.35)'; ctx.fillRect(x, y, cube, 2); // top highlight
          }
        }
      }
      // seam gradient (blend into the banner's dark edge)
      const g = ctx.createLinearGradient(0, 0, Math.min(120, w), 0);
      g.addColorStop(0, '#0d0518'); g.addColorStop(1, 'rgba(13,5,24,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, Math.min(120, w), h);
      // watermark up the right edge
      ctx.save(); ctx.translate(w - 12, h / 2); ctx.rotate(-Math.PI / 2);
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(210,185,255,0.16)';
      ctx.fillText('NO CHEATING!', 0, 0); ctx.restore();
    }
    function loop(t: number): void {
      raf = 0;
      if (!onScreen) return;
      if (t - last > 40) { draw(); last = t; } // ~24fps
      raf = requestAnimationFrame(loop);
    }
    if (reduce) draw(); else raf = requestAnimationFrame(loop);
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className="ga98-ledger-fill" aria-hidden="true" />;
}
```

  (Canvas art is tunable — this is a solid base; a visual tuning pass with the operator is expected, like pinball.)

- [ ] **Step 4: Header layout + CSS.**
  - `InvoicesModule.tsx`: wrap the banner in a header row with the fill:
    ```tsx
    <div className="ga98-ledger-header">
      <img src={bannerUrl} alt="Ghost Ledger 98" className="ga98-ledger-banner" />
      <LedgerFill />
    </div>
    ```
    (import `LedgerFill`; the header replaces the bare `<img>` at the top of `.ga98-invoices`.)
  - `theme.css`:
    ```css
    .ga98-ledger-header { display: flex; align-items: stretch; gap: 0; height: 150px; margin-bottom: 6px; overflow: hidden; background: #0d0518; }
    .ga98-ledger-banner { display: block; height: 150px; width: auto; max-width: 60%; margin: 0; flex: 0 0 auto; }
    .ga98-ledger-fill { flex: 1 1 auto; height: 150px; display: block; }
    ```
    (Replaces the old centered `.ga98-ledger-banner` rule at theme.css:1218.)

- [ ] **Step 5: Run tests + typecheck** → PASS/clean.
- [ ] **Step 6: Commit** — `feat(invoices): left-pinned banner + animated LedgerFill header (cubes + matrix rain, No Cheating watermark)`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`.
- [ ] Whole-branch adversarial review — focus: the theme is scoped (no bare/global selectors leaking to other modules); contrast pairs genuinely ≥4.5; **exports contain no theme color** (the guard holds); `LedgerFill` starts no RAF under reduced-motion and cleans up RAF + both observers on unmount (no leak); the banner is the purple recolor; menu order swapped.
- [ ] Grep packaged `app.asar` for `ga98-ledger-fill`, `NO CHEATING`, `ledger-theme` and confirm the purple banner ships.
- [ ] Merge `feat/ghost-ledger-purple` → main (`--no-ff`). v3.39.0.

## Self-Review

- **Spec coverage:** menu reorder (T1) ✓; scoped purple theme + readability guard (T2) ✓; exports untouched + no-leak test (T2) ✓; left-pin banner + hybrid cube/rain fill + watermark + reduced-motion (T3) ✓; title bar unchanged (not touched) ✓; recolored banner (pre-placed) ✓.
- **Placeholder scan:** none — full `ledger-theme.ts`, `LedgerFill.tsx`, CSS, and real tests. Canvas art flagged as a tuning pass (not a placeholder — it renders).
- **Type consistency:** `LEDGER`/`contrastRatio` stable T2→tests; `LedgerFill` no-prop stable T3; CSS hex kept in sync with `ledger-theme.ts` (T2 note).
- **Charter:** no new dep; no egress; readability tested; exports guarded; scoped CSS; persona identity; feature-branch-only.
