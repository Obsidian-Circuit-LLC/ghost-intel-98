# Reports — font-picker fix + structured recipient (GhostExodus follow-ups) — Design

**Date:** 2026-07-16
**Status:** Approved for planning (pending spec review)
**Author:** Obsidian Circuit (relaying GhostExodus field feedback on the Report Template Generator)

## Overview

GhostExodus field-tested the Report Template Generator (v3.50.0–3.50.2). v3.50.2 already fixed the typing-backwards bug and the invisible text body (frozen-`initialHtml`-ref + a real 140px sunken editor field). Two items remain, both confirmed against the current code:

1. **Font-family and font-size pickers silently do nothing** (this is also what he perceived as "functions have no response" — the module has no other dead handlers).
2. **The recipient is a bare single string** while the sender is already a rich `Contact`; he wants a popup to enter Organization/Name/Phone/Email for both.

Operator decisions (2026-07-16): **fix the font pickers** (don't remove them); **reuse the `Contact` model** for the recipient.

Target release: **v3.51.0** (adds a user-facing structured-recipient feature). Not in scope: the queued PDF-signing tool (a separate future feature).

## Global Constraints
- No new network egress, no telemetry, no new dependency (reuse the existing `Contact`/`ContactBook` machinery + the report sanitizer). No charter change; encrypt-at-rest unaffected (reports already persist via the existing store).
- Preserve the v3.50.2 typing/text-body fix — do NOT touch `TextBlock.tsx`'s `initialHtml` ref / `dangerouslySetInnerHTML` (line 45/320) or the `.ga98-report-textblock-body` CSS.
- Backward compatible: existing reports carry a legacy `report.to` string; export must still render it when no recipient contact is set.
- Commits: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, no AI trailers; `--no-verify` + `-c`; explicit-path adds; never stage the known-dirty files.

---

## Workstream A — Fix the font-family + font-size pickers

**Goal.** Selecting a font family/size applies it to the current editor selection (like B/I/U already do).

**Root cause (confirmed).** The pickers are native `<select>`s (`TextBlock.tsx:258-272` size, `273-286` family). Opening a native `<select>` steals focus from the `contentEditable`, firing its `onBlur`→`commit` and collapsing the selection. By the time the select's `onChange` fires, `applyFont` (`106-129`) / `applySize` (`78-100`) read a live `window.getSelection()` that is collapsed, hit their `if (!sel || sel.isCollapsed) return;` guard (`~113`), and no-op. B/I/U work because they're `<button>`s with `onMouseDown preventDefault` (`255-257`) that keep the selection — a native `<select>` cannot use that trick without breaking the dropdown.

**Design.** Mirror the working link flow (`openLink`/`confirmLink` snapshot into `linkRange`, `149-182`): add a `fontRange` ref; on each picker's `onMouseDown` (fires *before* focus moves), snapshot the current selection Range; in `applyFont`/`applySize`, restore that Range (re-select it) before running the `execCommand`/font application. Reuse whatever save/restore-selection helper the link flow uses (or extract one). The sanitizer already accepts the six families + sizes (`rich-text.ts`), so nothing downstream changes.

**Files:** `src/renderer/modules/reports/blocks/TextBlock.tsx` (only the two picker handlers + a `fontRange` ref + snapshot wiring).

**Tests:** `test/reports-fontpicker.test.tsx` — with a mocked selection, `applyFont`/`applySize` applied via the snapshot path produce the expected `font-family`/`font-size` in the committed (sanitized) HTML; a picker change after a simulated blur no longer no-ops (the snapshot restores the range). Follow the existing `reports-textblock.test.tsx` harness.

---

## Workstream B — Structured recipient via the Contact model

**Goal.** The recipient gets the same rich structure the sender already has (Organization/Name/Phone/Email/Address), entered/edited through the same ContactBook popup; both render structured into PDF + DOCX.

**Current state.** Sender = `report.fromContactId` → a `Contact` (`reports-types.ts:7-16`: name/title/org/email/phone/address), selected via the "From" `<select>` (`ReportEditor.tsx:282-297`) and managed in `ContactBook.tsx`. Recipient = a bare `report.to` string, one input (`ReportEditor.tsx:299-306`). Export renders From via `contactHtml(contact)` (`report-html.ts:47`, `docx.ts:200-211`) but To as a raw escaped string (`report-html.ts:48`, `docx.ts:213`).

**Design.**
- **Model:** add `toContactId?: string` to `Report` (`reports-types.ts:25-41`). Keep the legacy `to?: string` for backward-compat display/export fallback.
- **UI:** replace the bare "To" input (`ReportEditor.tsx:299-306`) with a recipient **contact select + "Edit contact" affordance** mirroring the "From" control, both opening the existing `ContactBook.tsx` popup (which already does add/edit/select of org/name/phone/email/address). This simultaneously surfaces the sender's already-rich fields (the discoverability gap GhostExodus hit) and gives the recipient the same. One consistent dialog for both.
- **Export:** in `report-html.ts:48` and `docx.ts:213`, render `toContactId`'s `Contact` with the same structured block the From side uses (reuse `contactHtml` / the DOCX contact lines) when present; else fall back to the legacy `report.to` string (escaped).
- **Validator:** `ensureReport` (`src/main/security/validate.ts`) — accept `toContactId` (a bounded contact-id string), keep `to` optional.

**Files:** `src/shared/reports-types.ts`, `src/renderer/modules/reports/ReportEditor.tsx`, `src/renderer/modules/reports/ContactBook.tsx` (reuse; minor if a shared open path is needed), `src/main/reports/report-html.ts`, `src/main/reports/docx.ts`, `src/main/security/validate.ts`.

**Tests:** `test/reports-recipient-contact.test.ts(x)` — a report with `toContactId` renders the structured To in the HTML export (org/name/phone/email lines, escaped) and DOCX; a legacy report with only `to` still renders the string; the recipient select + ContactBook popup wiring (renderer) sets `toContactId`; `ensureReport` accepts/bounds `toContactId`.

---

## Cross-cutting
- No new module, no new IPC channel (reuse the existing reports + contacts surface). No new dependency.
- Version → **3.51.0**; README + release notes + profile README on ship.

## Verification
- `pnpm typecheck` + full `pnpm test` green (new: `reports-fontpicker`, `reports-recipient-contact`).
- Manual (Windows smoke, operator-gated): select text → change font family/size → it applies; add a recipient with org/name/phone/email via the popup → export PDF + DOCX show the structured To; a pre-existing report with a plain "to" still exports correctly; the v3.50.2 typing behavior is unchanged.

## Out of scope (queued / YAGNI)
- **PDF signing tool** — GhostExodus's "later" request; queued as its own future feature ([[pdf-signing-tool-queued]]), not this batch.
- Removing/redesigning the font pickers (operator chose fix-in-place).
- Any change to the v3.50.2 editor/typing internals.
