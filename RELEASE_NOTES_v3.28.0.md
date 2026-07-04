# Ghost Intel 98 — v3.28.0

**Global scalable memory, on by default, plus Mind's Eye — a visual map of what the assistant remembers.**

The AI assistant's local memory graduates from an opt-in per-conversation feature to a **global, always-on-by-default** system, backed by a **dedicated embedding runtime** (its own bundled, loopback-only Ollama instance, separate from chat) so embedding failures are loud instead of silently degrading to an empty index. Memory now spans a **document library** — anything you upload (PDF/TXT/MD/DOCX), plus your briefcase and journal entries — not just chat history. A new **Mind's Eye** module renders that memory as an interactive SVG graph you can see and shape: pin, forget, merge duplicates, resolve conflicts, recall a node straight into chat, and draw or cut your own **retrieval bonds** between items so related-but-not-lexically-similar memories recall together.

## What's new

- **Embedding-runtime fix.** Embeddings now route through a dedicated, bundled embedding runtime (`embed-runtime.ts`) instead of silently sharing — and sometimes losing — the chat runtime. A failed embed is now a loud, actionable error, never a quietly empty shard; the indexer refuses to overwrite a good shard with an empty one and surfaces failures instead of hiding them.
- **Memory on by default.** `useMemory` now defaults to `true` for new installs; the Settings toggle is relabeled to reflect that memory is the default posture, with an embed-runtime health line and failure surfacing. Existing installs are not force-flipped — the settings merge is additive only.
- **Global document library.** A new library store (manifest + per-document encrypted text) lets you upload PDF/TXT/MD/DOCX documents directly into memory via a renderer-side extraction dispatcher and an "➕ Add to memory" control in the assistant. The indexer now also pulls in your **briefcase** and **journal** entries as first-class memory sources alongside chat and the document library.
- **Mind's Eye.** A new SVG graph surface (`minds-eye`) visualizes the whole memory pool: nodes for chat/profile/library/briefcase/journal items, similarity-based auto-edges, and a deterministic clustered 2D layout — same pool in, same layout out, every time. Curation lives in the graph itself: **pin**, **forget**, **merge duplicates**, **resolve a flagged conflict**, and **recall a node into chat**.
- **Retrieval bonds.** Draw an undirected bond between two memory items directly in Mind's Eye (and cut it later) to teach recall that they belong together even when they aren't lexically similar. Bonds are encrypted at rest, one-hop only, apply a fixed deterministic boost, and every recall hit that used one carries its provenance (`viaBond`) back to the caller.

## Quality / QA

- **2,568 automated tests** passing (1 skipped); TypeScript strict (`pnpm typecheck` clean) across both the node and web project configs.
- **Determinism preserved in every new critical path**: graph layout, similarity edges, and bond-boosted recall all take `now`/ids/rng via injected params — no `Math.random`, no bare `Date.now()` in scoring or layout logic.
- **No new network egress.** The dedicated embedding runtime is the bundled, loopback-only Ollama on its own port (distinct from the chat port); no clearnet, no telemetry.
- **Encrypted at rest.** Library manifest, per-document text, and bonds all persist through the existing `secure-fs` (`secureWriteFile`/`secureReadText`) path, exactly like existing memory shards.
- Out of scope for this release (per the originating spec): voice push-to-talk, the assistant rename, and web-search integration.

## Install

Windows NSIS installer: pending build (this is a docs/version-bump release; the installer artifact is produced and SHA-256-pinned in a separate, operator-gated build step).

*Everything from v3.27.0 carries forward.*
