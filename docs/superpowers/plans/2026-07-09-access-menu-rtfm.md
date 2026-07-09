# Access Menu Categorization + RTFM Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Access (start) menu into fixed category flyouts with icons (RTFM moved just below Settings), and add Searchlight + SOCMINT guide sections to the RTFM module.

**Architecture:** Reuse the existing `Games ▸` flyout pattern in `AccessMenu.tsx` — extract a `CategoryFlyout` and drive five hardcoded `CATEGORIES`, replacing the `settings.shortcuts`-driven flat list. RTFM's two new sections render the in-repo guide markdown via the existing `MarkdownView` (`?raw`-imported so `code` backticks survive).

**Tech Stack:** React + TypeScript, Vite `?raw` import (built-in), vitest + jsdom.

## Global Constraints

- **Fixed categories only** — the `settings.shortcuts` flat list no longer renders in the menu; the setting field stays in the schema (don't delete it — avoids a consumer/migration break). Desktop icons (`Desktop.tsx`) untouched.
- **No new dependency, no egress.** Guides are bundled local markdown; `MarkdownView` already exists (renders as React children — no `dangerouslySetInnerHTML`, so any literal HTML is escaped).
- **Folds into the held v3.38.0.** Branch off `main` (which carries the held Ghost Ledger merge).
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`; `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; NO AI trailers; explicit-path adds; never stage the known-dirty files. NEVER checkout/merge/delete branches or touch main — commit only on the feature branch; the controller merges.
- **Branch:** `feat/access-menu-rtfm`.
- **Commands:** `pnpm test`, `pnpm typecheck`.

## File Structure

**New:** `src/renderer/modules/help/guides/searchlight-learning.md`, `src/renderer/modules/help/guides/socmint-tutorial.md` (copies of `docs/guides/*.md`), `test/access-menu.test.tsx`.
**Modified:** `src/renderer/shell/AccessMenu.tsx` (restructure), `src/renderer/modules/help/HelpModule.tsx` (2 sections), `test/help-module.test.tsx` (or create).

**Sequencing:** T1 Access menu → T2 RTFM guides. Independent; either order works.

---

### Task 1: Access menu → category flyouts

**Files:** Modify `src/renderer/shell/AccessMenu.tsx`; Test: `test/access-menu.test.tsx`.

**Interfaces:**
- Consumes: `ModuleKey`, `useWindows`, `getModule`, `glyphFor` (existing in the file/imports).
- Produces: `CategoryFlyout` (internal); `CATEGORIES` constant.

- [ ] **Step 1: Write the failing test** `test/access-menu.test.tsx` (jsdom, createRoot/act harness like `test/invoice-signature-pad.test.tsx`):

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessMenu } from '../src/renderer/shell/AccessMenu';

// Mock the window store's open + settings as the component needs (mirror the shell test harness).
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function labels(): string[] { return Array.from(container.querySelectorAll('.ga98-access-entry')).map((e) => e.textContent || ''); }

describe('AccessMenu categories', () => {
  it('renders the five category flyouts + Games + OSINT Toolkit and the footer, RTFM below Settings', async () => {
    await act(async () => { root.render(<AccessMenu onClose={() => {}} />); });
    const text = labels().join('|');
    for (const cat of ['Programs', 'Creativity', 'Music', 'Network', 'Organization', 'Games', 'OSINT Toolkit', 'Settings', 'RTFM', 'Shut Down']) {
      expect(text).toContain(cat);
    }
    // RTFM appears after Settings in DOM order
    const order = labels();
    expect(order.findIndex((l) => /RTFM/.test(l))).toBeGreaterThan(order.findIndex((l) => /Settings/.test(l)));
  });
  it('opening Programs and clicking My Cases opens the cases module', async () => {
    const open = vi.fn();
    // inject the store's open (mirror how the shell test stubs useWindows) — or assert via a spy on window store.
    await act(async () => { root.render(<AccessMenu onClose={() => {}} />); });
    // hover Programs → click My Cases → expect open called with module 'cases' (adapt to the harness's store stub).
  });
});
```

  (Adapt the store-stub details to the existing shell-test harness — the load-bearing assertions are: five categories + Games + OSINT + footer present, and RTFM after Settings.)

- [ ] **Step 2: Run → FAIL** — `pnpm test access-menu`.

- [ ] **Step 3: Implement** in `AccessMenu.tsx`:
  - Add the constant (verify each `ModuleKey` against the union in `state/store.ts`):
```ts
const CATEGORIES: { label: string; glyph: string; items: { module: ModuleKey; label: string }[] }[] = [
  { label: 'Programs', glyph: '📁', items: [
    { module: 'cases', label: 'My Cases' }, { module: 'notepad', label: 'Notepad 98' },
    { module: 'briefcase', label: 'Briefcase' }, { module: 'markets', label: 'Markets' },
    { module: 'search', label: 'Search' }, { module: 'ai-assistant', label: 'Q' } ] },
  { label: 'Creativity', glyph: '🎨', items: [
    { module: 'notepad', label: 'Notepad 98' }, { module: 'journal', label: 'Journal Jots' } ] },
  { label: 'Music', glyph: '🎵', items: [ { module: 'media-player', label: 'Jukebox' } ] },
  { label: 'Network', glyph: '🖧', items: [
    { module: 'dialterm', label: 'DialTerm' }, { module: 'mail', label: 'Mail' },
    { module: 'chat', label: 'Chat (beta)' }, { module: 'bookmarks', label: 'Bookmarks' } ] },
  { label: 'Organization', glyph: '📅', items: [
    { module: 'invoices', label: 'Invoices' }, { module: 'calendar', label: 'Calendar' },
    { module: 'reminders', label: 'Reminders' }, { module: 'alarm', label: 'Alarm' } ] },
];
```
  - Extract a `CategoryFlyout` from the current Games markup (share the shell + item render):
```tsx
function CategoryFlyout({ label, glyph, items, onOpen }:
  { label: string; glyph: string; items: { module: ModuleKey; label: string }[]; onOpen: (m: ModuleKey, l: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="ga98-access-entry" role="menuitem" tabIndex={0} aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') setOpen(true); }}>
        <span className="ga98-access-entry-glyph" aria-hidden="true">{glyph}</span>
        <span style={{ flex: 1 }}>{label}</span>
        <span aria-hidden="true" style={{ opacity: 0.7 }}>▸</span>
      </div>
      {open && (
        <div role="menu" style={{ position: 'absolute', left: '100%', top: 0, minWidth: 160, background: '#c0c0c0', border: '2px outset #f5f5f5', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30 }}>
          {items.map((it) => (
            <div key={`${it.module}:${it.label}`} className="ga98-access-entry" role="menuitem" tabIndex={0}
              onClick={() => onOpen(it.module, it.label)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(it.module, it.label); }}>
              <span className="ga98-access-entry-glyph" aria-hidden="true">{glyphFor(it.module)}</span>
              <span>{it.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```
  - In `AccessMenu`'s render: **remove** the `items = (settings?.shortcuts ...)` computation and its `{items.map(...)}` flat-list block (and the now-unused `GAME_TARGETS`/`OSINT_TARGETS` filter if only used there). Render the categories: `{CATEGORIES.map((c) => <CategoryFlyout key={c.label} label={c.label} glyph={c.glyph} items={c.items} onOpen={openModule} />)}` followed by the existing **Games** flyout (refactor it to `<CategoryFlyout label="Games" glyph="🎮" items={GAMES} onOpen={openModule} />`) and the existing **OSINT Toolkit** flyout (leave bespoke — it's grouped).
  - Footer: keep Desktop Clock toggle + `Settings…`; **add an RTFM entry immediately below Settings**: `<div className="ga98-access-entry" role="menuitem" tabIndex={0} onClick={() => { open({ module: 'help', title: 'RTFM' }); onClose(); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { open({ module: 'help', title: 'RTFM' }); onClose(); } }}><span className="ga98-access-entry-glyph" aria-hidden="true">❔</span><span>RTFM</span></div>`; then `Shut Down…`.

- [ ] **Step 4: Run tests + typecheck** → PASS/clean. (Also run `pnpm test` for any existing AccessMenu/shell test that asserted the old flat list — update it to the category structure.)
- [ ] **Step 5: Commit** — `feat(shell): categorized Access menu (fixed flyouts + icons, RTFM below Settings)`.

---

### Task 2: RTFM — Searchlight + SOCMINT guide sections

**Files:** Create `src/renderer/modules/help/guides/searchlight-learning.md`, `src/renderer/modules/help/guides/socmint-tutorial.md`; Modify `src/renderer/modules/help/HelpModule.tsx`; Test: `test/help-module.test.tsx`.

**Interfaces:**
- Consumes: `MarkdownView` (`../ai-assistant/MarkdownView`, prop `text: string`).
- Produces: `SectionKey` gains `'searchlight' | 'socmint'`; two `SECTIONS` entries; two panes.

- [ ] **Step 1: Copy the guide sources.** Copy the FULL content of `docs/guides/searchlight-learning.md` → `src/renderer/modules/help/guides/searchlight-learning.md` and `docs/guides/socmint-tutorial.md` → `src/renderer/modules/help/guides/socmint-tutorial.md` (verbatim). (Bundling via Vite `?raw` needs the file inside the renderer tree; `docs/guides/*.md` stays the canonical source — add a one-line comment in HelpModule noting to re-sync on guide edits.)

- [ ] **Step 2: Write the failing test** `test/help-module.test.tsx` (jsdom, createRoot/act):

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelpModule } from '../src/renderer/modules/help/HelpModule';

let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function railLabels(): string[] { return Array.from(container.querySelectorAll('.ga98-settings-rail-item')).map((e) => e.textContent || ''); }

describe('RTFM sections', () => {
  it('lists all six sections incl. Searchlight + SOCMINT', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const t = railLabels().join('|');
    for (const s of ['Manual', 'OpChildSafety', 'Hacktivist Ethos', 'OSINT', 'Searchlight', 'SOCMINT']) expect(t).toContain(s);
  });
  it('selecting Searchlight renders its guide markdown', async () => {
    await act(async () => { root.render(<HelpModule />); });
    const btn = Array.from(container.querySelectorAll('.ga98-settings-rail-item')).find((b) => /Searchlight/.test(b.textContent || ''));
    await act(async () => { (btn as HTMLElement).click(); });
    expect(container.textContent).toMatch(/Searchlight/i); // a heading from the guide
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm test help-module`.

- [ ] **Step 4: Implement** in `HelpModule.tsx`:
  - `import SEARCHLIGHT_GUIDE from './guides/searchlight-learning.md?raw';` and `import SOCMINT_GUIDE from './guides/socmint-tutorial.md?raw';` and `import { MarkdownView } from '../ai-assistant/MarkdownView';`. (If the build rejects the `?raw` import, fall back to a `guides.ts` exporting the content as escaped strings.)
  - Extend `type SectionKey = 'manual' | 'opcs' | 'hacktivist' | 'osint' | 'searchlight' | 'socmint';` and add to `SECTIONS`: `{ key: 'searchlight', label: 'Searchlight', glyph: '📡' }, { key: 'socmint', label: 'SOCMINT', glyph: '💬' }`.
  - In the render switch, after the OSINT pane: `{section === 'searchlight' && <div className="ga98-stack"><MarkdownView text={SEARCHLIGHT_GUIDE} /></div>}` and `{section === 'socmint' && <div className="ga98-stack"><MarkdownView text={SOCMINT_GUIDE} /></div>}`.

- [ ] **Step 5: Run tests + typecheck** → PASS/clean. (If `?raw` typing errors, add a `declare module '*.md?raw' { const s: string; export default s; }` to a d.ts, mirroring existing asset module declarations.)
- [ ] **Step 6: Commit** — `feat(help): RTFM Searchlight + SOCMINT guide sections (markdown)`.

---

## Post-tasks (controller)

- [ ] Full `pnpm test` + `pnpm typecheck`.
- [ ] Whole-branch adversarial review — focus: every current module reachable from the new menu (no orphaned tool); flyouts open/close correctly (DOM-descendant, no premature close); RTFM opens the `help` module below Settings; the `?raw` guides bundle (grep packaged asar for a guide heading); the removed flat-list didn't break the `shortcuts` setting read.
- [ ] Grep packaged `app.asar` for `Programs`/`Organization` category labels + a Searchlight-guide heading (guides bundled).
- [ ] Merge `feat/access-menu-rtfm` → main (`--no-ff`); folds into the held v3.38.0 (still unpushed; release stays held per operator).

## Self-Review

- **Spec coverage:** five category flyouts + Games + OSINT (T1) ✓; icons (T1 glyphs) ✓; RTFM below Settings (T1) ✓; drop flat shortcuts, keep the setting field (T1) ✓; Searchlight + SOCMINT sections via MarkdownView, keep OSINT (T2) ✓; guides bundled (T2 `?raw`) ✓.
- **Placeholder scan:** none — T1 carries full CategoryFlyout + CATEGORIES; T2 copies the real in-repo guide files (not placeholder text) and wires MarkdownView.
- **Type consistency:** `CategoryFlyout` props + `CATEGORIES` shape stable; `SectionKey` union extended consistently with the `SECTIONS`/switch; `MarkdownView` `text` prop matches its signature.
- **Charter:** no new dep; no egress; MarkdownView escapes; desktop icons untouched; persona identity; feature-branch-only.
