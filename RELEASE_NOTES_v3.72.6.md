# Ghost Intel 98 — v3.72.6

**Four field fixes: display pictures on an existing campaign, the GeoINT ×, WebSDR resizing, and GeoINT load.**

## Fixes

**Display pictures now fill in on a campaign you already have.** v3.72.5 started capturing each author's picture from their posts, but a post already in your campaign was skipped wholesale when re-captured — so the picture could only ever appear on posts collected for the *first* time after upgrading. On an established campaign that meant nothing changed. A re-observed post now gains the fields it predates (picture, display name) without touching anything evidential: existing text, metrics, hashes and timestamps are never rewritten, and a value already observed is never replaced. **Your next sweep fills pictures in on the posts it re-observes**, with no extra fetching.

**GeoINT — the × on a Monitored Situation actually removes it.** A situation is listed when other sources corroborate it *or* when you pin it, and the × only un-pinned — so for a corroborated situation (which is most of them) the row simply re-qualified and stayed put, and the button looked dead. Removing a situation is now its own setting: it hides regardless of what put it there, it persists across reopening the module, and it is reversible — a removed situation is hidden, never destroyed.

**WebSDR — the layout can no longer overflow the window when you resize it.** Narrowing the window pushed the receiver area past the window's right edge, taking the embedded receiver with it, because the receiver column was sized to its contents rather than to the space available. The column is now capped to the window, along with four other things that could not shrink: the station-menu column, the menu itself, the frequency field, and the status line's text.

**GeoINT builds map popups when you open them.** Every map pin also built its entire popup up front, even though only one is ever open — a few hundred of them at a busy view. Popups are now built on first open.

## Honest notes

The WebSDR overflow is a *measured* defect, but it is not a reproduction of "the display breaks when resized" — I could not reproduce that symptom itself. Similarly, the popup change removes real waste that scales with the number of events on screen, but it is not claimed as the fix for GeoINT's CPU use: the structural cost is one map element per event, and moving those to a GPU layer is a larger change that is not being rushed into a field-fix release. Your load also included a playing news stream and X Listening's capture windows.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.6.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.72.6**.
