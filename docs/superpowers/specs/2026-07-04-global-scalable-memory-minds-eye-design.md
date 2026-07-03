# Global Scalable Memory + Mind's Eye — Design Spec

**Date:** 2026-07-04
**Status:** Design (awaiting operator review → implementation plan)
**Origin:** GhostExodus field feedback (relayed by operator). He wants the AI Assistant's
memory to work across all conversations (not confined per-tab), to ingest uploaded documents
into one retrievable pool, and to be shaped through a visual node-graph ("Mind's Eye") — the
Flowise connector graphic he remembered was the *visual* inspiration, not a tool to integrate.

---

## Goal

One always-on, encrypted, offline memory pool the AI recalls across every conversation, case,
and uploaded document — reliable by default — surfaced through a Mind's Eye graph the user can
both read and reshape.

## Success criteria

1. A fact stated in one conversation tab is recalled in another, out of the box, with no manual
   rebuild and no per-tab confinement.
2. The Memory panel never silently sits at "0 chunks": embedding failure is visible and
   actionable, not masked as success.
3. A document uploaded into the assistant is recallable from any conversation once indexed.
4. The Mind's Eye shows the real pool as a graph and lets the user pin/forget, merge, resolve
   conflicts, and draw/cut association links — with chat remaining the primary interface.
5. A user-drawn association link measurably changes recall (the two endpoints travel together).

---

## Background: the root-cause bug

The memory substrate shipped in v3.26.0 (loopback-Ollama `nomic-embed-text` 768-dim embeddings,
encrypted shards, cosine top-k, self-updating profile, transparency panel) is architecturally
sound and **its retrieval is already global** — `ai.ts` calls `recall(query, {k:6})` with no
case filter, and `retriever.ts` scans every case shard plus the conversation shard. Conversations
are already indexed as a first-class `'chat'` source.

The observed failure ("6 cases · 0 chunks indexed", no cross-tab recall) is **not** tab-scoped
retrieval. Its root cause: the bundled `nomic-embed-text` (staged by `scripts/fetch-embed.mjs`
into `resources/local-ai/models`, shipped as `extraResources`) is only visible to Ollama when the
app **spawns its own bundled Ollama** with `OLLAMA_MODELS` pointed at the bundled dir
(`local-ai.ts:97-98`). GhostExodus runs his *own* Ollama (`huihui_ai/qwen3.5-abliterated:4B`);
the app reuses that already-running instance, whose model store has no `nomic-embed-text`. Every
`embed()` call throws, every reindex writes a 0-chunk shard, and nothing surfaces the failure.

The fix (below) is to stop coupling embeddings to the user's chat runtime, and to make embedding
failure loud instead of silent.

---

## Decisions locked in brainstorming

- **One combined spec** — memory engine + Mind's Eye designed together.
- **Mind's Eye = see + shape** — a graph view *plus* active curation (pin/forget, merge, resolve
  conflicts, draw/cut association links). Chat stays the primary interface.
- **Memory scope = global by default, focus on demand** — one pool across all conversations,
  cases, and uploaded docs; recall crosses cases freely. The "Case context" selector is demoted
  from a recall scope to an opt-in *focus* narrowing. Uploaded docs live in a global library, not
  tied to a case.
- **Embedding reliability = dedicated embedding runtime (Approach 1)** — chat uses the user's
  Ollama untouched; embeddings are served by the app's own bundled Ollama + bundled
  `nomic-embed-text` on its own loopback port. Rejected: provisioning on the user's Ollama
  (auto-pull = clearnet egress, charter tension; prompt = memory dark until acted on) and
  injecting the bundled blob into the user's store (mutates it, couples to Ollama's on-disk
  layout).

---

## Architecture

Three layers over the existing `src/main/services/memory/` substrate (reused, not rewritten).

### Layer 1 — Dedicated embedding runtime

**New:** `src/main/services/memory/embed-runtime.ts`. Ensures the bundled Ollama + bundled
`nomic-embed-text` is up on its own loopback port (independent of the user's chat Ollama on
11434; steps to the next port if taken). `embeddings.ts` is repointed from the shared/user
endpoint to this runtime. Exposes a health state — `ready | starting | unavailable` — surfaced
in the Memory panel.

Consequence: embeddings never again depend on what the user pulled; chat and his abliterated
model are untouched; fully offline, no new egress.

### Layer 2 — Robust, default-on indexer

- One master "Memory" switch, **default on**, replacing the scattered gates
  (`useMemory && provider==='ollama'`, `useMemory && autoReindex`) that currently leave the pool
  dark.
- A failed embed **raises visible status and leaves the prior index intact** — it never
  overwrites a good shard with an empty one.
- The save→reindex lag is closed so a turn typed in one tab is recallable in another within
  seconds, not only after a manual "Rebuild memory index".
- Retrieval itself is unchanged (already global) — this layer only ensures there is content to
  retrieve.

### Layer 3 — Global memory pool + Mind's Eye

The pool gains a case-independent document library (below) and the Mind's Eye surface (below).
Query-time data flow is unchanged in shape: assemble system prompt → inject focused case context
*iff* a focus is set → global RAG recall over the whole pool → profile/summary → stream from the
user's chat Ollama — the one behavioral change being that recall now reliably has content.

---

## Global document library & upload-into-chat

**Store:** `src/main/services/memory/library/` — an encrypted `library.json` manifest (via
`secure-fs`) recording each doc `{docId, title, addedAt, sourceKind, bytesHash, mime, charCount}`.
Extracted text is chunked and embedded as a first-class source kind `'doc'` in its own library
shard, alongside case and conversation shards. Because retrieval scans all shards unfiltered, an
uploaded doc is recallable from any conversation the moment it is indexed — no retrieval change.

**Ingestion reuses existing extraction:** `pdfExtract.ts` (pdfjs, offline, no OCR), the main-side
byte-capped/binary-rejecting text reader, and `mammoth` for DOCX (present, currently only wired
into the doc-viewer). v1 formats: **PDF, plain text, Markdown, DOCX**. Binary/unparseable files
are rejected with a clear message, never embedded as garbage.

**Upload surface:** a net-new "➕ Add to memory" control in the AI Assistant (file picker +
drag-drop onto the chat) → extract → chunk → embed → library shard → one-line confirmation
("Indexed 'report.pdf' — 42 chunks") → the doc appears immediately as a Mind's Eye node. Uploaded
docs are global by default.

**Also folded in:** Briefcase notes and journal entries are auto-indexed through the same
extract→embed→shard path (they are trivial once the library path exists and are currently not
indexed at all).

**Boundaries (YAGNI):** v1 is upload + extract + index + recall + show-in-graph + remove
(delete a doc's chunks and manifest entry). No OCR for scanned images, no re-chunk-on-edit, no
per-document ACLs.

---

## Mind's Eye — the curate/steer surface

`src/renderer/modules/minds-eye/`, opened from the AI Assistant "Memory" button (upgrading the
list-style transparency panel to a graph). Reads via a new `memory:graph` IPC (nodes + edges);
mutations via curation IPC.

**Nodes** — memory items, colored by kind: profile *facts*, *document* nodes (one per
uploaded/briefcase/journal doc, expandable to chunks), *conversation* nodes (a summary per past
tab), *entity* nodes (people/orgs/handles). Size/brightness encodes strength/confidence; badges
for pinned and conflict.

**Layout** — deterministic topic-clustering from embedding proximity (the star-chart hulls of the
mockup, now driven by real vectors). **Seeded positions, no `Math.random`. SVG/DOM only** (canvas
rendered black on GhostExodus's mobile last round).

**Edges** — faint *auto* edges (semantic similarity above a threshold + shared-entity links,
visual only) and bold *manual* association edges the user draws (semantics below).

**Shaping actions**, all one-click with instant feedback (GhostExodus ADHD-UI constraint — low
friction, one clear next action, non-nagging): **pin** / **forget** (delete node + its chunks),
**merge** two duplicates into one, **resolve conflict** via a "one thing to fix" tray surfacing a
*single* contradiction at a time, **draw/cut** an association edge, and **click a node → recall it
into the current chat** (the bridge back to conversation). Clusters collapse/expand so the view
never overwhelms; an empty pool shows an inviting empty state, never a void.

---

## Association edge semantics

A manual edge between memory A and B is a **retrieval bond** — it makes them travel together at
recall time. After base cosine top-k is computed, any node bonded to a node that landed in the top
results gets a **fixed score boost**, enough to ride into the injected context even if the query
did not match it directly. This is the user *teaching* an association the embeddings do not
already capture.

Three limits keep it safe and deterministic:

- **One hop only** — a bond cannot cascade transitively and drag the whole graph in.
- **Fixed boost, stable tie-breaks** — same ordering rules as the rest of recall (charter
  determinism).
- **Undirected** — a bond means "these belong together", not a direction. Cutting removes it.

Distinctions: **merge** collapses duplicates into one node; a **bond** keeps them separate but
linked. **Auto** similarity edges do *not* boost (cosine already handles obvious similarity);
bonds exist for the non-obvious associations only the user knows. Bonds are stored in the graph
store (encrypted); auto edges are computed, not stored.

**Feedback loop:** when a node rides in via a bond, the transparency/provenance line reads
"recalled via your link", so the user sees his teaching fire. v1 bonds are **binary** (drawn =
fixed boost); tunable per-edge weights are deferred.

---

## Error handling

- **Embedding runtime down:** Memory panel shows it with a retry; chat still works without memory;
  a failed embed raises status and leaves the existing index intact (no empty-shard overwrite).
- **Port collision:** the embedding runtime binds its own loopback port and steps to the next if
  taken; never collides with the user's Ollama on 11434.
- **Upload extraction failure:** reject unparseable/binary with a clear per-file message; the rest
  of the batch continues.
- **Corrupt shard:** skipped and logged, not fatal (retrieval already loads shards defensively).
- **Empty memory in the Mind's Eye:** an inviting empty state ("nothing remembered yet — start
  chatting or add a document"), always rendered in SVG/DOM.

## Migration

Existing case/conversation shards stay valid; the library shard and bonds are additive. A one-time
reindex populates the pool now that embeddings actually work — progress-reported, resumable,
**non-destructive** (never wipes real content; the affected user's shards are empty anyway).

## Determinism & charter

- Both runtimes loopback-only; **no new egress**; no telemetry.
- All shards (library + bonds included) encrypted at rest via `secure-fs`.
- Seeded layout, stable cosine tie-breaks (score desc, id asc), fixed bond boost, deterministic
  chunk boundaries → same query + same pool ⇒ same evidence and same graph layout.

## Testing

- **Node suites:** embed-runtime ensure/health (mocked spawn); embeddings repoint to the bundled
  endpoint; indexer **raises-not-empties** on embed failure; freshness (a turn is indexed
  promptly); library ingest round-trip PDF/text/MD/DOCX through mock `secure-fs`; briefcase/journal
  indexing; bond boost (one-hop, bounded, deterministic order); focus-narrowing via case context;
  curation mutations (forget deletes chunks; merge; resolve-conflict).
- **Rendering:** headless Playwright computed-style harness asserts the Mind's Eye renders
  non-black on a mobile viewport, in both empty and populated states.
- **Charter pair:** no-egress assertion with memory enabled (only loopback traffic); determinism
  double-run diff.
- Embeddings mocked in CI; one `describe.skip` live-Ollama integration test.

---

## Out of scope (tracked separately as a fast side pass)

- Voice: collapse the existing two-button voice into one latching PTT/hands-free toggle
  (`AiAssistantModule.tsx`) + ship/instruct the operator-supplied Vosk model. The full Vosk STT +
  Piper turn-taking controller already exists; this is UX + the model file.
- Rename the in-app assistant to "Q".
- Web-search skill: a separate charter decision (Tor-routed only via existing `torFetch`; clearnet
  is off-charter). Explicitly **not** part of this spec.

## Open items for the implementation plan

- Exact embedding-runtime lifecycle (persistent second Ollama vs. on-demand ensure) and port
  selection strategy — decided at plan time against `local-ai.ts` spawn code.
- Whether the Mind's Eye is a panel in the AI Assistant window or its own module surface.
- Version bump — set at plan time.
- Build via the ultracode subagent-driven pattern (sequential implementers on a shared tree +
  adversarial whole-branch review), ordered: engine → library → Mind's Eye → bonds.
