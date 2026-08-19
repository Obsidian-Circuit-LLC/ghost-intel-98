# Ghost Intel 98 — v3.72.3

**Field fixes for X Listening Station and the embedded views.**

Follow-up to v3.72.2 from GhostExodus's testing. The WebSDR Viewer's waterfall fix held — this release fixes what his testing found next.

## Fixes

**X Listening Station — follower/following extraction works again.** Every **EXTRACT FOLLOWERS / FOLLOWING** press answered *"Another collection operation is already running."* That message comes from the app-wide collection mutex, which exists so only one operation ever reaches out to X at a time. The mutex itself was correct — every operation releases it when it finishes — but every operation also waits on a page load that had **no time limit**, so a single navigation that stalled (routine over Tor: a dead exit, a hanging resource) held the mutex for the rest of the session and disabled all collection until the app was restarted. Page loads are now bounded everywhere, so a stall fails cleanly and releases the mutex instead of hanging. The mutex also names who holds it and for how long, and a holder that stops making progress is now broken rather than wedging the app. **A manual press no longer loses a race with a background sweep** — it waits and tells you what it is waiting for ("Waiting for scheduled sweep (running 47s)…") rather than failing instantly.

**X Listening Station — display pics for mentioned accounts.** Profile pictures were only ever cached for accounts the campaign actually *captured*, so an account that was merely mentioned in a post had no picture to show and could only render a monogram — which is why the Entity Index was all initials. Mentioned accounts' pictures are now primed by visiting their profiles: bounded per run, Tor-gated and fail-closed (nothing opens when Tor is unavailable and clearnet is not acknowledged), and idempotent, so it never re-fetches a picture it already has. A profile with no readable picture is remembered and not re-visited on every sweep.

**Embedded views no longer linger over the desktop.** Minimising the WebSDR window left the receiver — waterfall, controls, audio — painting over the desktop for several seconds, with no window around it. Both the WebSDR receiver and the Ghost Social account tiles are now moved off-screen as well as hidden when their window goes away, so nothing can be left painted over your desktop. These views are drawn by the operating system on top of the app, so hiding them is not enough on its own.

**Smaller things.** The Common Followers / Following pair line showed doubled handles (`@@name ↔ @@name`). Avatar maintenance now runs under the collection mutex — it previously started its own capture window just after the mutex was released, which is the one thing that mutex exists to prevent.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.3.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `8d6a8b6387a1001a36edac95c93f07e96f38bf880d17392706bbe8c6333ab89b`
- **Size:** `945,155,327 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.72.3**.

> **Still owed, honestly:** the follower-extraction fix is inferred from the error you saw plus an unbounded page load — the hang itself was never reproduced here, and the tell was that a restart used to clear it. The desktop-lingering fix is a defence, not a diagnosis: the delayed hide could not be observed on this machine. Both modules write a secret-free `diag.log` under their data folder; if either symptom survives this build, that log names the reason outright (`why=…`) and will close it properly.
