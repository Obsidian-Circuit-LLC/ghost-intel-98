# Ghost Access 98 — v3.1.0

Adds the first slice of **turnkey local AI**: a "Set up local AI" wizard that gets a private,
on-device model running for the AI Assistant — no cloud, no data leaving your machine. Everything
stays offline-first and local-only; the model runtime is pinned to `127.0.0.1` (loopback).

## What's in this build (online track)

- **Settings → AI → "Set up local AI"** wizard. It detects a local [Ollama](https://ollama.com)
  runtime, makes sure the `llama3.1` model is installed (pulling it once if needed), and points
  the AI Assistant at it automatically — it won't overwrite a custom provider/endpoint you've
  already set.
- The local runtime is used **hybrid**: if you already have Ollama running, it's reused; the app
  never installs a background service or needs admin.
- Built on the v3.0.0 encrypt-at-rest base — when login is enabled, the local-AI controls require
  an unlocked vault like everything else.

## How to test on Windows

1. Install `GhostAccess98-Setup-3.1.0.exe` (unsigned — SmartScreen will warn; **More info → Run
   anyway**). Verify the SHA-256 first (below).
2. Install **Ollama**: open the app → **Settings → AI → Set up local AI → "Get Ollama"** (opens
   ollama.com/download), run the Ollama installer (one click).
3. Back in the wizard, press **Re-check**. The app will offer **"Install model"** — click it to
   pull `llama3.1` (a few GB, one time, from Ollama's registry).
4. When it reports **"Local AI is ready (llama3.1)"**, open the **AI Assistant** and chat — it now
   runs entirely on your machine.

(If you already have Ollama + a `llama3.1` model, the wizard goes straight to "ready".)

## Not in this build yet (coming)

- **Fully automatic setup** (the app downloading the Ollama runtime for you) and the
  **offline-bundled installer** (app + runtime + model in one file, no internet, air-gapped) are
  in progress — they require a cross-platform CI build with pinned, hash-verified runtime + model
  weights. This release ships the online/bring-your-own-Ollama path, which is the part that is
  fully wired and testable today.

## Attribution

Built with Llama. Llama 3.1 is licensed under the Llama 3.1 Community License, © Meta Platforms,
Inc. Local model runtime: Ollama (MIT).

---

**Artifact:** `GhostAccess98-Setup-3.1.0.exe` (~118 MB, NSIS, x64, unsigned)
**SHA-256:** `55d3fe62583ad8cfe11448c88ad2e02cd3ab26c82dde89897fcf9148842373e6`
