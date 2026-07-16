# Report Template Generator Redesign — Design Spec

**Date:** 2026-07-16
**Module:** Ghost Intel 98 → Reports (`report` builtin module)
**Origin:** GhostExodus field feedback (two screen-recordings) + a mockup of a richer "Report Template Generator" interface. Diagnosis: v3.47.0 shipped the Reports module with **zero `ga98-report` CSS** (`theme.css` has 41 `ga98-invoice` rules, 0 `ga98-report`), so the banner and inserted photos render at native resolution and the whole editor collapses into a top-left grey void. This redesign folds in that root-cause fix and evolves the module toward the mockup.

## Goal

Turn the Reports module from an unstyled single-column block list into the mockup's polished, styled "Report Template Generator": a centered fixed-width document page inside a three-column layout, with a rich toolbar, reusable-text libraries, context panels, tables, and full PDF/DOCX export parity.

## Load-Bearing Architectural Decision

**Evolve the existing block model; do NOT rewrite to a single `contentEditable` document.**

The shipped model is discrete blocks (`text` / `image`) where images are stored as **encrypted asset refs**, never inlined. A single giant `contentEditable` would force embedded images back into the persisted HTML as `data:` URIs, breaking encrypt-at-rest and bloating `reports.json`. The block model already solves the hard security problem. So: keep blocks, add a `table` block, and **style the blocks to read as one continuous page** (tight spacing inside a white fixed-width "paper"). Images stay `assetRef` blocks; the `sanitizeReportHtml` spine keeps working; risk stays low.

## Global Constraints (verbatim, bind every task)

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`. **Never** emit AI-identity trailers (`Co-Authored-By` / `Signed-off-by` / `Claude-Session`).
- **Explicit-path `git add` only.** Never stage `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`.
- **No new npm dependencies.** DOMPurify, adm-zip, pdf.js are already present. No new bundled resources (no fonts under `resources/`).
- **No new network egress / no telemetry.** Encrypt-at-rest not weakened; images remain `assetRef` blocks, never inlined into persisted HTML.
- **Security spine:** `sanitizeReportHtml` (renderer) remains the sole barrier before the main-process exporters interpolate block HTML. Every expansion stays allowlist-only. Every non-block-HTML field (title, to, caption, contact, descriptor, introduction, date, table cell text at the plain layer) stays escaped in exporters.
- **Windows-only target** — fonts rely on Windows-guaranteed families; no cross-OS font work.
- **98.css dark-table cascade:** any `<table>` styling must restate background on a **class** selector (bundled 98.css paints native tables white via element rules; class beats element on specificity).

## Font Whitelist (exact, closed set)

`Segoe UI`, `Arial`, `Times New Roman`, `Georgia`, `Courier New`, `Verdana`. All guaranteed present on Windows; render identically in the editor (Chromium), PDF (`printToPDF` = same Chromium/system fonts), and DOCX (Word resolves the named family). No font files bundled. The sanitizer accepts `font-family` ONLY when its value is one of these six exact strings.

## Data Model (`src/shared/reports-types.ts`)

- `Report` gains `reportDate?: string` (ISO `YYYY-MM-DD`, the mockup's Date field).
- New block variant: `{ id: string; kind: 'table'; cells: string[][] }` — row-major grid; each cell is a `sanitizeReportHtml`-clean HTML string (inline B/I/U/font only). Rectangular (every row same length); a fresh table is 2×2 empty cells.
- `ReportStoreData` gains `introductions: Descriptor[]` — an "Introduction" is a named reusable text, structurally identical to a `Descriptor` (`{id,name,body}`); reuse that type. Store, validator, and insert path mirror descriptors exactly.

## Rich-Text Security Spine (`src/renderer/modules/reports/rich-text.ts`)

`sanitizeReportHtml` expands, still allowlist-only:

- **ALLOWED_TAGS** add: `ul, ol, li, a` (keep `b,strong,i,em,u,p,br,span`).
- **ALLOWED_ATTR** add: `href` (keep `style`).
- **`uponSanitizeAttribute` hook** (the `style` branch grows; add an `href` branch):
  - `style`: keep only the subset of `{ font-size:<n>pt, font-family:<one of the 6>, text-align:left|center|right }` that is present and valid; drop the whole attribute if none valid. Reject every other declaration (no color, position, url(), etc.).
  - `href`: keep only when the scheme is `http:`, `https:`, or `mailto:` (case-insensitive, leading-whitespace-trimmed). Anything else (`javascript:`, `data:`, relative, malformed) → `keepAttr = false`.
- `FONT_SIZES` unchanged. Add `FONT_FAMILIES` (the six-string whitelist) exported for the toolbar dropdown and reused by the hook as the validation set.
- New `introductionInsertHtml` reuses `descriptorInsertHtml`'s escaping (or the same function is generalized) — introductions insert escaped body text like descriptors.

## Layout & CSS (the root-cause fix, `src/renderer/styles/theme.css`)

A full `ga98-report` stylesheet block (mirroring the invoice block's completeness). Three-column layout inside the Reports window:

- **Left rail** — libraries, each the existing add/edit/delete/select pattern: Contact/From (`ContactBook`), Recipient/To, Introductions (new `IntroductionLibrary`), Descriptors (`DescriptorLibrary`).
- **Center** — a pinned toolbar, the scrollable document **page**, and a status bar.
- **Right rail** — Descriptor Preview, Document Outline, Image Properties.

Key rules: `.ga98-report-page` is a white fixed-width "paper" (816px = 8.5in @ 96dpi) with box-shadow, centered, `transform: scale(var(--zoom))` for zoom; `.ga98-report-banner-img` and `.ga98-report-imageblock-img` get `max-width:100%`; toolbar/rail/status-bar layout; table styling restates background on the `.ga98-report-tableblock` class (98.css cascade). The center scrolls; rails are fixed-width.

## Toolbar & Interaction

- **Toolbar:** font-family dropdown (the six), size (existing presets), B / I / U, align L/C/R, bullet list, numbered list, link (prompt→scheme-guarded `<a href>`), descriptor dropdown. Formatting applies to the focused text block's selection via the existing `execCommand`-style path, then re-sanitizes.
- **Right-click context menu** (extends the existing descriptor-insert menu): Add Descriptor ▸ (submenu), Add Introduction ▸ (submenu), Insert Image, Insert Table, Clear Formatting.
- **Right rail panels:** Descriptor Preview (full body of the hovered/selected descriptor); Document Outline (nav list built by scanning text blocks for heading-styled lines — a "heading" is a line whose span carries the 18pt heading size; clicking scrolls to it); Image Properties (width % slider + caption + align for the selected image block, driving the existing `widthPct`).

## Export Parity

- **`report-html.ts` (PDF):** render `table` blocks as `<table class="ga98-report-...">`; the page CSS (fixed width, font-family, align, list, link, image caps) is embedded so the PDF matches the editor. Text-block HTML still interpolated verbatim (already sanitized). New plain fields (`reportDate`) escaped via `escapeHtml`. Table cell HTML is sanitized-clean (interpolated verbatim like text blocks); nothing else in a table is untrusted.
- **`docx.ts` (DOCX):** the stack tokenizer grows to emit: hyperlink runs for `a` (via a `w:hyperlink` + relationship, or a styled run carrying the URL — must round-trip in Word), bullet/numbered paragraphs for `ul/ol/li` (numbering part), paragraph alignment (`w:jc`) from `text-align`, run fonts (`w:rFonts`) from `font-family`. `table` blocks → OOXML `w:tbl` with `w:tr`/`w:tc`, each cell's inline HTML tokenized by the same `blockRuns`. `reportDate` emitted as a plain escaped paragraph.

## Page Metrics

- **Word count:** exact — strip HTML across all text + table-cell content, count whitespace-delimited tokens.
- **Page count:** estimated `ceil(page.scrollHeight / pageHeightPx)` (pageHeightPx ≈ 1056 = 11in @ 96dpi minus margins), shown honestly as `~N pages`.
- **Zoom:** CSS `transform: scale()` on the page, 50–200% via a dropdown/stepper; status bar shows the percentage.
- **Page Setup:** deferred to a follow-up (default US Letter). Out of scope for this pass.

## Testing & Verification

- **Unit tests:** every sanitizer rule (font-family whitelist enforcement incl. a rejected non-whitelisted family; href scheme-guard incl. rejected `javascript:`/`data:`; align/list allow; everything-else reject); DOCX tokenizer for links/lists/align/font/table → correct OOXML; word-count & page-count math; table block ops (add/remove row/col, rectangularity); introductions store CRUD + validator; `reportDate` round-trip.
- **CSS/computed-style:** headless Playwright harness asserts banner and image are width-capped, the page is centered and fixed-width, and table backgrounds survive the 98.css cascade.
- **Packaged verification:** grep the built `app.asar` for the new module wiring (remember the un-minified `x: y` spacing gotcha — grep with the space or extract the asar).
- **Windows-VM UI QA launch (honor the waived gate):** launch the packaged app, open Reports, confirm the styled three-column page renders (not the grey void), banner sized, a photo sized, all rails/panels present, a table inserts, PDF/DOCX export. This launch is exactly what would have caught the original bug — 12th ship since the gate was waived.

## Out of Scope (explicit)

- True WYSIWYG multi-page pagination (chose fixed-width page + estimated count).
- Bundled/custom fonts (chose Windows system fonts).
- Merged cells / nested tables / per-cell background (chose simple grid).
- Page Setup dialog (deferred).
- Font-family or formatting beyond the six families and the listed toolbar controls.
