# AI Assistant Formatted Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the bundled assistant's replies as real formatting (bold/italics/bullets/headings, emojis pass through) instead of literal markdown symbols, behind a "Formatted output" setting default on.

**Architecture:** A pure in-house markdown parser (`parseMarkdown` → small typed AST) + a `MarkdownView` component that maps the AST to React elements (NO `dangerouslySetInnerHTML`, so no XSS surface). A new `ai.formattedOutput` setting (default true) gates it; off renders raw `<pre>` as today.

**Tech Stack:** React renderer, zustand settings store, vitest (node env, pure-function tests).

**Spec:** `docs/superpowers/specs/2026-06-20-ai-formatted-output-design.md`

## Global Constraints

- **No new dependency**, no network, no IPC, no telemetry. **No `dangerouslySetInnerHTML`** anywhere — the parser produces an AST of plain strings; React escapes all text at render (model output containing `<script>` must render as literal text, never HTML).
- The parser MUST be robust to partial/incomplete markdown (mid-stream `**bo`, a lone `#`/`*`) — emit literal text, never throw.
- Default `formattedOutput: true`, fully reversible via the toggle (off → today's raw `<pre>`).
- Formatting applies to **assistant** messages only; **user** messages stay raw `<pre>`. Right-click copy still copies raw `m.content`.
- Test style: vitest **node** env, pure-function tests only (no React render harness).

---

## Task 1: Pure markdown parser `markdown.ts`

**Files:**
- Create: `src/renderer/modules/ai-assistant/markdown.ts`
- Test: `test/ai-markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/ai-markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline } from '../src/renderer/modules/ai-assistant/markdown';

describe('parseInline', () => {
  it('plain text (with emoji) is a single text node', () => {
    expect(parseInline('hello 🌍')).toEqual([{ t: 'text', v: 'hello 🌍' }]);
  });
  it('parses **bold**', () => {
    expect(parseInline('a **b** c')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'bold', children: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }
    ]);
  });
  it('parses *italic* and `code`', () => {
    expect(parseInline('*i*')).toEqual([{ t: 'italic', children: [{ t: 'text', v: 'i' }] }]);
    expect(parseInline('`x`')).toEqual([{ t: 'code', v: 'x' }]);
  });
  it('unclosed ** is literal text (no throw)', () => {
    expect(parseInline('**bold')).toEqual([{ t: 'text', v: '**bold' }]);
  });
  it('never produces HTML — angle brackets stay literal text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });
});

describe('parseMarkdown', () => {
  it('a paragraph', () => {
    expect(parseMarkdown('hello world')).toEqual([{ t: 'p', children: [{ t: 'text', v: 'hello world' }] }]);
  });
  it('an ATX heading drops the hashes and records the level', () => {
    expect(parseMarkdown('## Title')).toEqual([{ t: 'h', level: 2, children: [{ t: 'text', v: 'Title' }] }]);
  });
  it('consecutive bullets become one ul', () => {
    expect(parseMarkdown('* a\n- b')).toEqual([{ t: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'text', v: 'b' }]] }]);
  });
  it('blank line separates paragraphs', () => {
    expect(parseMarkdown('a\n\nb')).toEqual([
      { t: 'p', children: [{ t: 'text', v: 'a' }] },
      { t: 'p', children: [{ t: 'text', v: 'b' }] }
    ]);
  });
  it('inline formatting inside a bullet', () => {
    expect(parseMarkdown('* **x**')).toEqual([{ t: 'ul', items: [[{ t: 'bold', children: [{ t: 'text', v: 'x' }] }]] }]);
  });
  it('empty input is no blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/ai-markdown.test.ts`
Expected: FAIL — cannot resolve `markdown`.

- [ ] **Step 3: Create `markdown.ts`**

```ts
/**
 * Tiny, dependency-free markdown → AST parser for the assistant pane. Deliberately a LIMITED subset
 * (bold/italic/inline-code, ATX headings, bullet lists, paragraphs); everything else is literal
 * text. It NEVER produces or interprets HTML — the AST carries only plain strings, and the renderer
 * maps them to React elements, so React escapes any literal angle brackets (no XSS). Robust to
 * partial markdown mid-stream: an unclosed/unmatched marker is emitted as literal text, never throws.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'code'; v: string };

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'ul'; items: Inline[][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[*\-+]\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  const pushText = (): void => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < text.length) {
    const c = text[i];
    // inline code: `...`
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) { pushText(); out.push({ t: 'code', v: text.slice(i + 1, end) }); i = end + 1; continue; }
    }
    // bold: **...** or __...__
    if ((c === '*' || c === '_') && text[i + 1] === c) {
      const marker = c + c;
      const end = text.indexOf(marker, i + 2);
      if (end > i + 1) { pushText(); out.push({ t: 'bold', children: parseInline(text.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    // italic: *...* or _..._  (skip when it's a double marker — that was an unclosed bold)
    if ((c === '*' || c === '_') && text[i + 1] !== c) {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1) { pushText(); out.push({ t: 'italic', children: parseInline(text.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    buf += c;
    i++;
  }
  pushText();
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let bullets: string[] | null = null;

  const flushPara = (): void => {
    if (para.length) { blocks.push({ t: 'p', children: parseInline(para.join('\n')) }); para = []; }
  };
  const flushBullets = (): void => {
    if (bullets && bullets.length) blocks.push({ t: 'ul', items: bullets.map((b) => parseInline(b)) });
    bullets = null;
  };

  for (const line of lines) {
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    if (h) {
      flushPara(); flushBullets();
      blocks.push({ t: 'h', level: h[1].length, children: parseInline(h[2]) });
    } else if (b) {
      flushPara();
      (bullets ??= []).push(b[1]);
    } else if (line.trim() === '') {
      flushPara(); flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return blocks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/ai-markdown.test.ts`
Expected: PASS (12 assertions across the two describe blocks).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/ai-assistant/markdown.ts test/ai-markdown.test.ts
git commit -m "feat(ai): safe in-house markdown parser for the assistant pane"
```

---

## Task 2: `ai.formattedOutput` setting + Settings checkbox

**Files:**
- Modify: `src/shared/types.ts` (the `ai` settings type + its default)
- Modify: `src/renderer/modules/settings/SettingsModule.tsx` (checkbox)

- [ ] **Step 1: Add the type field**

In `src/shared/types.ts`, in the `ai: { ... }` settings block (after `defaultSystemPrompt: string;`, around line 364), add:

```ts
    /** Render assistant replies as formatted markdown (bold/italics/bullets/headings) instead of
     *  raw text. Default true; off shows the plain raw text. */
    formattedOutput: boolean;
```

- [ ] **Step 2: Add the default**

In the same file's default settings object, in the `ai: { ... }` block (after the `defaultSystemPrompt` default, around line 542), add:

```ts
    formattedOutput: true,
```

- [ ] **Step 3: Add the Settings UI checkbox**

In `src/renderer/modules/settings/SettingsModule.tsx`, after the System prompt `<textarea>` block (around line 368), add:

```tsx
        <label style={{ alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={s.ai.formattedOutput}
            onChange={(e) => void patch({ ai: { ...s.ai, formattedOutput: e.target.checked } })} />
          Formatted assistant output (bold/italics/bullets)
        </label>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: OK (the new required field is present in the default, so existing settings construction still satisfies the type).

- [ ] **Step 5: Run the full settings/store tests to confirm no shape regression**

Run: `pnpm exec vitest run test/settings.test.ts`
Expected: PASS if such a file exists; otherwise skip — the whole-branch suite covers it. (A defaults-shape test, if present, must still pass with the new field added to the default.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/modules/settings/SettingsModule.tsx
git commit -m "feat(ai): add ai.formattedOutput setting (default on) + Settings toggle"
```

---

## Task 3: `MarkdownView` component + AiAssistantModule integration

**Files:**
- Create: `src/renderer/modules/ai-assistant/MarkdownView.tsx`
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`

- [ ] **Step 1: Create `MarkdownView.tsx`**

```tsx
/**
 * Renders the assistant-pane markdown AST as React elements. No dangerouslySetInnerHTML — all text
 * is rendered as React children, so any literal HTML in model output is escaped (no XSS).
 */
import type { ReactNode } from 'react';
import { parseMarkdown, type Inline } from './markdown';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return <span key={i}>{n.v}</span>;
      case 'bold': return <strong key={i}>{renderInline(n.children)}</strong>;
      case 'italic': return <em key={i}>{renderInline(n.children)}</em>;
      case 'code': return <code key={i} style={{ fontFamily: 'monospace', background: '#eee', padding: '0 2px' }}>{n.v}</code>;
    }
  });
}

export function MarkdownView({ text }: { text: string }): JSX.Element {
  const blocks = parseMarkdown(text);
  return (
    <div style={{ fontSize: 13 }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return <div key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 6px' }}>{renderInline(b.children)}</div>;
          case 'h':
            return <div key={i} style={{ fontWeight: 'bold', fontSize: b.level <= 2 ? 15 : 14, margin: '4px 0 2px' }}>{renderInline(b.children)}</div>;
          case 'ul':
            return <ul key={i} style={{ margin: '0 0 6px', paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 2: Read the formatted setting in `AiAssistantModule.tsx`**

`useSettings` is already imported (used in the `onChunk` handler). Add a render-time subscription near the top of the component (with the other hooks):

```tsx
  const formatted = useSettings((s) => s.settings?.ai?.formattedOutput ?? true);
```

And add the import at the top with the other module imports:

```tsx
import { MarkdownView } from './MarkdownView';
```

- [ ] **Step 3: Conditionally render assistant messages**

In the `messages.map(...)` block (around line 582), replace the single line:

```tsx
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{m.content}</pre>
```

with a conditional — assistant messages render formatted (when the toggle is on); user messages and the toggle-off case keep the raw `<pre>`:

```tsx
            {formatted && m.role === 'assistant'
              ? <MarkdownView text={m.content} />
              : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{m.content}</pre>}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 5: Run the markdown test (still green) + commit**

Run: `pnpm exec vitest run test/ai-markdown.test.ts`
Expected: PASS.

```bash
git add src/renderer/modules/ai-assistant/MarkdownView.tsx src/renderer/modules/ai-assistant/AiAssistantModule.tsx
git commit -m "feat(ai): render assistant replies via MarkdownView when formatting is on"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `pnpm typecheck` — OK.
- [ ] `pnpm test` — full suite green (new: `ai-markdown`).
- [ ] Safety audit: grep the new files for `dangerouslySetInnerHTML` (must be absent); confirm no new dependency in `package.json`, no network/IPC added.
- [ ] Manual smoke (operator): ask the assistant something that elicits markdown → bold/italics/bullets/headings render cleanly, emojis show, no literal `**`/`#`; a reply mentioning `<tag>` shows the literal text (not interpreted); toggle "Formatted assistant output" off in Settings → replies show raw text again.

## Parked / out of scope

- Clickable links, tables, code fences, ordered/nested lists (YAGNI for the assistant subset).
