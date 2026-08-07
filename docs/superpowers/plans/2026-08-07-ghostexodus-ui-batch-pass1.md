# GhostExodus UI Batch — Pass 1 (Banners + Shred Panel + JJ Unlock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-width pixel-art banner headers to six modules, redesign Shred around a "SHRED IT" panel, and relayout the Journal Jots PIN screen — all reusing GhostExodus's delivered art, theme-aware and behaviour-preserving.

**Architecture:** Each module rolls its own header (no shared component exists — confirmed). A single shared CSS class `.ga98-module-banner` gives every banner a uniform full-width, fixed-height, `object-fit: cover` band. Modules whose root is a horizontal split get wrapped in a module-specific column so the banner sits above existing content. Shred and the JJ unlock screen additionally get layout changes. No behaviour changes.

**Tech Stack:** React 18 (`createRoot`+`act`, no @testing-library), TypeScript, Vitest (jsdom), CSS in `src/renderer/styles/theme.css`. Banner assets are Vite asset-URL imports from `src/renderer/assets/`.

## Global Constraints

- **No new dependencies, no new network egress, no telemetry.** Markup/CSS only.
- **Theme-aware.** All new chrome uses existing `--ga98-*` tokens; must stay legible under Classic **and** QUIET AMETHYST (`[data-ga98-theme='amethyst']`). No LOCKED status/honesty token may be recoloured or hidden. Banner images are theme-agnostic art.
- **Behaviour parity.** No change to Shred's destructive action or its confirmation/guarantees; no change to the Journal PIN gate, encryption, or the honesty copy. Layout/art only.
- **Assets already on-branch** in `src/renderer/assets/`: `q-banner.png`, `briefcase-banner.png`, `mail-banner.png`, `settings-banner.png`, `journal-jots-banner.png`, `journal-jots-book.png`, `shred-banner.png`, `shred-ghost-bin.png`. Import each as `import x from '../../assets/<name>.png'`.
- **Banner treatment (uniform):** class `.ga98-module-banner` = `display:block; width:100%; height:clamp(120px,16vw,190px); object-fit:cover; object-position:center; border-bottom:2px solid var(--ga98-border-shadow, #808080);`. Never set `image-rendering:pixelated` (art is anti-aliased). The banner is the **first child** of the module's window body, above all existing content.
- **Test harness:** mirror `test/my-documents-module.test.tsx` — `// @vitest-environment jsdom`, mock `window.api` with the module's namespace before importing the component, mount with `createRoot`+`act`, assert on `container`. Each task names the api mock it needs.
- **Commit persona:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `git commit --no-verify -c ...`, explicit-path `git add`, **no AI trailers**.

---

### Task 1: Shared banner CSS + Mail banner (pattern-setter)

**Files:**
- Modify: `src/renderer/styles/theme.css` (add `.ga98-module-banner` rule near the ledger-banner block ~line 1665)
- Modify: `src/renderer/modules/mail/MailModule.tsx:232-233` (root is already `flex-column` — insert banner as first child)
- Test: `test/mail-banner.test.tsx` (new)

**Interfaces:**
- Produces: the CSS class `.ga98-module-banner` (consumed by Tasks 2-7) and the asset-import + first-child-`<img>` pattern every later banner task copies.

- [ ] **Step 1: Write the failing test** — `test/mail-banner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MailModule } from '../src/renderer/modules/mail/MailModule';

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).window.api = {
    mail: { listAccounts: () => Promise.resolve([]), listMessages: () => Promise.resolve([]) }
  };
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Mail banner', () => {
  it('renders the mail banner image as the first header element', async () => {
    await act(async () => { root.render(<MailModule />); });
    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/mail-banner/);
    expect(img!.getAttribute('alt')).toBe('Mail');
  });
});
```

(Adjust the `window.api.mail` mock to the actual method names MailModule calls on mount — read `MailModule.tsx` and mirror what it invokes in its effects. If MailModule needs more of `window.api`, add minimal stubs.)

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm vitest run test/mail-banner.test.tsx`
Expected: FAIL — no `img.ga98-module-banner`.

- [ ] **Step 3: Add the shared CSS** in `theme.css` near the ledger-banner section (~1665):

```css
/* Full-width module banner header (GhostExodus art batch) */
.ga98-module-banner {
  display: block;
  width: 100%;
  height: clamp(120px, 16vw, 190px);
  object-fit: cover;
  object-position: center;
  border-bottom: 2px solid var(--ga98-border-shadow, #808080);
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Add the banner to Mail.** In `MailModule.tsx`, add `import mailBanner from '../../assets/mail-banner.png';` and insert as the first child of the root column div (before the `.ga98-toolbar` at line 233):

```tsx
<img src={mailBanner} alt="Mail" className="ga98-module-banner" />
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm vitest run test/mail-banner.test.tsx` → PASS.
- [ ] **Step 6: Commit** — `git add src/renderer/styles/theme.css src/renderer/modules/mail/MailModule.tsx test/mail-banner.test.tsx && git commit --no-verify -c ... -m "feat(mail): full-width banner header + shared .ga98-module-banner class"`

---

### Task 2: Q (AI Assistant) banner

**Files:**
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx:616-617` (root is `<div style={{display:'flex',height:'100%'}}>` — a horizontal split; wrap it so the banner sits above)
- Test: `test/q-banner.test.tsx` (new)

**Interfaces:**
- Consumes: `.ga98-module-banner` (Task 1).

- [ ] **Step 1: Write the failing test** — mirror Task 1's harness. Mock the `window.api` namespaces AiAssistantModule reads on mount (read the file's effects — likely `ai`, `memory`, `settings`, `cases`; stub each method it calls to resolve empty). Assert `container.querySelector('img.ga98-module-banner')` src matches `/q-banner/` and `alt === 'Q'`.
- [ ] **Step 2: Run test → FAIL.**
- [ ] **Step 3: Implement.** Add `import qBanner from '../../assets/q-banner.png';`. The current root is a horizontal flex (memory sidebar + right column). Wrap it: change the root to a column that holds the banner then the existing horizontal split:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
  <img src={qBanner} alt="Q" className="ga98-module-banner" />
  <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>
    {/* existing memory sidebar + right column, unchanged */}
  </div>
</div>
```
Preserve the existing children verbatim inside the inner horizontal div; ensure `minHeight:0` so the inner split still scrolls.
- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Verify no regression** — `pnpm vitest run test/ai-assistant-memory-toggle.test.tsx` → still PASS.
- [ ] **Step 6: Commit.**

---

### Task 3: Briefcase banner

**Files:**
- Modify: `src/renderer/modules/briefcase/BriefcaseModule.tsx:93` (root `<div className="ga98-split">` — wrap in a module-specific column `ga98-briefcase` so the shared `ga98-split` class is unaffected)
- Modify: `src/renderer/styles/theme.css` (add `.ga98-briefcase { display:flex; flex-direction:column; height:100%; overflow:hidden; }`)
- Test: `test/briefcase-banner.test.tsx` (new)

**Interfaces:**
- Consumes: `.ga98-module-banner`.

- [ ] **Step 1: Failing test** — mirror Task 1; mock `window.api.briefcase` (mirror what `test/briefcase.test.ts` / `briefcase-dnd.test.tsx` stub). Assert `img.ga98-module-banner` src `/briefcase-banner/`, alt `Briefcase`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `import briefcaseBanner from '../../assets/briefcase-banner.png';`. Wrap the existing `<div className="ga98-split">…</div>` in `<div className="ga98-briefcase"><img …/><div className="ga98-split">…existing…</div></div>`. Add the `.ga98-briefcase` CSS.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — `pnpm vitest run test/briefcase.test.ts test/briefcase-dnd.test.tsx` → PASS.
- [ ] **Step 6: Commit.**

---

### Task 4: Settings banner

**Files:**
- Modify: `src/renderer/modules/settings/SettingsModule.tsx:98` (root `<div className="ga98-settings-shell">` — wrap so banner sits above the nav-rail + pane)
- Modify: `src/renderer/styles/theme.css:922-957` (the `.ga98-settings-shell` block — add an outer column wrapper class `.ga98-settings-with-banner`, or make the shell a column with the banner first and the existing `rail+pane` row below)
- Test: `test/settings-banner.test.tsx` (new)

**Interfaces:**
- Consumes: `.ga98-module-banner`.

- [ ] **Step 1: Failing test** — mirror Task 1; mock the `window.api` namespaces SettingsModule reads (mirror `test/settings-*.test.ts*`; likely `settings.get/set`, `auth.status`). Assert `img.ga98-module-banner` src `/settings-banner/`, alt `Settings`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `import settingsBanner from '../../assets/settings-banner.png';`. The current shell is a `rail | pane` row. Introduce an outer column: `<div className="ga98-settings-with-banner"><img …/><div className="ga98-settings-shell">…existing rail+pane…</div></div>`, and add CSS `.ga98-settings-with-banner{display:flex;flex-direction:column;height:100%;overflow:hidden}` plus ensure `.ga98-settings-shell` keeps `flex:1 1 auto; min-height:0` so the rail/pane still fill and scroll. Do not alter the About-pane logo.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — `pnpm vitest run test/settings-clearnet-resolve-ui.test.tsx` → PASS.
- [ ] **Step 6: Commit.**

---

### Task 5: Journal Jots editor banner (unlocked view only)

**Files:**
- Modify: `src/renderer/modules/journal/JournalModule.tsx:163` (the `gate==='open'` view, root `<div className="ga98-split">` — wrap in `ga98-journal` column with the banner above)
- Modify: `src/renderer/styles/theme.css` (add `.ga98-journal { display:flex; flex-direction:column; height:100%; overflow:hidden; }`)
- Test: `test/journal-banner.test.tsx` (new)

**Interfaces:**
- Consumes: `.ga98-module-banner`. The banner appears ONLY in the unlocked editor, never on the PIN screen (Task 6 owns the PIN screen).

- [ ] **Step 1: Failing test** — mirror Task 1; mock `window.api.journal` with `hasPin: ()=>Promise.resolve(true)`, `verifyPin: ()=>Promise.resolve(true)`, `list: ()=>Promise.resolve([])`, `read`, `save`, `delete` stubs. Drive the module into the `open` gate (verify a PIN via the form, or set the mock so it opens). Assert: after unlock, `img.ga98-module-banner` src `/journal-jots-banner/` is present; and assert it is **absent** while gate is `locked`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `import journalBanner from '../../assets/journal-jots-banner.png';`. In the `open` branch, wrap `<div className="ga98-split">…</div>` in `<div className="ga98-journal"><img src={journalBanner} alt="Journal Jots" className="ga98-module-banner" /><div className="ga98-split">…existing…</div></div>`. Add `.ga98-journal` CSS. Leave the PIN branch (112-155) untouched.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — `pnpm vitest run test/journal.test.ts` → PASS.
- [ ] **Step 6: Commit.**

---

### Task 6: Journal Jots unlock relayout (PIN top-left + book illustration)

**Files:**
- Modify: `src/renderer/modules/journal/JournalModule.tsx:112-155` (the PIN unlock view — the centered `ga98-pane` container at line 116)
- Modify: `src/renderer/styles/theme.css` (add `.ga98-journal-unlock` two-column layout classes)
- Test: `test/journal-unlock-layout.test.tsx` (new)

**Interfaces:**
- Consumes: the `journal-jots-book.png` asset.

- [ ] **Step 1: Write the failing test** — mount JournalModule with `window.api.journal.hasPin: ()=>Promise.resolve(true)` so it renders the `locked` gate. Assert both are present in the PIN view: `input[type="password"]` (the PIN field) AND `img` whose src matches `/journal-jots-book/`. Assert the existing honesty copy substring "convenience gate" is still present.
- [ ] **Step 2: Run → FAIL** (book image not yet present).
- [ ] **Step 3: Implement.** `import journalBook from '../../assets/journal-jots-book.png';`. Restructure the PIN view (lines 112-155): replace the centered container at line 116 with a two-column layout —

```tsx
<div className="ga98-journal-unlock">
  <div className="ga98-journal-unlock-form">
    {/* existing: title, honesty blurb, <form> with PIN input(s), error line, Unlock button — UNCHANGED */}
  </div>
  <div className="ga98-journal-unlock-art">
    <img src={journalBook} alt="Journal Jots" />
  </div>
</div>
```
CSS: `.ga98-journal-unlock{display:flex;height:100%;gap:16px;padding:20px;align-items:flex-start}` (form pinned top-left); `.ga98-journal-unlock-form{flex:0 0 280px}`; `.ga98-journal-unlock-art{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-width:0}`; `.ga98-journal-unlock-art img{max-width:100%;max-height:100%;object-fit:contain}`. Keep every form element (title, blurb, PIN input, confirm-on-set input, error, submit) exactly as-is — only the wrapping/positioning changes. This must work for both `set-pin` and `locked` gates.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — `pnpm vitest run test/journal.test.ts test/journal-banner.test.tsx` → PASS (PIN set/verify/lockout behaviour unchanged; editor banner still gated to open view).
- [ ] **Step 6: Commit.**

---

### Task 7: Shred banner + "SHRED IT" panel redesign

**Files:**
- Modify: `src/renderer/modules/shred/ShredModule.tsx:62` (root `<div className="ga98-stack">` — wrap in `ga98-shred-shell` column: banner on top, then a row with the existing shred list/actions on the left and the new SHRED IT panel on the right)
- Modify: `src/renderer/styles/theme.css` (add `.ga98-shred-shell`, `.ga98-shred-body`, `.ga98-shred-it-panel` classes)
- Test: `test/shred-panel.test.tsx` (new)

**Interfaces:**
- Consumes: `.ga98-module-banner`, `shred-banner.png`, `shred-ghost-bin.png`. Fixed art-direction copy (verbatim): heading `SHRED IT`; three items `Delete it`, `Forget it`, `It never existed`; warning `ONCE IT'S SHREDDED, IT'S GONE FOR GOOD`.

- [ ] **Step 1: Write the failing test** — mount ShredModule with `window.api.shred` stubs (mirror any existing shred test; if none, stub `list: ()=>Promise.resolve([])`, `empty`, `refresh`). Assert: `img.ga98-module-banner` src `/shred-banner/`; the panel `img` src `/shred-ghost-bin/`; and the text `SHRED IT`, `Delete it`, `Forget it`, `It never existed`, `ONCE IT'S SHREDDED, IT'S GONE FOR GOOD` are all present in `container.textContent`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Imports: `import shredBanner from '../../assets/shred-banner.png';` and `import shredBin from '../../assets/shred-ghost-bin.png';`. Restructure:

```tsx
<div className="ga98-shred-shell">
  <img src={shredBanner} alt="Shred" className="ga98-module-banner" />
  <div className="ga98-shred-body">
    <div className="ga98-stack">{/* existing toolbar + list, UNCHANGED */}</div>
    <aside className="ga98-shred-it-panel">
      <img src={shredBin} alt="" aria-hidden="true" />
      <h3>SHRED IT</h3>
      <ul>
        <li>Delete it</li>
        <li>Forget it</li>
        <li>It never existed</li>
      </ul>
      <p className="ga98-shred-warning">ONCE IT'S SHREDDED, IT'S GONE FOR GOOD</p>
    </aside>
  </div>
</div>
```
CSS: `.ga98-shred-shell{display:flex;flex-direction:column;height:100%;overflow:hidden}`; `.ga98-shred-body{display:flex;flex:1 1 auto;min-height:0;gap:8px}`; the existing `.ga98-stack` should get `flex:1 1 auto;min-width:0` inside the body (scope it: `.ga98-shred-body>.ga98-stack{flex:1 1 auto;min-width:0}`); `.ga98-shred-it-panel{flex:0 0 240px;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border-left:2px solid var(--ga98-border-shadow,#808080);background:var(--ga98-surface,#c0c0c0);color:var(--ga98-text,#000);text-align:center}`; `.ga98-shred-warning{font-weight:bold;color:var(--ga98-status-error,#a00)}`. **The warning colour MUST route through a theme-aware token** (`--ga98-status-error`) so it stays legible under amethyst — do not hardcode a light-surface red. The existing shred list, its actions, and the destructive behaviour stay exactly as they were.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Regression** — run any existing shred test; confirm the Empty-Shred confirm/behaviour is unchanged.
- [ ] **Step 6: Commit.**

---

## Self-Review Notes (author)

- **Spec coverage:** six banners (Tasks 1-5 cover Mail/Q/Briefcase/Settings/JJ; Task 7 Shred) ✓; Shred SHRED-IT panel (Task 7) ✓; JJ unlock relayout (Task 6) ✓. Pass-2 editor upgrade is a separate plan.
- **Wrapper-class caution:** Briefcase (`ga98-split`) and Shred (`ga98-stack`) use shared layout classes → each is wrapped in a module-specific column so no other consumer of those classes is affected (per the module map).
- **Theme:** every new chrome colour uses `--ga98-*` tokens; the Shred warning explicitly routes through `--ga98-status-error` (a LOCKED theme-aware token) so amethyst legibility holds. Banner art is theme-agnostic.
- **Type consistency:** the only new CSS class consumed across tasks is `.ga98-module-banner` (defined Task 1, used 2/3/4/5/7). Each module-specific wrapper class is defined in the same task that uses it.
