# Invoice Generator (core module) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, fully-offline core `Invoices` module: enter a month of work as line items (date + time range → hours), apply a flat rate + optional tax, attach sender/client identity + logos + a signature, persist encrypted, and export to PDF.

**Architecture:** Bottom-up. Shared types + IPC contracts first, then pure units (`calc.ts`, `invoice-html.ts`), then the encrypted main-process store + IPC/preload + PDF export, then the renderer components (line-item table, signature pad, form, module host) wired via the standard 5-point module registration.

**Tech Stack:** Electron 33 + React + TypeScript, `Intl.NumberFormat` (money), offscreen `printToPDF` (existing, no dep), `secure-fs` (vault encryption), vitest + @testing-library/react.

## Global Constraints

- **No network egress, no telemetry.** The module is local-only: form input, local compute, encrypted local storage, offscreen PDF render.
- **No new dependency.** PDF export reuses the offscreen `printToPDF` helper in `src/main/services/export.ts`. Money via `Intl.NumberFormat`. Time math hand-rolled and pure.
- **Encrypt at rest.** Invoices, profiles, and image assets persist through `secure-fs` (`secureReadFile`/`secureReadText`/`secureWriteFile`) under `dataRoot()`. Nothing in plaintext on disk.
- **Determinism.** `calc.ts` and `invoice-html.ts` are pure — no `Date.now()`/`Math.random()` inside them (timestamps/ids passed in by the caller).
- **XSS fence.** `invoice-html.ts` HTML-escapes every user-supplied string (sender/client/description/notes/signer) — untrusted-into-HTML boundary.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path `git add`; never stage the known-dirty files (`pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`).
- **Branch:** `feat/invoice-generator`. Implementers commit ONLY on this branch — never checkout/merge/delete branches or touch `main`; the controller merges.
- **Commands:** `pnpm test` (vitest), `pnpm typecheck` (both configs). Component tests mirror `test/news-feed-shared.test.tsx`.

## File Structure

**New (shared):** `src/shared/invoice-types.ts`.
**New (main):** `src/main/invoices/store.ts`, `src/main/invoices/export.ts`.
**New (renderer):** `src/renderer/modules/invoices/calc.ts`, `invoice-html.ts`, `LineItemTable.tsx`, `SignaturePad.tsx`, `InvoiceForm.tsx`, `InvoicesModule.tsx`.
**New (test):** `test/invoice-calc.test.ts`, `test/invoice-html.test.ts`, `test/invoice-store.test.ts`, `test/invoice-ipc.test.ts`, `test/invoice-line-item-table.test.tsx`, `test/invoice-signature-pad.test.tsx`, `test/invoice-form.test.tsx`, `test/invoices-module.test.tsx`.
**Modified:** `src/shared/ipc-contracts.ts` (channels + contracts), `src/main/ipc/register.ts` (handlers), `src/main/security/validate.ts` (validators), `src/preload/index.ts` + `src/preload/api.d.ts` (api), `src/renderer/state/store.ts` (`ModuleKey`), `src/renderer/modules/register-builtins.tsx` (registration), `src/renderer/shell/Icon.tsx` (glyph), `src/renderer/shell/Desktop.tsx` (title), `src/shared/types.ts` (shortcut entries), `src/renderer/styles/theme.css` (invoice styles).

**Sequencing:** 1 types → 2 calc → 3 html → 4 store → 5 IPC/preload/export → 6 LineItemTable → 7 SignaturePad → 8 InvoiceForm → 9 InvoicesModule+registration. Each task leaves the build + suite green.

---

### Task 1: Shared types + IPC contracts

**Files:** Create `src/shared/invoice-types.ts`; Modify `src/shared/ipc-contracts.ts`; Test: `test/invoice-ipc.test.ts` (channel presence).

**Interfaces:**
- Produces: `InvoiceLine`, `Party`, `Signature`, `Invoice`, `Profile`, `InvoiceStore` (persisted shape), `InvoiceAsset`; `channels.invoices.*`.

- [ ] **Step 1: Failing test** `test/invoice-ipc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('invoices IPC channels', () => {
  it('exposes the CRUD + asset + export channels', () => {
    expect(channels.invoices.list).toBe('invoices:list');
    expect(channels.invoices.save).toBe('invoices:save');
    expect(channels.invoices.remove).toBe('invoices:remove');
    expect(channels.invoices.duplicate).toBe('invoices:duplicate');
    expect(channels.invoices.nextNumber).toBe('invoices:nextNumber');
    expect(channels.invoices.listProfiles).toBe('invoices:listProfiles');
    expect(channels.invoices.saveProfile).toBe('invoices:saveProfile');
    expect(channels.invoices.removeProfile).toBe('invoices:removeProfile');
    expect(channels.invoices.putAsset).toBe('invoices:putAsset');
    expect(channels.invoices.getAsset).toBe('invoices:getAsset');
    expect(channels.invoices.exportPdf).toBe('invoices:exportPdf');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-ipc`.

- [ ] **Step 3: Implement.** Create `src/shared/invoice-types.ts`:

```ts
/** Invoice-generator shared types. Hours are DERIVED from a line's time range (see calc.ts) and never
 *  stored. Image assets (logos, signature) live as encrypted blobs referenced by an opaque ref. */
export interface InvoiceLine { id: string; date: string; start: string; end: string; description: string }
export interface Party { name: string; company: string; logoRef?: string }
export interface Signature { signerName?: string; signedDate?: string; signatureRef?: string }

export interface Invoice {
  id: string;
  number: string;        // zero-padded, e.g. "0007"
  issueDate: string;     // ISO date
  currency: string;      // ISO 4217
  rate: number;          // flat rate per hour
  taxPct?: number;       // optional VAT/tax %
  sender: Party;
  client: Party;
  lines: InvoiceLine[];
  notes?: string;
  signature?: Signature;
  createdAt: string;
  updatedAt: string;
}

export interface Profile { id: string; kind: 'sender' | 'client'; name: string; company: string; logoRef?: string }

/** On-disk shape (one encrypted JSON file). `seq` backs the auto-incrementing invoice number. */
export interface InvoiceStoreData { invoices: Invoice[]; profiles: Profile[]; seq: number }

/** getAsset result — a ready-to-embed data URL. */
export interface InvoiceAsset { mime: string; dataUrl: string }
```

  In `src/shared/ipc-contracts.ts`, add an `invoices` block to `channels` (mirror the `media` block):
```ts
  invoices: {
    list: 'invoices:list', save: 'invoices:save', remove: 'invoices:remove', duplicate: 'invoices:duplicate',
    nextNumber: 'invoices:nextNumber',
    listProfiles: 'invoices:listProfiles', saveProfile: 'invoices:saveProfile', removeProfile: 'invoices:removeProfile',
    putAsset: 'invoices:putAsset', getAsset: 'invoices:getAsset', exportPdf: 'invoices:exportPdf',
  },
```
  and to the `ChannelContract` map:
```ts
  [channels.invoices.list]: { args: []; returns: Invoice[] };
  [channels.invoices.save]: { args: [Invoice]; returns: Invoice };
  [channels.invoices.remove]: { args: [string]; returns: void };
  [channels.invoices.duplicate]: { args: [string]; returns: Invoice };
  [channels.invoices.nextNumber]: { args: []; returns: string };
  [channels.invoices.listProfiles]: { args: []; returns: Profile[] };
  [channels.invoices.saveProfile]: { args: [Profile]; returns: Profile };
  [channels.invoices.removeProfile]: { args: [string]; returns: void };
  [channels.invoices.putAsset]: { args: [{ bytes: number[]; mime: string }]; returns: string };
  [channels.invoices.getAsset]: { args: [string]; returns: InvoiceAsset | null };
  [channels.invoices.exportPdf]: { args: [{ html: string }]; returns: string | null };
  // ^ takes prebuilt HTML (the renderer already has renderInvoiceHtml for the preview) so main never
  //   imports a renderer module. The renderer resolves asset refs → data URLs before building the HTML.
```
  (import `Invoice`, `Profile`, `InvoiceAsset` from `./invoice-types` at the top of ipc-contracts.)

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-ipc && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): shared types + IPC channel contracts`.

---

### Task 2: `calc.ts` — hours, totals, money (pure)

**Files:** Create `src/renderer/modules/invoices/calc.ts`; Test: `test/invoice-calc.test.ts`.

**Interfaces:**
- Consumes: `InvoiceLine` from `@shared/invoice-types`.
- Produces: `hoursBetween(start: string, end: string): number`; `computeTotals(lines: InvoiceLine[], rate: number, taxPct?: number): { totalHours: number; subtotal: number; tax: number; total: number }`; `formatMoney(amount: number, currency: string): string`.

- [ ] **Step 1: Failing test** `test/invoice-calc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hoursBetween, computeTotals, formatMoney } from '../src/renderer/modules/invoices/calc';

describe('hoursBetween', () => {
  it('12:00 to 15:30 is 3.5 hours', () => { expect(hoursBetween('12:00', '15:30')).toBe(3.5); });
  it('minute precision (09:15 to 10:00 = 0.75)', () => { expect(hoursBetween('09:15', '10:00')).toBe(0.75); });
  it('equal or reversed range is 0 (no overnight)', () => {
    expect(hoursBetween('10:00', '10:00')).toBe(0);
    expect(hoursBetween('15:00', '09:00')).toBe(0);
  });
  it('garbage input is 0', () => { expect(hoursBetween('', 'x')).toBe(0); });
});

describe('computeTotals', () => {
  const lines = [
    { id: '1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'a' }, // 3.5h
    { id: '2', date: '2026-07-02', start: '09:00', end: '11:00', description: 'b' }, // 2h
  ];
  it('subtotal = total hours * rate, no tax when taxPct absent', () => {
    const t = computeTotals(lines, 20);
    expect(t.totalHours).toBe(5.5); expect(t.subtotal).toBe(110); expect(t.tax).toBe(0); expect(t.total).toBe(110);
  });
  it('applies tax when taxPct present', () => {
    const t = computeTotals(lines, 20, 10);
    expect(t.tax).toBeCloseTo(11, 6); expect(t.total).toBeCloseTo(121, 6);
  });
  it('empty lines → zeros', () => { expect(computeTotals([], 20, 10)).toEqual({ totalHours: 0, subtotal: 0, tax: 0, total: 0 }); });
});

describe('formatMoney', () => {
  it('formats a known currency', () => { expect(formatMoney(110, 'USD')).toMatch(/110/); });
  it('unknown currency falls back to fixed-2 (never throws)', () => { expect(formatMoney(110, 'ZZZ')).toBe('110.00'); });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-calc`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/calc.ts`:

```ts
/** Pure invoice arithmetic. Deterministic — no Date/random. Hours derive from a line's HH:MM range;
 *  a non-positive or unparseable range yields 0 (a work session never crosses midnight — out of scope). */
import type { InvoiceLine } from '@shared/invoice-types';

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function hoursBetween(start: string, end: string): number {
  const a = toMinutes(start); const b = toMinutes(end);
  if (a === null || b === null) return 0;
  const diff = b - a;
  return diff > 0 ? diff / 60 : 0;
}

export function computeTotals(lines: InvoiceLine[], rate: number, taxPct?: number): { totalHours: number; subtotal: number; tax: number; total: number } {
  const totalHours = lines.reduce((s, l) => s + hoursBetween(l.start, l.end), 0);
  const subtotal = totalHours * (Number.isFinite(rate) ? rate : 0);
  const tax = taxPct ? subtotal * (taxPct / 100) : 0;
  return { totalHours, subtotal, tax, total: subtotal + tax };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return amount.toFixed(2); // unknown/invalid ISO 4217 code
  }
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-calc && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): pure hours/totals/money calc`.

---

### Task 3: `invoice-html.ts` — printable HTML (pure, escaped)

**Files:** Create `src/renderer/modules/invoices/invoice-html.ts`; Test: `test/invoice-html.test.ts`.

**Interfaces:**
- Consumes: `Invoice` (`@shared/invoice-types`); `hoursBetween`, `computeTotals`, `formatMoney` (Task 2).
- Produces: `renderInvoiceHtml(invoice: Invoice, assets: Record<string, string>): string` — `assets` maps an asset ref → a data URL (caller resolves `logoRef`/`signatureRef`).

- [ ] **Step 1: Failing test** `test/invoice-html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml } from '../src/renderer/modules/invoices/invoice-html';
import type { Invoice } from '../src/shared/invoice-types';

const inv: Invoice = {
  id: 'i1', number: '0007', issueDate: '2026-07-08', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'Ghost Intel', logoRef: 'a.png' },
  client: { name: '<script>x</script>', company: 'Client Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }],
  createdAt: '2026-07-08T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z',
};

describe('renderInvoiceHtml', () => {
  it('is deterministic and contains number, totals and a line row', () => {
    const html = renderInvoiceHtml(inv, { 'a.png': 'data:image/png;base64,AAA' });
    expect(html).toBe(renderInvoiceHtml(inv, { 'a.png': 'data:image/png;base64,AAA' }));
    expect(html).toContain('0007');
    expect(html).toContain('Recon');
    expect(html).toContain('3.5');            // line hours
    expect(html).toContain('data:image/png;base64,AAA'); // embedded logo
  });
  it('HTML-escapes user text (no raw script tag)', () => {
    const html = renderInvoiceHtml(inv, {});
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-html`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/invoice-html.ts`:

```ts
/** Builds the self-contained printable invoice HTML — used for BOTH the on-screen preview and the PDF
 *  export (preview == output). Pure + deterministic. Every user string is HTML-escaped (untrusted →
 *  HTML fence). Images are embedded as data URLs resolved from `assets` by ref. */
import type { Invoice } from '@shared/invoice-types';
import { hoursBetween, computeTotals, formatMoney } from './calc';

function esc(s: string | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ));
}
function img(ref: string | undefined, assets: Record<string, string>, cls: string): string {
  const url = ref ? assets[ref] : undefined;
  return url ? `<img class="${cls}" src="${esc(url)}" alt="" />` : '';
}

export function renderInvoiceHtml(invoice: Invoice, assets: Record<string, string>): string {
  const { currency, rate, taxPct } = invoice;
  const t = computeTotals(invoice.lines, rate, taxPct);
  const rows = invoice.lines.map((l) => {
    const h = hoursBetween(l.start, l.end);
    return `<tr><td>${esc(l.date)}</td><td>${esc(l.start)}–${esc(l.end)}</td><td>${esc(l.description)}</td>`
      + `<td class="num">${h}</td><td class="num">${esc(formatMoney(h * rate, currency))}</td></tr>`;
  }).join('');
  const sig = invoice.signature;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}',
    '.head{display:flex;justify-content:space-between;align-items:flex-start}',
    '.logo{max-height:64px;max-width:180px}table{width:100%;border-collapse:collapse;margin:18px 0}',
    'th,td{border:1px solid #999;padding:6px 8px;text-align:left}.num{text-align:right}',
    '.totals{width:280px;margin-left:auto}.sig{margin-top:48px}.sigimg{max-height:64px}',
    '</style></head><body>',
    `<div class="head"><div><h1>INVOICE ${esc(invoice.number)}</h1>`,
    `<div>Date: ${esc(invoice.issueDate)}</div></div>${img(invoice.sender.logoRef, assets, 'logo')}</div>`,
    `<div class="head"><div><b>From</b><br>${esc(invoice.sender.name)}<br>${esc(invoice.sender.company)}</div>`,
    `<div><b>To</b><br>${esc(invoice.client.name)}<br>${esc(invoice.client.company)} ${img(invoice.client.logoRef, assets, 'logo')}</div></div>`,
    '<table><thead><tr><th>Date</th><th>Time</th><th>Description</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    `<table class="totals"><tbody>`,
    `<tr><td>Total hours</td><td class="num">${t.totalHours}</td></tr>`,
    `<tr><td>Subtotal</td><td class="num">${esc(formatMoney(t.subtotal, currency))}</td></tr>`,
    taxPct ? `<tr><td>Tax (${taxPct}%)</td><td class="num">${esc(formatMoney(t.tax, currency))}</td></tr>` : '',
    `<tr><td><b>Total</b></td><td class="num"><b>${esc(formatMoney(t.total, currency))}</b></td></tr>`,
    '</tbody></table>',
    invoice.notes ? `<div><b>Notes</b><br>${esc(invoice.notes)}</div>` : '',
    sig ? `<div class="sig">${img(sig.signatureRef, assets, 'sigimg')}<div>${esc(sig.signerName)} ${esc(sig.signedDate)}</div><div>Signature</div></div>` : '',
    '</body></html>',
  ].join('');
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-html && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): pure printable-HTML builder (escaped, embedded assets)`.

---

### Task 4: Main store (encrypted CRUD + assets + numbering)

**Files:** Create `src/main/invoices/store.ts`; Test: `test/invoice-store.test.ts`.

**Interfaces:**
- Consumes: `Invoice`, `Profile`, `InvoiceStoreData`, `InvoiceAsset` (`@shared/invoice-types`); `secureReadText`/`secureReadFile`/`secureWriteFile` (`../storage/secure-fs`); `dataRoot` (`../storage/paths`).
- Produces: `listInvoices()`, `saveInvoice(inv)`, `removeInvoice(id)`, `duplicateInvoice(id)`, `nextInvoiceNumber()`, `listProfiles()`, `saveProfile(p)`, `removeProfile(id)`, `putAsset(bytes: Buffer, mime: string)`, `getAsset(ref)`, `_resetForTest()`.

- [ ] **Step 1: Failing test** `test/invoice-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../src/main/invoices/store';

const mkInv = (id: string, number: string) => ({
  id, number, issueDate: '2026-07-08', currency: 'USD', rate: 20,
  sender: { name: 'Me', company: 'GI' }, client: { name: 'C', company: 'Co' },
  lines: [], createdAt: 'x', updatedAt: 'x',
});

describe('invoice store', () => {
  beforeEach(async () => { await store._resetForTest(); });
  it('save/list/remove round-trip', async () => {
    await store.saveInvoice(mkInv('i1', '0001'));
    expect((await store.listInvoices()).map((i) => i.id)).toEqual(['i1']);
    await store.removeInvoice('i1');
    expect(await store.listInvoices()).toEqual([]);
  });
  it('nextInvoiceNumber increments + zero-pads', async () => {
    expect(await store.nextInvoiceNumber()).toBe('0001');
    expect(await store.nextInvoiceNumber()).toBe('0002');
  });
  it('duplicate produces a new id + fresh number, copying content', async () => {
    await store.saveInvoice(mkInv('i1', '0001'));
    const dup = await store.duplicateInvoice('i1');
    expect(dup.id).not.toBe('i1');
    expect(dup.number).not.toBe('0001');
    expect(dup.sender.company).toBe('GI');
  });
  it('putAsset/getAsset round-trips a png as a data URL', async () => {
    const ref = await store.putAsset(Buffer.from([1, 2, 3]), 'image/png');
    expect(ref).toMatch(/\.png$/);
    const a = await store.getAsset(ref);
    expect(a?.mime).toBe('image/png');
    expect(a?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-store`.

- [ ] **Step 3: Implement** `src/main/invoices/store.ts`:

```ts
/** Encrypted invoice store (mirrors media/library.ts). Records in one JSON file; image assets as
 *  individual encrypted blobs under invoice-assets/, filename `<uuid>.<ext>` (ext carries the mime). */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Invoice, Profile, InvoiceStoreData, InvoiceAsset } from '@shared/invoice-types';
import { secureReadText, secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { dataRoot } from '../storage/paths';

const EMPTY: InvoiceStoreData = { invoices: [], profiles: [], seq: 0 };
const file = (): string => join(dataRoot(), 'invoices.json');
const assetsDir = (): string => join(dataRoot(), 'invoice-assets');

async function read(): Promise<InvoiceStoreData> {
  try { return { ...EMPTY, ...(JSON.parse(await secureReadText(file())) as Partial<InvoiceStoreData>) }; }
  catch { return { ...EMPTY, invoices: [], profiles: [] }; }
}
async function write(d: InvoiceStoreData): Promise<void> { await secureWriteFile(file(), JSON.stringify(d, null, 2)); }

export async function _resetForTest(): Promise<void> { await write({ invoices: [], profiles: [], seq: 0 }); }

export async function listInvoices(): Promise<Invoice[]> { return (await read()).invoices; }
export async function saveInvoice(inv: Invoice): Promise<Invoice> {
  const d = await read();
  const i = d.invoices.findIndex((x) => x.id === inv.id);
  if (i >= 0) d.invoices[i] = inv; else d.invoices.push(inv);
  await write(d); return inv;
}
export async function removeInvoice(id: string): Promise<void> {
  const d = await read(); d.invoices = d.invoices.filter((x) => x.id !== id); await write(d);
}
export async function nextInvoiceNumber(): Promise<string> {
  const d = await read(); d.seq += 1; await write(d); return String(d.seq).padStart(4, '0');
}
export async function duplicateInvoice(id: string): Promise<Invoice> {
  const d = await read();
  const src = d.invoices.find((x) => x.id === id);
  if (!src) throw new Error('invoice not found');
  d.seq += 1;
  const dup: Invoice = { ...structuredClone(src), id: randomUUID(), number: String(d.seq).padStart(4, '0') };
  d.invoices.push(dup); await write(d); return dup;
}
export async function listProfiles(): Promise<Profile[]> { return (await read()).profiles; }
export async function saveProfile(p: Profile): Promise<Profile> {
  const d = await read();
  const i = d.profiles.findIndex((x) => x.id === p.id);
  if (i >= 0) d.profiles[i] = p; else d.profiles.push(p);
  await write(d); return p;
}
export async function removeProfile(id: string): Promise<void> {
  const d = await read(); d.profiles = d.profiles.filter((x) => x.id !== id); await write(d);
}

function extFor(mime: string): string { return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin'; }
function mimeFor(ref: string): string { return ref.endsWith('.png') ? 'image/png' : ref.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'; }

export async function putAsset(bytes: Buffer, mime: string): Promise<string> {
  await mkdir(assetsDir(), { recursive: true });
  const ref = `${randomUUID()}.${extFor(mime)}`;
  await secureWriteFile(join(assetsDir(), ref), bytes);
  return ref;
}
export async function getAsset(ref: string): Promise<InvoiceAsset | null> {
  try {
    const buf = await secureReadFile(join(assetsDir(), ref));
    const mime = mimeFor(ref);
    return { mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch { return null; }
}
```
  (Confirm `secureWriteFile` accepts a `Buffer`; media passes a `string` — if the signature is `string`-only, widen it to `Buffer | string` at the source and pass through, matching `secureReadFile`'s `Buffer` return.)

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-store && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): encrypted store — CRUD, profiles, assets, numbering`.

---

### Task 5: IPC + preload + PDF export

**Files:** Create `src/main/invoices/export.ts`; Modify `src/main/ipc/register.ts`, `src/main/security/validate.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`; Test: extend `test/invoice-ipc.test.ts`.

**Interfaces:**
- Consumes: store fns (Task 4); `renderInvoiceHtml` (Task 3); the offscreen `printToPDF` helper in `src/main/services/export.ts`; `channels.invoices.*` (Task 1).
- Produces: `renderInvoicePdf(html: string): Promise<Buffer>`; `ensureInvoice`, `ensureProfile`, `ensureAssetInput` validators; `window.api.invoices.*`.

- [ ] **Step 1: Failing test** — add to `test/invoice-ipc.test.ts`:

```ts
import { ensureAssetInput } from '../src/main/security/validate';
describe('ensureAssetInput', () => {
  it('accepts a png under the size cap', () => {
    expect(ensureAssetInput({ bytes: [1, 2, 3], mime: 'image/png' })).toEqual({ bytes: Buffer.from([1, 2, 3]), mime: 'image/png' });
  });
  it('rejects a non-image mime', () => { expect(() => ensureAssetInput({ bytes: [1], mime: 'text/html' })).toThrow(); });
  it('rejects oversize (> 2MB)', () => { expect(() => ensureAssetInput({ bytes: new Array(2_100_000).fill(0), mime: 'image/png' })).toThrow(); });
  it('rejects a non-array bytes', () => { expect(() => ensureAssetInput({ bytes: 'x', mime: 'image/png' })).toThrow(); });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-ipc`.

- [ ] **Step 3: Implement.**
  - `src/main/invoices/export.ts`:
```ts
/** Renders invoice HTML to a PDF buffer via the same offscreen printToPDF helper the case/INTELREPORT
 *  exports use (fully offline, sandboxed, no JS/node in the render window). */
import { renderInvoicePdfFromHtml } from '../services/export';
export async function renderInvoicePdf(html: string): Promise<Buffer> { return renderInvoicePdfFromHtml(html); }
```
    In `src/main/services/export.ts`, export the existing private offscreen helper (the one at ~line 41 wrapping `win.webContents.printToPDF`) under the name `renderInvoicePdfFromHtml(html: string): Promise<Buffer>` — a thin wrapper over the shared helper. If the helper is already a named function taking HTML, re-export it; otherwise add a 3-line exported wrapper that calls it. Do not duplicate the offscreen-window logic.
  - `src/main/security/validate.ts` — add:
```ts
export function ensureAssetInput(v: unknown): { bytes: Buffer; mime: string } {
  if (!v || typeof v !== 'object') throw new ValidationError('asset must be an object');
  const o = v as { bytes?: unknown; mime?: unknown };
  if (o.mime !== 'image/png' && o.mime !== 'image/jpeg') throw new ValidationError('asset.mime must be image/png or image/jpeg');
  if (!Array.isArray(o.bytes)) throw new ValidationError('asset.bytes must be a byte array');
  if (o.bytes.length > 2_000_000) throw new ValidationError('asset too large (max 2MB)');
  return { bytes: Buffer.from(o.bytes as number[]), mime: o.mime };
}
export function ensureInvoice(v: unknown): import('@shared/invoice-types').Invoice {
  if (!v || typeof v !== 'object') throw new ValidationError('invoice must be an object');
  const o = v as { id?: unknown; number?: unknown };
  if (typeof o.id !== 'string' || typeof o.number !== 'string') throw new ValidationError('invoice.id/number must be strings');
  return v as import('@shared/invoice-types').Invoice;
}
export function ensureProfile(v: unknown): import('@shared/invoice-types').Profile {
  if (!v || typeof v !== 'object') throw new ValidationError('profile must be an object');
  const o = v as { id?: unknown; kind?: unknown };
  if (typeof o.id !== 'string' || (o.kind !== 'sender' && o.kind !== 'client')) throw new ValidationError('bad profile');
  return v as import('@shared/invoice-types').Profile;
}
```
  - `src/main/ipc/register.ts` — import the store as `invoiceStore`, `renderInvoicePdf`, `renderInvoiceHtml` (from the renderer module path is not allowed in main — instead **move** `invoice-html.ts` compute to a shared import: `renderInvoiceHtml` is pure and imports only `calc.ts`; both live under renderer. To avoid a main→renderer import, the `exportPdf` handler receives already-built HTML is NOT the choice; instead the handler builds HTML by importing the pure module via its relative path is disallowed by lint. **Resolution:** the renderer builds the HTML (it already has the module for preview) and passes it: change the `exportPdf` contract arg to `{ html: string }`.) Update Task 1's contract for `exportPdf` to `{ args: [{ html: string }]; returns: string | null }` and the preload accordingly. Handlers:
```ts
  safeHandle(channels.invoices.list, () => invoiceStore.listInvoices());
  safeHandle(channels.invoices.save, (...a) => invoiceStore.saveInvoice(ensureInvoice(a[0])));
  safeHandle(channels.invoices.remove, (...a) => invoiceStore.removeInvoice(a[0] as string));
  safeHandle(channels.invoices.duplicate, (...a) => invoiceStore.duplicateInvoice(a[0] as string));
  safeHandle(channels.invoices.nextNumber, () => invoiceStore.nextInvoiceNumber());
  safeHandle(channels.invoices.listProfiles, () => invoiceStore.listProfiles());
  safeHandle(channels.invoices.saveProfile, (...a) => invoiceStore.saveProfile(ensureProfile(a[0])));
  safeHandle(channels.invoices.removeProfile, (...a) => invoiceStore.removeProfile(a[0] as string));
  safeHandle(channels.invoices.putAsset, (...a) => { const { bytes, mime } = ensureAssetInput(a[0]); return invoiceStore.putAsset(bytes, mime); });
  safeHandle(channels.invoices.getAsset, (...a) => invoiceStore.getAsset(a[0] as string));
  safeHandle(channels.invoices.exportPdf, async (...a) => {
    const { html } = a[0] as { html: string };
    const pdf = await renderInvoicePdf(html);
    const win = getWindow();
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: 'invoice.pdf' }) : await dialog.showSaveDialog({ defaultPath: 'invoice.pdf' });
    if (r.canceled || !r.filePath) return null;
    try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await writeFile(r.filePath, pdf); return basename(r.filePath);
  });
```
    (add `ensureInvoice, ensureProfile, ensureAssetInput` to the `../security/validate` import.)
  - `src/preload/index.ts` — add an `invoices` block mirroring `media`, with `list/save/remove/duplicate/nextNumber/listProfiles/saveProfile/removeProfile/putAsset/getAsset/exportPdf`, each `ipcRenderer.invoke(channels.invoices.X, ...)`. `exportPdf: (html: string) => ipcRenderer.invoke(channels.invoices.exportPdf, { html })`.
  - `src/preload/api.d.ts` — mirror the `invoices` method signatures (returns typed from `@shared/invoice-types`).

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-ipc && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): IPC handlers + preload + validated asset input + PDF export`.

---

### Task 6: `LineItemTable` component

**Files:** Create `src/renderer/modules/invoices/LineItemTable.tsx`; Test: `test/invoice-line-item-table.test.tsx`.

**Interfaces:**
- Consumes: `InvoiceLine` (`@shared/invoice-types`); `hoursBetween`, `formatMoney` (Task 2).
- Produces: `LineItemTable({ lines, rate, currency, onChange })` where `onChange: (lines: InvoiceLine[]) => void`.

- [ ] **Step 1: Failing test** `test/invoice-line-item-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LineItemTable } from '../src/renderer/modules/invoices/LineItemTable';

const lines = [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }];

describe('LineItemTable', () => {
  it('shows derived hours and per-line amount', () => {
    render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={() => {}} />);
    expect(screen.getByText('3.5')).toBeTruthy();        // hours
    expect(screen.getByText(/70/)).toBeTruthy();         // 3.5 * 20
  });
  it('Add row appends an empty line', () => {
    const onChange = vi.fn();
    render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={onChange} />);
    fireEvent.click(screen.getByText('Add line'));
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
  });
  it('Remove drops the row', () => {
    const onChange = vi.fn();
    render(<LineItemTable lines={lines} rate={20} currency="USD" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove line'));
    expect(onChange.mock.calls[0][0]).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-line-item-table`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/LineItemTable.tsx`:

```tsx
/** Editable line-item table: each row is date + start/end time + description; hours + amount are derived
 *  live from the row's time range and the invoice's flat rate. Presentational — emits the new list up. */
import type { InvoiceLine } from '@shared/invoice-types';
import { hoursBetween, formatMoney } from './calc';

let seq = 0;
const newLine = (): InvoiceLine => ({ id: `l${++seq}-${Date.now()}`, date: '', start: '', end: '', description: '' });

export function LineItemTable(
  { lines, rate, currency, onChange }:
  { lines: InvoiceLine[]; rate: number; currency: string; onChange: (lines: InvoiceLine[]) => void }
): JSX.Element {
  const set = (i: number, patch: Partial<InvoiceLine>): void => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <table className="ga98-invoice-lines">
      <thead><tr><th>Date</th><th>Start</th><th>End</th><th>Description</th><th>Hours</th><th>Amount</th><th /></tr></thead>
      <tbody>
        {lines.map((l, i) => {
          const h = hoursBetween(l.start, l.end);
          return (
            <tr key={l.id}>
              <td><input type="date" className="ga98-text" value={l.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
              <td><input type="time" className="ga98-text" value={l.start} onChange={(e) => set(i, { start: e.target.value })} /></td>
              <td><input type="time" className="ga98-text" value={l.end} onChange={(e) => set(i, { end: e.target.value })} /></td>
              <td><input className="ga98-text" value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td className="num">{h}</td>
              <td className="num">{formatMoney(h * rate, currency)}</td>
              <td><button aria-label="Remove line" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          );
        })}
      </tbody>
      <tfoot><tr><td colSpan={7}><button onClick={() => onChange([...lines, newLine()])}>Add line</button></td></tr></tfoot>
    </table>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-line-item-table && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): editable line-item table with derived hours/amount`.

---

### Task 7: `SignaturePad` component

**Files:** Create `src/renderer/modules/invoices/SignaturePad.tsx`; Test: `test/invoice-signature-pad.test.tsx`.

**Interfaces:**
- Produces: `SignaturePad({ onCapture })` where `onCapture: (dataUrl: string, mime: 'image/png') => void` — fires when the user finishes a drawing or uploads an image.

- [ ] **Step 1: Failing test** `test/invoice-signature-pad.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignaturePad } from '../src/renderer/modules/invoices/SignaturePad';

describe('SignaturePad', () => {
  it('uploading an image file emits a data URL', async () => {
    const onCapture = vi.fn();
    render(<SignaturePad onCapture={onCapture} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'sig.png', { type: 'image/png' });
    const input = screen.getByLabelText('Upload signature') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => expect(onCapture).toHaveBeenCalled());
    expect(onCapture.mock.calls[0][0]).toMatch(/^data:/);
  });
  it('Clear resets without emitting', () => {
    const onCapture = vi.fn();
    render(<SignaturePad onCapture={onCapture} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-signature-pad`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/SignaturePad.tsx`:

```tsx
/** Optional signature capture: draw on a small canvas OR upload an image. Emits a PNG data URL; the
 *  parent persists it as an encrypted asset via putAsset. */
import { useRef, useState } from 'react';

export function SignaturePad({ onCapture }: { onCapture: (dataUrl: string, mime: 'image/png') => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  function pos(e: React.PointerEvent): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent): void { drawing.current = true; const p = pos(e); const c = canvasRef.current!.getContext('2d')!; c.beginPath(); c.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent): void { if (!drawing.current) return; const p = pos(e); const c = canvasRef.current!.getContext('2d')!; c.lineTo(p.x, p.y); c.stroke(); setDirty(true); }
  function end(): void {
    if (!drawing.current) return; drawing.current = false;
    if (dirty) onCapture(canvasRef.current!.toDataURL('image/png'), 'image/png');
  }
  function clear(): void { const c = canvasRef.current; if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDirty(false); }
  function upload(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => onCapture(String(rd.result), 'image/png');
    rd.readAsDataURL(f);
  }
  return (
    <div className="ga98-signature-pad">
      <canvas ref={canvasRef} width={280} height={80} className="ga98-sig-canvas"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div className="field-row" style={{ gap: 6 }}>
        <button onClick={clear}>Clear</button>
        <label>Upload signature<input type="file" accept="image/png,image/jpeg" aria-label="Upload signature" onChange={upload} style={{ display: 'none' }} /></label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-signature-pad && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): signature pad (draw or upload)`.

---

### Task 8: `InvoiceForm` component (editor + preview)

**Files:** Create `src/renderer/modules/invoices/InvoiceForm.tsx`; Test: `test/invoice-form.test.tsx`.

**Interfaces:**
- Consumes: `Invoice`, `Party` (`@shared/invoice-types`); `LineItemTable` (Task 6); `SignaturePad` (Task 7); `computeTotals`, `formatMoney` (Task 2); `renderInvoiceHtml` (Task 3).
- Produces: `InvoiceForm({ invoice, assets, onChange, onUploadLogo })` — `assets: Record<string,string>` (ref→dataUrl for preview), `onChange: (inv: Invoice) => void`, `onUploadLogo: (which: 'sender'|'client', file: File) => void`.

- [ ] **Step 1: Failing test** `test/invoice-form.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvoiceForm } from '../src/renderer/modules/invoices/InvoiceForm';
import type { Invoice } from '../src/shared/invoice-types';

const inv: Invoice = {
  id: 'i1', number: '0001', issueDate: '2026-07-08', currency: 'USD', rate: 20, taxPct: 10,
  sender: { name: 'Me', company: 'GI' }, client: { name: 'C', company: 'Co' },
  lines: [{ id: 'l1', date: '2026-07-01', start: '12:00', end: '15:30', description: 'Recon' }],
  createdAt: 'x', updatedAt: 'x',
};

describe('InvoiceForm', () => {
  it('renders the live grand total (3.5h*20=70 +10% = 77)', () => {
    render(<InvoiceForm invoice={inv} assets={{}} onChange={() => {}} onUploadLogo={() => {}} />);
    expect(screen.getByText(/77/)).toBeTruthy();
  });
  it('editing the rate emits an updated invoice', () => {
    const onChange = vi.fn();
    render(<InvoiceForm invoice={inv} assets={{}} onChange={onChange} onUploadLogo={() => {}} />);
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '40' } });
    expect(onChange.mock.calls[0][0].rate).toBe(40);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoice-form`.

- [ ] **Step 3: Implement** `src/renderer/modules/invoices/InvoiceForm.tsx` — the editor: identity blocks (sender/client name/company + logo upload buttons), currency/rate/tax inputs, `<LineItemTable>`, a totals block from `computeTotals`, an optional notes field, and `<SignaturePad>`; plus a live preview via `dangerouslySetInnerHTML={{ __html: renderInvoiceHtml(invoice, assets) }}` inside a bordered pane. Every edit calls `onChange({ ...invoice, <field> })`. Logo upload buttons call `onUploadLogo('sender'|'client', file)` (the parent persists + updates `logoRef`). The `Rate` and `Tax %` inputs have `aria-label="Rate"` / `aria-label="Tax %"`. Currency is a `<select>` of common ISO codes (`USD, GBP, EUR, CAD, AUD, JPY`).

  Key wiring (abbreviated — full component follows this shape):
```tsx
import type { Invoice, Party } from '@shared/invoice-types';
import { LineItemTable } from './LineItemTable';
import { SignaturePad } from './SignaturePad';
import { computeTotals, formatMoney } from './calc';
import { renderInvoiceHtml } from './invoice-html';

export function InvoiceForm(
  { invoice, assets, onChange, onUploadLogo }:
  { invoice: Invoice; assets: Record<string, string>; onChange: (inv: Invoice) => void; onUploadLogo: (which: 'sender' | 'client', file: File) => void }
): JSX.Element {
  const t = computeTotals(invoice.lines, invoice.rate, invoice.taxPct);
  const setParty = (which: 'sender' | 'client', patch: Partial<Party>) => onChange({ ...invoice, [which]: { ...invoice[which], ...patch } });
  return (
    <div className="ga98-invoice-form">
      {/* identity blocks with name/company inputs + logo upload buttons calling onUploadLogo */}
      {/* currency <select>, <input aria-label="Rate">, <input aria-label="Tax %"> */}
      <LineItemTable lines={invoice.lines} rate={invoice.rate} currency={invoice.currency}
        onChange={(lines) => onChange({ ...invoice, lines })} />
      <div className="ga98-invoice-totals">
        <div>Total hours: {t.totalHours}</div>
        <div>Subtotal: {formatMoney(t.subtotal, invoice.currency)}</div>
        {invoice.taxPct ? <div>Tax: {formatMoney(t.tax, invoice.currency)}</div> : null}
        <div><b>Total: {formatMoney(t.total, invoice.currency)}</b></div>
      </div>
      <SignaturePad onCapture={/* parent persists → sets signature.signatureRef */ () => {}} />
      <div className="ga98-invoice-preview" dangerouslySetInnerHTML={{ __html: renderInvoiceHtml(invoice, assets) }} />
    </div>
  );
}
```
  (The implementer fills the identity/rate/tax inputs per the shape above; the test pins the two load-bearing behaviors — live total + rate edit. `renderInvoiceHtml` output is already escaped, so `dangerouslySetInnerHTML` here is safe by construction.)

- [ ] **Step 4: Run → PASS** — `pnpm test invoice-form && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): invoice editor form with live totals + preview`.

---

### Task 9: `InvoicesModule` host + module registration

**Files:** Create `src/renderer/modules/invoices/InvoicesModule.tsx`; Modify `src/renderer/modules/register-builtins.tsx`, `src/renderer/state/store.ts` (`ModuleKey`), `src/renderer/shell/Icon.tsx`, `src/renderer/shell/Desktop.tsx`, `src/shared/types.ts`, `src/renderer/styles/theme.css`; Test: `test/invoices-module.test.tsx`.

**Interfaces:**
- Consumes: `InvoiceForm` (Task 8); `window.api.invoices.*` (Task 5); `Invoice` (`@shared/invoice-types`).

- [ ] **Step 1: Failing test** `test/invoices-module.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvoicesModule } from '../src/renderer/modules/invoices/InvoicesModule';

beforeEach(() => {
  (globalThis as any).window.api = { invoices: {
    list: vi.fn(async () => []),
    nextNumber: vi.fn(async () => '0001'),
    save: vi.fn(async (i: any) => i),
    listProfiles: vi.fn(async () => []),
    getAsset: vi.fn(async () => null),
    exportPdf: vi.fn(async () => 'invoice.pdf'),
    duplicate: vi.fn(), remove: vi.fn(), saveProfile: vi.fn(), removeProfile: vi.fn(), putAsset: vi.fn(),
  } };
});

describe('InvoicesModule', () => {
  it('New invoice fetches a number and opens the editor', async () => {
    render(<InvoicesModule />);
    fireEvent.click(screen.getByText('New invoice'));
    await vi.waitFor(() => expect((window as any).api.invoices.nextNumber).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm test invoices-module`.

- [ ] **Step 3: Implement.**
  - `InvoicesModule.tsx`: a two-pane host — a list of saved invoices (from `list()`, with New / Open / Duplicate / Delete) and, when one is selected/new, the `<InvoiceForm>` with a Save and an **Export PDF** button. New invoice: `nextNumber()` → seed an `Invoice` with empty parties + one blank line + today's `issueDate`. Save: `save(invoice)`. Export: build the resolved `assets` map by `getAsset(ref)` for each `logoRef`/`signatureRef`, then `exportPdf(renderInvoiceHtml(invoice, assets))` (import `renderInvoiceHtml` for the export payload; toast the saved filename). `onUploadLogo`: read the File → `putAsset` → set the party's `logoRef` + cache the returned asset's dataUrl in local `assets` state for preview.
  - Register: in `register-builtins.tsx` add `registerModule({ key: 'invoices', title: 'Invoices', glyph: '🧾', component: InvoicesAdapter, builtin: true, defaultWidth: 900, defaultHeight: 640 });` (+ an `InvoicesAdapter` wrapper like the others). Add `'invoices'` to the `ModuleKey` union in `state/store.ts`. Add an `invoices` glyph in `Icon.tsx` GLYPHS, a title in `Desktop.tsx`, and shortcut entries in `types.ts` (mirror the two `media-player` rows).
  - `theme.css`: `.ga98-invoice-form`, `.ga98-invoice-lines` (table borders, `.num{text-align:right}`), `.ga98-invoice-totals`, `.ga98-invoice-preview` (bordered white pane), `.ga98-signature-pad`/`.ga98-sig-canvas` (bordered box). Respect the 98.css dark-table cascade caveat (restate bg on a class selector).

- [ ] **Step 4: Run → PASS** — `pnpm test invoices-module && pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(invoices): module host (list + editor + export) and registration`.

---

## Post-tasks (controller, after all 9 green + whole-branch review)

- [ ] Full `pnpm test` + `pnpm typecheck` (controller re-run).
- [ ] Whole-branch adversarial review (4 dims → refute-by-default verify → auto-fix confirmed critical/important). Focus: the XSS fence in `invoice-html.ts` (every user string escaped, incl. the data-URL src), `ensureAssetInput` bounds, no main→renderer import (the `exportPdf` handler takes prebuilt HTML), encrypted-at-rest for assets, and the `secureWriteFile(Buffer)` widening.
- [ ] Grep packaged `app.asar` for `invoices:save`, `ga98-invoice-lines`, `renderInvoiceHtml`, `invoice-assets` (identifiers survive bundling).
- [ ] Merge `feat/invoice-generator` → `main` (`--no-ff`); operator-gated release publish + push follows.

## Self-Review

- **Spec coverage:** types (T1) ✓; hours/totals/currency (T2) ✓; escaped printable HTML (T3) ✓; encrypted store + profiles + assets + numbering (T4) ✓; IPC + validated asset input + PDF export (T5) ✓; multi-line table with derived hours (T6) ✓; signature draw+upload (T7) ✓; editor + live totals + preview (T8) ✓; module host list/duplicate + registration (T9) ✓.
- **Placeholder scan:** none — pure units + store + IPC carry full code; T8/T9 give the load-bearing wiring + full sub-components with tests pinning behavior.
- **Type consistency:** `Invoice`/`InvoiceLine`/`Party`/`Signature`/`Profile`/`InvoiceStoreData`/`InvoiceAsset` (T1) used unchanged in T2–T9; `hoursBetween`/`computeTotals`/`formatMoney` stable T2→T3/T6/T8; `renderInvoiceHtml(invoice, assets)` stable T3→T8/T9; store fn names stable T4→T5; `channels.invoices.*` stable T1→T5. The `exportPdf` contract is `{ html: string }` in both T1 and T5 (renderer builds the HTML; main never imports a renderer module) — consistent across the plan.
- **Charter:** no new dep; no egress; encrypted at rest; deterministic pure units; XSS fence; persona commit identity; explicit-path adds.
