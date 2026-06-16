# Dead Cyber Society 98 — v3.14.0-beta.10 (BETA)

> ⚠️ BETA — for functional testing. Big release: GhostExodus's beta.9 field-feedback batch
> PLUS a full GeoINT reimagine (3D MapLibre globe + command-center + live threat layers).

## What's new

### GeoINT — reimagined as a 3D command center
- **3D MapLibre globe** replaces the flat map (toggle back to flat in-app). _Leaflet is retained as a fallback this release; the globe is the new runtime default._
- **Command-center rail:** Global Threat View, Monitored Situations (corroboration clusters), Visual Imagery, Situation Feed.
- **Live threat layers** (toggle in the Threat Layers panel; all behind the off-by-default GeoINT network gate):
  - Free/no-key: USGS earthquakes, GDACS disasters, GDELT-DOC (country-level news signal), war-tracker (unverified social-OSINT + maritime), ReliefWeb (humanitarian, country-level; needs a ReliefWeb-registered appname), UCDP (conflict — now needs a free UCDP token).
  - Keyed (your own free/paid key, stored in the OS keyring): NASA FIRMS fires (MAP_KEY), gdeltcloud (key), UCDP (token).
  - **CISA KEV** advisory sidebar (non-map vulnerability ticker).
  - Each layer is honestly labeled by authority (authoritative / chatter / unverified-OSINT) and shows attribution.
- **JSON Feed** source type + feed images — paste RSS/Atom/JSON feeds from any bridge (RSS.app, RSSHub, Bluesky, Mastodon, Google News, CVE feeds, X-via-bridge).
- **Live News panel:** HLS (e.g. Bloomberg) + YouTube (sandboxed), user-managed playlist.
- "Play story" dwell set to 5s.

### DialTerm — local shell (opt-in, default off)
- Run a local cmd/PowerShell terminal. Enabling requires a native confirmation dialog (not a silent toggle). _The shell ships dark/feature-flagged — the native terminal backend is packaged in a follow-up Windows build._
- Custom host ports (ports survive protocol changes).

### Mail
- Fixed the "You've got mail" chime (now uses the proven audio loader; Settings has a Test button).
- Opt-in background mail poller — get the chime + a Win98 toast even when the Mail window is closed.

### EyeSpy
- Unlimited cameras (scrollable, column-configurable wall — no more 3×3 cap).
- "Refresh tiles" button to reload snapshots on demand.

### My Cases / shell
- Category collapse state persists (and defaults collapsed).
- Share/Import buttons moved beneath New/Rename (no more hidden behind a scrollbar).
- Journal Jots / GeoINT / Markets / Jukebox moved from the desktop to the programs menu.

## Security
- Combined red-team pass (4 adversarial reviews). Fixed: a local-shell enable-bypass via settings.update (now native-dialog-gated), a cross-origin redirect credential leak in the shared fetch (credentials now dropped on host change), a broken/leaky shell session-id validator, an EyeSpy wall-persistence truncation, and an RSS coordinate-integrity gap. CR/LF rejected in keyed-layer tokens.

## Known issues (accepted for this beta)
- DNS-rebind TOCTOU in the egress fetch (mitigated by pre-flight resolve; full IP-pinning is a follow-up).
- Live News HLS host validation is add-time-only / IPv6-incomplete (a pasted IPv6/rebind stream URL is a bounded LAN-probe; behind the off-by-default network gate).
- YouTube embed iframe runs allow-same-origin (pinned to youtube-nocookie, host-scoped frame-src).
- `connect-src` is broad (https/http) to support pasteable HLS streams; the real egress control is the GeoINT network gate.
- FIRMS key could appear in an error log (latent; not currently triggered).
- GeoINT globe default is new — Leaflet flat map retained as a fallback (toggle in-app) pending wider testing.

## Tests
~1057 automated tests, all green.

## Verify the download
| Artifact | SHA-256 | Size |
|---|---|---|
| `DCS98-Setup-3.14.0-beta.10.exe` | `5a1c897a723aa084199ea6eb2cd8042336bf5f7c292bc50faaf777a059978364` | 508.0 MB |
