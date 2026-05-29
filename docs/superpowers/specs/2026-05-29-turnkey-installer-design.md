# Ghost Access 98 — Turnkey Local-AI Installer (design)

**Date:** 2026-05-29
**Status:** Approved (brainstorm) — pending implementation plan
**Tracking:** task #29
**Builds on:** v3.0.0 (shipped). AI Assistant already speaks to Ollama (`127.0.0.1:11434`)
or any OpenAI-compatible endpoint; `ai.provider` defaults to `none`, so today the user must
install Ollama and pull a model by hand. This feature removes that setup friction.

## Goal

Make local, offline AI in Ghost Access 98 "just work" with no manual Ollama setup, via two
distribution tracks the user chooses between, on Windows / Linux / macOS.

## Decisions (locked during brainstorm)

1. **Dual release.** A fully-bundled offline track AND an online-fetch track.
2. **Default model:** Llama-3.1-8B (Q4_K_M GGUF), redistributed under the Meta Llama 3.1
   Community License (compliance obligations below).
3. **Platforms:** Windows x64, Linux x64, macOS x64 + arm64.
4. **Runtime lifecycle (hybrid):** reuse an existing responsive Ollama if present; otherwise run
   our own **managed, loopback-only child process**. We never install a system service → no admin.
5. **Online wizard model selection:** fixed to Llama-3.1-8B for v1 (a model menu is a later
   enhancement, explicitly out of scope here).

## Artifacts

| Track | What ships | Size | Network |
|---|---|---|---|
| **Online** | Existing per-platform GA98 app installers (unchanged size) + a new in-app "Set up local AI" wizard | small | one-time fetch, user-consented |
| **Bundled-offline** | Per-platform **combined mega-installer**: app + Ollama runtime + Llama-3.1-8B weights | ~6 GB each | none — air-gapped |

Mega-installer names: `GhostAccess98-AI-Setup-<version>-win-x64.exe`,
`-linux-x86_64.AppImage`, `-mac-x64.dmg`, `-mac-arm64.dmg`. All ship unsigned/un-notarized
initially; macOS documents the Gatekeeper right-click→Open workaround (notarization deferred
until an Apple Developer cert exists — operator decision).

## Architecture

### Component A — `localAi` service (main process, NEW)

The single module both tracks use. One clear purpose: detect/launch/own the local model runtime
and ensure the model is present, all loopback-bound. Public interface:

- `detect(): Promise<RuntimeStatus>` — probe `GET http://127.0.0.1:11434/api/tags`. A 200 means
  an Ollama is already running → **reuse it**, install/spawn nothing.
- `ensureRuntime(): Promise<void>` — if none detected, locate our Ollama binary (bundled under
  `resources/` for the offline track, or the wizard-fetched copy under `userData/local-ai/` for
  the online track) and spawn it as a **managed child**: env `OLLAMA_HOST=127.0.0.1:11434`,
  `OLLAMA_MODELS=<userData>/local-ai/models`, auto-update disabled; wait for readiness; register
  kill-on-`app.quit`. Never binds beyond loopback.
- `ensureModel(): Promise<void>` — if `/api/tags` lacks `llama3.1`: **bundled** → import the
  shipped GGUF via a generated Modelfile (`ollama create llama3.1 -f Modelfile`); **online** →
  `ollama pull` (or fetch GGUF + create), streaming progress.
- `autoConfigure(): Promise<void>` — set `ai.provider='ollama'`,
  `ai.endpoint='http://127.0.0.1:11434'`, `ai.model='llama3.1'` **only if the user has not set a
  custom endpoint/provider** (never clobber a user's configuration).
- `start()/stop()` — explicit lifecycle for the managed child; `stop()` is also wired to app quit.

Depends on: the existing `settingsStore`, the existing `validateAiEndpoint` (loopback for
ollama), and a new pinned-download helper (online track only).

### Component B — "Set up local AI" wizard (renderer + IPC)

Lives in Settings → AI. A small state machine driven by `localAi.status`:

- **existing-runtime** → "Using the Ollama already on this machine." (enable + autoConfigure)
- **bundled-present** (offline installer placed the binary+model) → auto-enable, no prompt.
- **not-present** (online track) → show: download size estimate, **explicit one-time
  network-fetch consent** (same opt-in egress contract as the existing remote-AI path), a
  free-disk-space precheck, live progress, and the "Built with Llama" attribution + license link.
  On confirm → fetch (sha256-verified) → `ensureRuntime` → `ensureModel` → `autoConfigure`.
- **error** → actionable message (no disk, fetch failed/hash mismatch, runtime didn't start).

New IPC (loopback-pinned, validated): `localAi.status`, `localAi.setup`, `localAi.start`,
`localAi.stop`, plus `localAi.onProgress` events. No renderer ever touches the network or fs
directly — all via these typed channels.

### Component C — bundled mega-installer assembly (CI)

GBs cannot go through git, so assembly happens in **GitHub Actions** (`.github/workflows/bundle.yml`),
triggered on a `v*` tag or manual dispatch. Matrix: `{win-x64, linux-x64, mac-x64, mac-arm64}`.
Per job: build the app (electron-vite) → download the **pinned** Ollama release for the
OS/arch and **verify its sha256** → download the **pinned** Llama-3.1-8B GGUF and **verify its
sha256** → assemble via electron-builder `extraResources` (runtime binary + model blobs + license
files) → produce the platform installer → compute + emit its sha256 → upload as a release asset.
Pinned versions + hashes make the bundle reproducible (determinism principle). Runner free disk
(~14 GB) vs ~6 GB artifact is tight; the job prunes intermediate downloads between steps.

The online-track installers (small) build as today (locally or in the same workflow).

## Data flow

First run, online track: user opens AI / clicks Set up local AI → wizard `localAi.status`
returns `not-present` → consent + precheck → `localAi.setup` streams fetch+import progress →
`ensureRuntime` spawns loopback child → `ensureModel` imports → `autoConfigure` → AI Assistant
now works against `127.0.0.1:11434`. Subsequent runs: `detect()`/bundled-present short-circuits
straight to `ensureRuntime` + ready.

Bundled track: installer has already placed binary + model → first AI use detects bundled assets,
`ensureRuntime` + `ensureModel` (import is local) + `autoConfigure`, no network at any point.

## Error handling

- Fetch: sha256 mismatch or truncated download → abort, delete partial, surface distinctly (never
  proceed with an unverified binary/model). Disk-space precheck before download.
- Runtime: spawn failure / port already bound by a non-Ollama process / readiness timeout → clear
  error, leave settings unchanged, no orphan child.
- Model import failure → surfaced; runtime left running so the user can retry.
- Quit during setup → child killed, partial downloads cleaned, no half-state daemon.

## Security & licensing posture

- **Loopback only.** Runtime forced to `127.0.0.1`; red-team asserts no `0.0.0.0`/LAN bind.
- **Single egress** = the user-consented online model fetch; mirrors the existing opt-in
  remote-AI egress contract. No telemetry. No background phone-home.
- **Llama 3.1 Community License** redistribution obligations (bundled track): ship a copy of the
  license, the "Built with Llama" attribution, and reference the Acceptable Use Policy; surface
  attribution in About/AI pane. **Exact obligations to be verified against the primary license
  text before shipping** — not asserted from memory. Include Ollama's MIT license too.

## Testing & verification

- **Unit:** `detect`/`ensureRuntime`/`ensureModel`/`autoConfigure` with mocked HTTP probe + child
  spawn; fetch integrity (sha256 mismatch → abort); `autoConfigure` never overrides a user endpoint.
- **Headless:** wizard state machine across all states; hybrid detection both paths
  (existing-runtime vs spawn-child).
- **Red-team:** loopback-only binding, fetch source/integrity pinning, no orphan child on quit,
  auto-config non-clobber.
- **Manual / platform:** real **offline air-gap** test of the bundled installer on the operator's
  Windows box (disconnect network, confirm the model answers); Linux/macOS best-effort. CI dry-run
  of `bundle.yml` for one platform before the full matrix.

## Top risks

1. Mega-installer size (~6 GB) vs GitHub Actions runner disk (~14 GB) — **stock GitHub-hosted
   runners are confirmed** (no self-hosted). The job must prune aggressively (delete the source
   GGUF/runtime downloads once assembled, free the toolcache/`/opt` space GitHub provides) and
   stream uploads. If a single job can't fit, split assembly across steps/artifacts rather than
   moving off GitHub-hosted runners.
2. Offline GGUF→Ollama import path (`ollama create` from a bundled blob) — validate early; it is
   the crux of the air-gap promise.
3. macOS notarization friction (unsigned) — documented workaround until a cert exists.
4. Llama 3.1 license compliance — verify obligations against primary text.
5. Hybrid runtime = two code paths (reuse vs spawn) — both must be tested.

## Out of scope (v1)

- Model menu / multiple bundled models (fixed to Llama-3.1-8B).
- Code signing / macOS notarization.
- GPU-runner tuning beyond what the upstream Ollama build ships.
- The monetized theme marketplace and other deferred items.
