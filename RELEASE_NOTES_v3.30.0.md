# Ghost Intel 98 — v3.30.0

**The assistant's memory works offline again — the 0-chunks bug is fixed at the root — plus honest engine status, visible failures, the finished "Q" rename, an in-chat web-search toggle, and an operator-authorized clearnet fallback.**

Six items, all from GhostExodus's field report. The headline is the memory fix: memory had gone completely empty — Mind's Eye blank, "➕ Add to memory" a no-op, **0 chunks indexed** — and it's fixed at the root, not patched over.

## What's new

- **Memory 404 fixed at the root.** The dedicated offline embedding runtime shipped in v3.28.0 was gated on the *chat* model marker (`MODEL_PRESENT`), but the installer ships only the *embedding* marker `EMBED_MODEL_PRESENT` (the chat model is your own Ollama). So the gate was always false in production, the dedicated `nomic-embed-text` runtime on port **11435** never started, and embeddings silently fell back to your chat Ollama — which doesn't have that model → **HTTP 404 → 0 chunks → empty Mind's Eye → dead "➕ Add to memory"**. The embed runtime now gates on the **embedding** bundle, so memory runs on the bundled model, offline, independent of your chat Ollama — exactly as v3.28.0 intended. Memory becomes independent of what happens to your own Ollama, so a purge/reinstall can't break it again.
- **Honest embedding-engine status.** Settings previously showed "Embedding engine: ready" even while every embed 404'd, because the check only pinged the server, not the model. It now verifies `nomic-embed-text` is actually loaded and reports **"model not loaded"** when it isn't — so the status tells the truth.
- **Visible failures.** Embed failures on "➕ Add to memory" and background auto-index used to be silent. They now surface a **plain-language, actionable error** ("the offline embedding engine isn't loaded — open Settings → Rebuild memory index") instead of a no-op.
- **The "Q" rename is finished.** The Access (Start) menu now reads **Q** (it was still "AI Assistant"), with a migration so **existing installs** relabel on update too — not just fresh installs.
- **In-conversation web-search toggle.** A compact **"Web (Tor)"** checkbox now lives in the chat toolbar, reachable mid-conversation, instead of only in Settings.
- **Operator-authorized clearnet fallback (off by default).** When a Tor search returns nothing *and* you've explicitly enabled "Allow CLEARNET fallback" in Settings, Q may fall back to a plain-clearnet DuckDuckGo query. **Tor-first always**; the onion path is never weakened.

## Security / charter

- **Clearnet is hard-gated and Tor-first.** The clearnet path (`searchWebClearnet`) is a **separate** function from the Tor onion search; the onion path stays `.onion`-enforced and fail-closed and is byte-for-byte unchanged. Clearnet runs **only** when `webSearchClearnet` is on **and** the Tor search returned zero results — it is unreachable when the flag is off (default). A **red-team pass proved** both invariants: clearnet cannot run with the flag off, and clearnet results cannot bypass the injection fence.
- **Clearnet is never silent.** Every clearnet query prints an unmistakable **"⚠ Tor search returned nothing — falling back to CLEARNET… your real IP is exposed to these results and their hosts"** line in the chat stream, emitted before the query runs — independent of what the local model chooses to say.
- **Untrusted results, one fence.** Clearnet results pass through the **same** unforgeable per-request fence + newline-strip + URL-sanitize as Tor results — no injection bypass.
- **No new egress beyond the opt-in clearnet path.** Embedding traffic is loopback-only (127.0.0.1). No telemetry, no phone-home.
- **Settings-merge safe.** The new `webSearchClearnet` field is covered by the deep-merge upgrade path, so an upgrade can't drop it (the v3.24.0 data-loss class of bug).
- **2,619 automated tests** green (1 skipped); `pnpm typecheck` clean across both project configs. Built subagent-driven with a parallel adversarial whole-branch review — **0 confirmed findings**.

## Note for GhostExodus

If memory still shows 0 chunks after updating, open **Settings → Q (AI Assistant) → Rebuild memory index** once; the engine status there will now tell you honestly whether the model is loaded. Voice *input* still requires the operator-supplied Vosk model in `resources/vosk/` — speak-aloud (TTS) works without it.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.30.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `a4224bde809aa3e8d1fcb4ddff10decf3365ccc406f060b0eff0d447509eaead`
- **Size:** 906,358,876 bytes (~906 MB; bundles the offline embedding model + Ollama runtime, Tor, Piper voices, ML-KEM libs).

*Everything from v3.29.0 (Q rename, one-tap voice, Tor-routed web search) carries forward.*
