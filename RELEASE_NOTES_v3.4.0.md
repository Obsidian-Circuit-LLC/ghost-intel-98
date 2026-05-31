# Ghost Access 98 — v3.4.0

Adds **offline voice conversation** to the AI Assistant — talk to it and have it talk back, fully
on-device — and ships the fixes from a dedicated red-team pass over the new surface.

## TL;DR

- **New: voice conversation (offline).** Speak to the AI and hear replies aloud. **Push-to-talk**
  (hold to talk) and **hands-free** (mic stays open; it listens, answers, and speaks while you
  read the case). Speech-to-text is **Vosk running on-device** — chosen because the browser's
  built-in recognizer streams audio to the cloud, which this app won't do.
- **No cloud.** STT is local Vosk; the spoken reply uses your **on-device** OS voices (cloud
  voices are refused); voice turns send case **metadata** context only.
- **Operator-supplied model.** Drop a Vosk `model.tar.gz` into `resources/vosk/` (see
  `resources/vosk/README-VOSK.txt`). Until then, voice input is disabled with guidance; text chat
  and speak-aloud (TTS) work without it.
- **Hardened:** a two-agent red-team pass over the voice surface (0 Critical) — mic permission
  scoped to audio + the app window only, mic-leak and double-start paths closed, voice streams
  made cancellable.

## New: voice conversation

In the AI Assistant, a voice strip offers **🎙 Hands-free** and **🎤 Push-to-talk**. The turn-taking
loop is: listen → transcribe (Vosk, offline) → send to your AI provider → speak the reply (offline
TTS) → resume listening. The microphone is **paused while the AI is thinking and speaking** so the
assistant never transcribes its own voice into a feedback loop. Push-to-talk and hands-free share
one engine; hands-free is the "leave it running while I study the files" mode.

## Security (red-team pass over the voice surface, 2026-05-31)

Two adversarial agents, **0 Critical**. Fixed:

- **Microphone permission** is now explicitly scoped — granted only for **audio**, only to the
  **main app window**, via both a request and a check handler. A blanket grant (which the naive
  fix would have introduced) is avoided, and the now-unused in-app `<webview>` is disabled so no
  other context can reach the mic.
- **Mic lifecycle** — the mic track is released if audio setup fails after the grant, a double-click
  during model load can no longer start two recognizers, and the model load has a timeout.
- **Cancellation** — Stop-voice (and closing the window) now aborts the in-flight voice request;
  a stray error can't wedge the conversation.
- **No new egress** confirmed: Vosk is self-contained (no CDN), the model is served locally, and
  the spoken reply stays on the hardened on-device TTS path.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.
- The voice end-to-end (mic → recognition → speech) requires the Vosk model present and a working
  microphone — verify on your machine.
- Built on the full v3.3.0 base (Bookmarks, Firefox launcher, offline TTS, the v3.2.x modules,
  encrypt-at-rest).

---

**Artifact:** `GhostAccess98-Setup-3.4.0.exe` (~122 MB, NSIS, x64, unsigned)
**SHA-256:** `5b07e4040dd632c6ea49c7c0222a1ee6b16b31a41a6f5a0f83e730533a3dd822`
