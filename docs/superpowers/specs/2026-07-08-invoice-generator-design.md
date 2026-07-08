# Invoice Generator — Design

**Date:** 2026-07-08
**Origin:** GhostExodus request — a monthly invoicing tool for Ghost Intel 98 ("investigators may find this useful to calculate their invoice stuff and export it").
**Repo:** `/dcs98` (core, public MIT). A new free core module — `Invoices`.

## Goals

A self-contained, fully-offline invoice generator: enter a month's work as line items (date + time range → hours), apply a flat rate, get a live-computed total, attach sender/client identity + logos + a signature, and export to PDF. It remembers your details between invoices.

Operator decisions (2026-07-08):
- **Home:** a **free core feature** in the public app (not a plugin) — simplest to ship, no signing/distribution overhead.
- **Line items:** **multiple** rows per invoice (a month of work sessions on one invoice).
- **Persistence:** **persistent** — reusable sender/client profiles + logos, a list of past invoices to reopen/duplicate, auto-incrementing invoice number, encrypted at rest.
- **Money model:** **single flat rate** applied to total hours → subtotal, plus an **optional tax/VAT %** → total; a currency selector.

## Non-negotiable constraints (charter)

- **No network egress, no telemetry.** The module is entirely local: form input, local computation, encrypted local storage, and an offscreen PDF render. Nothing leaves the machine.
- **No new dependency.** PDF export reuses the app's existing offscreen `printToPDF` path (the dependency-free renderer already used for case/INTELREPORT exports). Currency formatting uses the platform `Intl.NumberFormat`. Time math is hand-rolled and pure.
- **Encrypt at rest.** Invoices, profiles, and image assets (logos, signature) persist through the vault's `secure-fs` under `dataRoot`, like every other store. Nothing is written in plaintext to disk.
- **Determinism.** All money/time arithmetic and the printable-HTML builder are pure and deterministic given their inputs — no `Date.now()` inside the calc/HTML units (timestamps are passed in).

## Data model (`src/shared/`)

```ts
interface InvoiceLine {
  id: string;
  date: string;        // ISO date, the day worked
  start: string;       // "HH:MM" 24h
  end: string;         // "HH:MM" 24h
  description: string;
  // hours are DERIVED (hoursBetween(start, end)); never stored — single source of truth
}

interface Party { name: string; company: string; logoRef?: string }  // logoRef → encrypted image asset

interface Signature { signerName?: string; signedDate?: string; signatureRef?: string }

interface Invoice {
  id: string;
  number: string;          // e.g. "0007"; auto-incremented on new, editable
  issueDate: string;       // ISO date
  currency: string;        // ISO 4217, e.g. "USD", "GBP"
  rate: number;            // flat rate per hour
  taxPct?: number;         // optional VAT/tax percentage
  sender: Party;
  client: Party;
  lines: InvoiceLine[];
  notes?: string;
  signature?: Signature;
  createdAt: string;
  updatedAt: string;
}

interface Profile { id: string; kind: 'sender' | 'client'; name: string; company: string; logoRef?: string }
```

Image assets (logos, signature PNG) are stored as encrypted blobs keyed by an opaque `ref`; `logoRef`/`signatureRef` hold that key.

## Form + live calc

A line-item table with add/remove rows. Each row: **date**, **start** and **end** time (`<input type="time">` — 12:00→15:30 yields **3.5 h**), **description**, and a live per-line amount (line hours × rate). Below the table: a **currency** selector, the flat **rate**, an optional **tax/VAT %**, and a totals block that recomputes live — **total hours**, **subtotal** (Σ line hours × rate), **tax** (subtotal × taxPct/100), **grand total**.

The arithmetic lives in a pure, unit-tested `calc.ts`:
- `hoursBetween(start: string, end: string): number` — decimal hours; returns 0 for an invalid or non-positive range (end ≤ start on the same day; overnight spans are out of scope — a work session doesn't cross midnight).
- `computeTotals(lines, rate, taxPct?): { totalHours, subtotal, tax, total }` — deterministic; tax omitted (0) when `taxPct` is absent.
- `formatMoney(amount: number, currency: string): string` — via `Intl.NumberFormat`; falls back to a plain fixed-2 string if the currency code is unrecognized.

## Identity, logos, signature

- **Sender** block (your name/company + **your logo**) and **client** block (their name/company + **their logo**) — two independent logo slots, uploaded as image files (PNG/JPG), stored encrypted, read back as data URLs for preview + export.
- **Profiles:** a saved sender/client profile pre-fills its block (set your company + logo once, reuse monthly). A "Save as profile" action captures the current block; a picker lists saved profiles.
- **Signature block** (optional — "if applicable"): a signer name + date, plus an optional signature image captured **either** by a small **draw-on-canvas pad** (`SignaturePad.tsx` → PNG data URL) **or** an uploaded image. Stored encrypted like logos.

Image size is bounded (reject oversize uploads rather than truncate) and content-type is validated to image/* at the IPC boundary.

## Export

A single **`invoice-html.ts`** `renderInvoiceHtml(invoice, assets): string` builds the printable invoice HTML — a header with both logos + sender/client, the line-item table, the totals block, notes, and the signature block. It is used for **both** the on-screen preview and the export, so preview == output. All images are embedded as data URLs (self-contained HTML). Export → **PDF** via the existing offscreen `printToPDF` main path, saved through the OS save dialog (symlink-target refusal, mirroring the media/playlist export). No new dependency, no egress.

## Persistence & IPC

`src/main/invoices/store.ts` mirrors the media/GeoINT store pattern:
- `list()`, `get(id)`, `save(invoice)`, `remove(id)`, `duplicate(id)` for invoices.
- `listProfiles()`, `saveProfile(p)`, `removeProfile(id)`.
- `putAsset(bytes, mime): ref`, `getAsset(ref): { mime, dataUrl }`, referenced by logos/signature.
- `nextInvoiceNumber(): string` — reads the current max and increments (zero-padded).

All persisted through `secure-fs` under `dataRoot/invoices/` (records) and `dataRoot/invoices/assets/` (encrypted image blobs). CRUD exposed over new `invoices:*` IPC channels; image bytes validated at the boundary. The renderer reaches everything via `window.api.invoices.*`.

## Module registration

Follows the standard core-module pattern: register in `register-builtins.tsx` (`registerModule({ key: 'invoices', title: 'Invoices', glyph, component, builtin: true, defaultWidth, defaultHeight })`) plus the store `ModuleKey`, `Icon.tsx` glyph, `Desktop.tsx` title, and `types.ts` shortcut entries. A hand-drawn Win98 invoice glyph.

## Decomposition

**Main:** `invoices/store.ts` (CRUD + assets + numbering), `invoices/export.ts` (HTML → offscreen PDF), IPC handlers in `register.ts`.
**Shared:** `Invoice`/`InvoiceLine`/`Party`/`Signature`/`Profile` types + `ipc-contracts` channels.
**Renderer:** `modules/invoices/InvoicesModule.tsx` (list + editor host), `InvoiceForm.tsx` (identity/rate/tax/currency + preview), `LineItemTable.tsx` (rows + per-line hours/amount), `SignaturePad.tsx` (canvas draw + upload), pure `calc.ts` and `invoice-html.ts`.

## Error handling

- Invalid time range (end ≤ start) → that line contributes 0 hours, flagged inline; export still works.
- Oversize/non-image upload → rejected with a clear notice, not stored.
- Unknown currency code → `formatMoney` falls back to a fixed-2 string (never throws).
- Missing sender/client fields → allowed (a draft); the PDF renders whatever is present.
- Corrupt/missing asset ref on read → the preview/PDF renders without that image (no crash).

## Testing

- `calc.ts` — `hoursBetween` across ranges (3.5 h for 12:00–15:30, 0 for equal/reversed, minute precision), `computeTotals` (subtotal, tax present/absent, empty lines), `formatMoney` (known + unknown currency).
- `invoice-html.ts` — deterministic HTML for a fixed invoice; totals + line rows present; images embedded as data URLs; no unescaped user text (HTML-escape sender/client/description/notes — untrusted-into-HTML fence, per the app's XSS-at-the-trust-boundary rule).
- Store — round-trip invoice/profile/asset through a mocked secure-fs; `nextInvoiceNumber` increments and zero-pads.
- IPC — the new `invoices:*` channels registered; image bytes validated at the boundary (reject non-image / oversize).

## Out of scope (YAGNI)

- Multi-currency conversion (one currency per invoice).
- Per-line rates (single flat rate was chosen).
- Recurring-invoice automation / scheduling.
- Emailing/sending invoices (export to PDF only — the user sends it themselves; no egress).
- Overnight time spans (a work session crossing midnight — split into two lines if ever needed).
- Invoice templates/theming beyond the one clean Win98-styled layout.
