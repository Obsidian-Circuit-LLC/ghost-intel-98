# Dead Cyber Society 98 — v3.14.0-beta.7 (BETA)

> ⚠️ **BETA — for functional testing.** Everything from v3.14.0-beta.6 carries forward. This build is the
> **GhostExodus beta.6 field-test punch-list**: a GeoINT crash-recovery + Purge fix, reachable Mail Send,
> auto-fitting Bookmarks, an EyeSpy webpage stream kind, Cases categories, and UI polish. The stable channel
> remains the last non-beta line; the Tor P2P chat is still **pending external audit + FIPS build** — don't
> rely on it for real adversarial security.

## What's new

### GeoINT
- **Crash-proof + a way out.** A bad source (e.g. a NASA FIRMS GeoJSON URL with an unreplaced `{MAP_KEY}`,
  or an oversized feed of tens of thousands of points) could crash the whole map module — and it survived
  delete *and* reinstall because the state persists in the vault. Fixed three ways: the map now tolerates a
  poisoned/huge cache (single-pass time bounds instead of a call-stack-overflowing spread, a 1,500-marker
  cap with a visible "showing X of N" banner, per-marker guards), an **error boundary** wraps the whole
  module with a one-click **"Purge GeoINT cache & reload"** recovery, and a **Purge cache** button lives in
  the Sources panel. Removing a source no longer orphans its cached items.
- **Default map tiles** switched to Google road tiles (per request) so the map fills in immediately when you
  enable the network. Still fully gated — nothing is fetched until you turn the GeoINT network on.
- **Play Story controls float over the map.** The ▶ / ⏸ / ⏹ transport now overlays the map (top-center)
  during a story instead of sitting below it where it was easy to miss.

### Mail
- **The Send button is always reachable.** Compose (and Account setup) now cap to the viewport and scroll
  their body, so Send / Save draft / Cancel never fall below the fold on a short window.
- **30-second** silent background refresh (was 2 minutes), so new mail — and the new-mail chime — arrives
  quickly during testing.

### Bookmarks
- **Cards auto-fit their links.** Category cards grow and shrink with the number of links again. A stray
  interaction (scrollbar drag, reflow) used to silently freeze a card at a fixed height; that's gone, and
  any already-frozen card from a previous build self-heals on load.

### EyeSpy
- **Webpage stream kind.** A camera's HTML viewer page (e.g. `…/view/index.shtml`) isn't a media URL, so it
  rendered blank under the existing kinds. The new **Webpage** kind opens it in the bundled, process-isolated
  Firefox — saveable and categorizable in EyeSpy like any other stream. (We deliberately do **not** embed
  arbitrary third-party pages inside the app.)
- **Toolbars never scroll off.** The Finder's **Import** button is pinned and both EyeSpy toolbars wrap on a
  narrow pane, so the controls stay reachable.

### Cases
- **Categories.** Separate your work — group cases into named, collapsible categories (e.g. *opChildSafety*
  vs other initiatives) instead of one flat pool. Right-click a case → **Move to category…** (typing a new
  name creates it); rename a category from its header. Cases with no category fall under **Uncategorized**.

## How to test (in-house)

1. Install on Windows (**More info → Run anyway** — unsigned; verify the SHA-256 below first).
2. **GeoINT:** add a deliberately-bad source (e.g. the FIRMS URL with `{MAP_KEY}`), Refresh → the module
   stays alive; hit **Purge cache** to wipe state clean. Enable the network → the Google basemap fills in.
   Play a story → the transport floats over the map; pause/stop it.
3. **Mail:** open Compose on a short window → Send/Cancel are reachable; leave it on an account → new mail
   arrives within ~30s and chimes.
4. **Bookmarks:** add/remove links in a category → the card grows/shrinks to fit.
5. **EyeSpy:** add a `…/index.shtml` camera as the **Webpage** kind → it opens in Firefox; confirm Import is
   reachable without scrolling.
6. **Cases:** right-click a case → Move to category; collapse/rename a category.
7. Re-confirm beta.6 items (the GeoINT map, the EyeSpy wall, Mail).

## Known limitations

- **Windows x64 only**, **unsigned** — SmartScreen will warn.
- Tor P2P chat crypto is formally modeled but **external audit + FIPS build are still pending**.
- GeoINT default tiles are Google's; switch the tile server in the Network panel if you prefer another.
- GeoINT shows at most 1,500 markers at once (with a count banner) to stay responsive on huge feeds.

## Verification

`typecheck` clean · **810 automated tests** green (new Cases-category + GeoINT-timeline regression suites).
The GeoINT hardening and the EyeSpy webpage kind each went through an adversarial red-team pass before
merge — the red-team caught a real one: the first crash-fix wrapped the wrong layer (the crash was a
call-stack overflow *above* the error boundary), and an in-app iframe approach for the webpage kind would
have punched an app-wide hole in the renderer CSP that the plugin trust model depends on; both were fixed.
The map feel, the EyeSpy wall, Mail, and the installer on a real Windows box are exercised by **your** run.

---

**Artifact:** `DCS98-Setup-3.14.0-beta.7.exe` (SIZE_BYTES bytes ≈ SIZE_MB MB, NSIS, x64, unsigned; Tor + Piper + offline AI models bundled)
**SHA-256:** `PENDING_BUILD`
