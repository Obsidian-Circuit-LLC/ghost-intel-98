# Reports Templates + Word-Processor Editor — Design Spec (v3.50.0)

**Date:** 2026-07-16
**Module:** Ghost Intel 98 → Reports.
**Origin:** GhostExodus's "Chain of Custody Report and Template Generator" vision — sub-projects **B (Templates)** and **C (editor word-processor feel)**, built together and shipped as v3.50.0. (Sub-project A — Dashboard/Nav/Status — shipped in v3.49.0; the Win98 reskin in v3.49.1.)

## Goal

**B:** Save a report as a reusable template, browse templates with a preview, and create a new report from one — lighting up the currently-greyed Templates menu/tile/nav. **C:** Make the editor feel like a word processor — type immediately under the header without clicking "+ Text" — and add chain-of-custody metadata (case number, reference, classification, signature).

## Load-bearing decisions (settled with the operator)

- **A template is a saved report you clone.** No `{{placeholder}}` engine. `Use Template` deep-copies a template's content + assets into a fresh report.
- **Keep the block model + DOMPurify sanitizer + encrypted asset refs.** C adds an always-present focused text body and metadata fields; it does NOT rewrite the editor into a single flowing document.
- Encrypted secure-fs store (no SQLite), PDF/DOCX exporters, and the v3.49.1 light-Win98 skin all carry forward.

## Global Constraints (verbatim)

- Commit identity `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify`, no AI trailers. Explicit-path `git add`; never stage `pnpm-lock.yaml`, `resources/**`, `native/**`, `docs/superpowers/ideation/**`.
- No new dependencies. No new egress. Encrypt-at-rest preserved.
- The renderer `sanitizeReportHtml` stays the sole trust boundary before the exporters; every new field that is not sanitized-block-HTML is escaped in `report-html.ts`/`docx.ts`.
- New nested settings (if any) join `mergeSettings` + a test (the v3.24.0 dataloss landmine). *(This feature adds no new settings.)*
- Windows-only. Tests `pnpm exec vitest run`; typecheck `pnpm exec tsc --noEmit`.

---

## Sub-project B — Templates

### Data model (`src/shared/reports-types.ts`)

- New `ReportTemplate`:
  ```ts
  export interface ReportTemplate {
    id: string;
    name: string;
    category?: string;          // free text, optional (e.g. "Chain of Custody")
    createdAt: string;
    updatedAt: string;
    // A template carries the same body a report does, minus report identity/status:
    bannerRef?: string;
    fromContactId?: string;
    to: string;
    reportDate?: string;
    caseNumber?: string;        // (from sub-project C's metadata; present on both)
    referenceNumber?: string;
    classification?: string;
    signature?: string;
    blocks: ReportBlock[];
  }
  ```
- `ReportStoreData` gains `templates: ReportTemplate[]`.

### Store (`src/main/reports/store.ts`)

- `listTemplates()`, `saveTemplate(t)`, `removeTemplate(id)` mirroring the existing report/contact/descriptor CRUD + a `MAX_TEMPLATES` cap.
- **Asset independence:** templates own their own asset copies. Add `copyAsset(ref): Promise<string>` (reads bytes via `getAsset`, re-`putAsset`s, returns the new ref). Save-as-template copies the report's `bannerRef` + every image block `assetRef` through `copyAsset`; create-from-template copies the template's refs again. So deleting a report never breaks a template and vice-versa.

### IPC / preload / channels

- `reports.templates.{list, save, remove}` mirroring `reports.descriptors.*` (channels in `ipc-contracts.ts`, handlers in `register.ts`, preload in `index.ts` + `api.d.ts`). Asset copy happens renderer-side via the existing `getAsset`/`putAsset` IPC (no new asset IPC needed) OR a main-side `reports.copyAsset` helper — implementer picks the simpler wiring; both stay in the encrypted store.

### Validation (`src/main/security/validate.ts`)

- `ensureReportTemplate(raw)` — bounds `name`/`category`/`to`/metadata strings, routes `bannerRef` + image `assetRef`s through `ensureFileName`, reuses `ensureReportBlock` for blocks, clamps block count.

### Renderer

- **Save as Template:** File menu "Save as Template" + toolbar → prompt for a name (CaseDialogs, not `window.prompt` — Electron no-op) → deep-copy the open report's content + assets into a `ReportTemplate` → `templates.save`.
- **Templates nav branch:** add a `Templates [My Templates]` branch to `ReportsNavTree` (Shared Templates omitted — single-user; add later if needed). Selecting it shows the template list + preview.
- **Right Template Preview panel** (`ReportsModule` / a new `TemplatePreview.tsx`): a scaled, read-only preview of the selected template, rendered by reusing `buildReportHtml` inside a sandboxed `srcdoc` iframe (`sandbox=""`, no scripts) so the preview matches the exported PDF. "Select Template" button → create-from-template.
- **Use Template** tile + quick-action (currently greyed) → open the template picker/preview.
- **Create from template:** deep-copy the template content + assets → new `Report` (fresh id, `status:'draft'`, `author` from settings) → `reports.save` → open in the editor.
- Un-grey the Templates menu items (New from Template / Save as Template / My Templates) + the "Use Template" tile/quick-action, wired to the above.

---

## Sub-project C — Word-processor feel

### Always-present focused text body (`ReportEditor.tsx`)

- The editor always renders a text body directly under the header (Title / banner / From / To / Date / metadata). If `report.blocks` has no leading text block, the module seeds one empty text block so there is always somewhere to type. On editor mount, focus that first text block's `contentEditable` so opening/creating a report lets you type immediately — no "+ Text" click.
- "+ Text" still appends further blocks; "+ Photo" / "+ Table" append as today (insert-at-cursor is out of scope — append keeps the block/asset model simple). The toolbar stays.

### Metadata (`src/shared/reports-types.ts` `Report`)

- `Report` gains `caseNumber?: string`, `referenceNumber?: string`, `classification?: string`, `signature?: string` (all optional plain strings). `classification` is free text (a small preset datalist is fine, not required). `signature` is a printed signer-name/line (NOT a drawn-canvas signature — that's the invoice module's concern).
- Editor header: compact labelled inputs for Case #, Reference #, Classification, and a Signature line, alongside the existing Title/Date/From/To.
- Validator `ensureReport` bounds the four new strings.

### Exports (`report-html.ts`, `docx.ts`)

- Render the metadata (escaped) — Case # / Reference # / Classification near the header, a Signature line near the end. PDF via the existing embedded CSS; DOCX as escaped paragraphs. Templates' preview reuses `buildReportHtml`, so it shows metadata too.

---

## Testing

- **B:** template store CRUD + `copyAsset` independence (deleting the source report's asset leaves the template's copy intact); `ensureReportTemplate` validation; create-from-template produces a fresh id + copied refs; Template Preview renders via `buildReportHtml` in a sandboxed iframe; menu/tile/nav un-greyed and wired.
- **C:** editor seeds + focuses a text body when blocks are empty; metadata fields round-trip through `ensureReport`; metadata appears in `buildReportHtml` + DOCX (escaped).
- **CSS:** any new classes styled in the light-Win98 palette (computed-style guard); template preview + metadata fields.
- **Visual gate:** SSR-render the editor with metadata + a Template Preview panel → headless-Chrome screenshot before shipping (same harness as v3.49.x).
- **Packaged:** asar grep for the new template wiring + metadata (mind the un-minified `x: y` spacing).

## Out of scope

- Placeholder/variable templates; Shared Templates (single-user); a template thumbnail cache; insert-photo/table-at-cursor; drawn-canvas signatures; import/export of template files. All deferrable.
