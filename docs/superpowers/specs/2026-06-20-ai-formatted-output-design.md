# AI Assistant Formatted Output — Design

**Date:** 2026-06-20
**Surface:** Ghost Intel 98 core app (`/dcs98`) — AI assistant renderer + settings
**Status:** Approved for planning

## Goal

Render the bundled assistant's replies as real formatting (bold, italics, bullet lists, headings,
emojis pass through) instead of showing raw markdown symbols (`**`, `#`, `*`). Controlled by a
"Formatted output" setting, default on.

## Context (grounding facts)

- The assistant pane renders replies in a plain `<pre>{m.content}</pre>`
  (`AiAssistantModule.tsx:582`) — there is **no markdown renderer**, so `**bold**` and `# Header`
  appear as literal symbols on screen. That is the user's complaint.
- The user's "System prompt" setting (`ai.defaultSystemPrompt`) IS wired into the Ollama call
  (`ai.ts:48`); the local model simply ignores style instructions, so a prompt tweak alone can't
  fix this. The reliable fix is on the render side.
- Output streams in via `onChunk` accumulating into `acc`, flushed to `m.content` ~16 fps
  (`AiAssistantModule.tsx:239-266`). The renderer must handle partial/incomplete markdown
  mid-stream without crashing.

## Approach

A **safe, in-house markdown renderer for a limited subset** — no new dependency, and critically
**no raw HTML / `dangerouslySetInnerHTML`**: the parser produces a small typed AST and a component
maps it to React elements, so any literal `<`, `>`, `&` in model output is auto-escaped by React
(no XSS surface). A new setting `ai.formattedOutput` (default `true`) gates it; when off, the pane
renders raw `<pre>` exactly as today.

### Components

1. **Pure parser** `src/renderer/modules/ai-assistant/markdown.ts` →
   `parseMarkdown(text: string): Block[]`. Unit-tested without rendering.

   AST:
   ```ts
   type Inline =
     | { t: 'text'; v: string }
     | { t: 'bold'; children: Inline[] }
     | { t: 'italic'; children: Inline[] }
     | { t: 'code'; v: string };
   type Block =
     | { t: 'p'; children: Inline[] }
     | { t: 'h'; level: number; children: Inline[] }   // level 1-6
     | { t: 'ul'; items: Inline[][] };
   ```

   Block rules (line-based): a line matching `^#{1,6}\s+` → heading (level = hash count, text after
   the hashes parsed as inline); consecutive lines matching `^\s*[*\-+]\s+` → one `ul` (each item's
   text parsed inline); blank line separates blocks; other runs of lines → a `p` (soft line breaks
   joined with a space, or preserved — preserve `\n` inside a paragraph as a break). Inline rules:
   `**x**` / `__x__` → bold; `*x*` / `_x_` → italic; `` `x` `` → inline code. Unclosed/unmatched
   markers are emitted as literal `text` (robust to mid-stream partial markdown). No HTML is ever
   produced or interpreted — input is plain text in, AST out.

2. **Render component** `src/renderer/modules/ai-assistant/MarkdownView.tsx` →
   `MarkdownView({ text }: { text: string })`: parses and maps the AST to React elements —
   `bold`→`<strong>`, `italic`→`<em>`, `code`→`<code>` (monospace span), `h`→a bolded, slightly
   larger `<div>` (Win98 pane has no real heading scale; level only nudges weight/size),
   `ul`→`<ul><li>` with tidy bullets, `p`→`<div>` with `whiteSpace:'pre-wrap'`. Emojis are ordinary
   text and pass through. No `dangerouslySetInnerHTML`.

3. **Setting** `ai.formattedOutput: boolean` (default `true`) in `src/shared/types.ts` (the `ai`
   block + its default) and a checkbox in `SettingsModule.tsx` near the System prompt
   ("Formatted assistant output (bold/italics/bullets)").

4. **Integration** in `AiAssistantModule.tsx`: read
   `const formatted = settings?.ai?.formattedOutput ?? true;`. For **assistant** messages, render
   `formatted ? <MarkdownView text={m.content}/> : <pre>…</pre>`. **User** messages stay `<pre>`
   (the user typed plain text). The right-click "copy" continues to copy raw `m.content` (the
   markdown source) — unchanged.

## Data flow

Ollama stream → `acc` → `m.content` (~16 fps) → assistant bubble → `MarkdownView` (when toggle on)
→ `parseMarkdown` → AST → React elements. Toggle off → raw `<pre>` (today's behavior).

## Error / edge handling

- Partial markdown mid-stream (`**bo`, a lone `#`) → rendered as literal text; never throws.
- Model output containing `<`/`>`/`&` → escaped by React (text nodes); no HTML injection.
- Empty content → nothing rendered.

## Testing (pure-function, vitest node env)

`test/ai-markdown.test.ts` on `parseMarkdown`:
- plain text → single `p`/`text`; emoji preserved in text.
- `**bold**` → `bold`; `*italic*` → `italic`; `` `code` `` → `code`.
- `# H` / `### H` → `h` level 1 / 3 with the hashes removed.
- `* a` / `- b` consecutive → one `ul` with the items (markers removed).
- unclosed `**bold` → literal `text` (no throw).
- a line containing `<script>alert(1)</script>` → a `text` token carrying the literal string (proof
  the parser never produces HTML; React escapes at render).
- mixed inline within a bullet / heading.

The `MarkdownView` component + the settings checkbox are thin wiring, verified by `pnpm typecheck`
+ the operator's manual smoke (no React render harness in this repo).

## Charter / invariants

- No new dependency, no network, no IPC, no telemetry. No `dangerouslySetInnerHTML` (no XSS surface).
- Default on, but fully reversible via the new toggle.
- Core change → lands on `feat/ai-formatted-output` for the v3.16.0 release.

## Out of scope

- Clickable links / link rendering (URLs render as literal text for now — no egress/CSP surface).
- Tables, code fences with syntax highlighting, nested lists, ordered lists (YAGNI for assistant
  chat; the subset covers the model's common output).
