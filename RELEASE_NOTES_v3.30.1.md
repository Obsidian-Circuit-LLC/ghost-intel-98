# Ghost Intel 98 — v3.30.1

**The offline memory fix that v3.28.0 and v3.30.0 were reaching for — now actually complete.** Memory genuinely works offline this time, because the missing piece is finally in the box.

## The bug, and why it took three tries

Memory kept indexing **0 chunks** with `Embeddings: HTTP 404 Not Found (is the "nomic-embed-text" model present?)`. v3.28.0 built a dedicated offline embedding runtime; v3.30.0 fixed the marker it gates on. Both were necessary — and both were **defeated by the same missing thing**: the dedicated runtime spawns `resources/local-ai/ollama.exe`, but **the Ollama runtime binary was never actually bundled into the installer.** The embedding *model* shipped; the *engine to run it* did not. So the runtime never started, embeddings fell back to your own Ollama (which doesn't have the model), and you got the 404.

Every prior fix passed its tests because the tests **mocked the runtime** — none ever checked the real packaged app. This release fixes the actual gap and adds a guard so it can't recur silently.

## What's fixed

- **The Ollama runtime is now bundled** (CPU-only). A new build step ships `ollama.exe` + its CPU runners so the dedicated embedding runtime on port 11435 can serve `nomic-embed-text` **fully offline, independent of your own Ollama.** Rebuild the memory index once after updating (Settings → Q → Rebuild memory index) and it will populate.
- **CPU-only, so the size hit is small.** Ollama's Windows package is ~2 GB, almost all of it GPU runners (CUDA/Vulkan) that embeddings never use. We bundle only the CPU runner set — **~43 MB**, not gigabytes.
- **A build-time guard (`afterPack`) now fails the build** if the embedding runtime, a CPU runner, or the model blobs aren't in the packaged app — so "shipped without the engine" can never happen quietly again.

## Verified

- The bundled model blobs were confirmed to load and return a real 768-dim embedding via the exact `OLLAMA_MODELS` + `/api/embeddings` path the app uses.
- The packaged installer was confirmed (by the new `afterPack` check) to contain `ollama.exe` + a CPU runner + the model blobs.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.30.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `44466a1455e9a9a5fd538cf0976c70bc23dbfda99f2c01d819912dae9e061584`
- **Size:** 917,677,176 bytes (~918 MB; +~12 MB over v3.30.0 for the CPU-only Ollama runtime).

*Everything from v3.30.0 carries forward. If memory still shows 0 chunks right after updating, hit Settings → Q (AI Assistant) → Rebuild memory index once — the engine status there now reports honestly whether the model is loaded.*
