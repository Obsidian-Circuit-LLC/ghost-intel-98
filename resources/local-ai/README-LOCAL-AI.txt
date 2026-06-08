DCS98 bundled local-AI resources
================================

This directory is populated at BUILD time (not committed to git) and shipped via
electron-builder extraResources to <app>/resources/local-ai/.

Contents (build-host supplied):
  models/                  Ollama model blobs (git-ignored)
  EMBED_MODEL_PRESENT      marker written by `pnpm fetch:embed`

Embedding model (vector memory)
-------------------------------
`pnpm fetch:embed` (scripts/fetch-embed.mjs) pulls the pinned embedding model
`nomic-embed-text` into ./models using a throwaway Ollama server, fully offline
thereafter. The app's bundled Ollama serves /api/embeddings against it on
127.0.0.1 for the offline Case Memory feature. No network egress at runtime.

The Ollama runtime binary and the chat model (llama3.1) are staged by the
separate local-AI installer task and are not produced by fetch:embed.
