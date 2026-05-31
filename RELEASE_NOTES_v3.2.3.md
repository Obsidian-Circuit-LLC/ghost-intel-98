# Ghost Access 98 — v3.2.3

Adds **GeoINT → case integration** and ships a batch of **security hardening** from a full
red-team pass over the 3.2.x work. Recommended update for anyone on 3.2.0–3.2.2.

## New: GeoINT → case integration

Save a geopolitical event straight into a case from the GeoINT dashboard.

- A **"Save to case…"** action (📁) on each GeoINT event opens a dialog: pick a case, choose
  how to save it — a **saved-event record** (keeps coordinates), a **web link**, or a **note** —
  and optionally link entities.
- If the event has a matched place, a **location entity** is created/linked automatically;
  you can link other entities by hand.
- Saved events show in a new **"GeoINT events"** section on the case, and the save is recorded
  on the case **timeline**.

## Security hardening (red-team pass, 2026-05-31)

A full adversarial review of the 3.2.x surface (0 Critical). Fixed:

- **GeoINT SSRF (High):** source fetches now refuse loopback/private/link-local/metadata hosts —
  on manual add, on OPML import, and on every redirect hop. (Affected 3.2.2.)
- **Save-to-case validation (High):** the event is fully validated at the IPC boundary
  (bounds, coordinate ranges) before touching case/entity stores.
- **Media (Medium):** a malicious `.m3u` can no longer authorize non-audio local files for
  playback; EyeSpy stream URLs are validated; embedded album art is no longer written in the
  clear. (Affected 3.2.0.)
- **Hardening (Low):** local-media reads resolve through the real path; feeds are size/quantity
  capped.

## Notes

- **Unsigned** build — SmartScreen will warn; **More info → Run anyway**. Verify the SHA-256 below.
- Built on the full 3.2.x base (Jukebox, EyeSpy bulk import, GeoINT dashboard, encrypt-at-rest,
  local-AI wizard).

---

**Artifact:** `GhostAccess98-Setup-3.2.3.exe` (~119 MB, NSIS, x64, unsigned)
**SHA-256:** filled in on the release after build.
