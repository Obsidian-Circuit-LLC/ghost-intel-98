# Dead Cyber Society 98 — v3.14.0-beta.8 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.7 carries forward. This build is the
> **GhostExodus beta.7 field-test fixes**: inbox retrieval that actually surfaces new mail, an EyeSpy
> **Detect format** button that finds a camera's real stream endpoint, and a deeper GeoINT crash fix that
> resets the one poisoned state that survived reinstall — plus on-device error reporting so a stuck map can
> finally be diagnosed. The stable channel remains the last non-beta line; the Tor P2P chat is still
> **pending external audit + FIPS build** — don't rely on it for real adversarial security.

## What's new

### Mail — retrieval fixed
- **New mail now shows up.** You could send a message (even to yourself) but it would never appear in the
  inbox. The cause: the inbox fetched *unseen* messages in oldest-first order and stopped at a cap — so an
  inbox full of unread alerts filled every slot with the **oldest** unread mail and the just-arrived message
  was never retrieved. Sorting by date afterward can only reorder what was fetched. The inbox now fetches the
  **newest messages by IMAP sequence number**, independent of the read/unread flag, so recent mail is always
  present. The unread dot is now driven by the actual `\Seen` flag.

### EyeSpy — Detect format
- **Find a camera's real stream.** Many cameras (insecam-style `http://IP:port/` listings) serve an HTML
  *viewer page* at the root, not a stream — so any kind you picked either showed a broken image or bounced
  to Firefox. Paste the URL and click **Detect**: it probes the host, reads the content type, and — if the
  root is a viewer page — tries a short list of common media endpoints, then fills in the right **kind** and
  rewrites the URL to the actual MJPEG/JPEG/HLS/MP4 stream so the feed plays **inline** on your wall.
- **Bounded by design.** Detect is a user-triggered, **concurrency-capped** probe that reads only response
  headers (it never downloads the stream body), does **not** follow redirects, and stops at a fixed deadline.
  It makes a **direct request to the camera host** — the same egress as actually viewing the camera — and
  deliberately reaches **LAN cameras** (your own network), so it does not route through Tor. It performs no
  scanning, enumeration, or authentication; it only checks a handful of well-known stream paths on the exact
  host you entered. The new egress path cleared an adversarial red-team.

### GeoINT — the crash, and a way to diagnose it
- **Recovery now clears the poison that survived everything.** On some saved states the map still dropped
  straight to the recovery screen on open — and the old recovery (cache purge) couldn't fix it, because a bad
  value persisted in the saved **GeoINT settings**, which survive both reinstall *and* cache-purge. Recovery
  now **resets the GeoINT settings to defaults** in addition to purging the cache, and the module reads its
  settings defensively so a malformed block can't white-screen it on open.
- **The error screen now shows the actual error — on your device.** Previously the recovery screen said only
  "the map hit an error," which gave us nothing to fix. It now displays the real exception message (and a
  collapsible stack), **entirely on-device — nothing is logged, sent, or persisted off the machine** (no
  telemetry, ever). If a map still gets stuck, that text is exactly what's needed to fix it for good.

## Tests
**845 automated tests** (vitest), all green. New coverage: inbox newest-by-sequence fetch + unread-flag
mapping, the EyeSpy detect probe (content-type → kind, viewer-page → endpoint discovery, redirect/scheme
bounds, concurrency cap), and the GeoINT error-boundary error capture.

## Verify the download
Compare the installer's SHA-256 against the value below before running it:

```powershell
Get-FileHash .\DCS98-Setup-3.14.0-beta.8.exe -Algorithm SHA256
```

| Artifact | SHA-256 | Size |
|---|---|---|
| `DCS98-Setup-3.14.0-beta.8.exe` | `935612075174497da84d26b8ec28aeba5f0b18b430c0ec59848cdbf4eaad008c` | 498 MB (521,399,277 bytes) |
