# Ghost Intel 98 — v3.73.0

**Your X Listening Station is now literally your X Listening Station.**

## X Listening Station — your app, embedded

The module no longer imitates your Enterprise v3.4.1 build. It **is** your build. Your `main.tsx` runs unmodified inside Ghost Intel 98 — your components, your layout, your stylesheet byte-for-byte, your COMMAND BOARD and LIVE FEED and FOLLOWER NETWORK exactly as you triaged them. Five differences exist between the file in this app and the file on your machine, all mechanical: the React bootstrap comes out (it mounts inside our window instead of its own), the stylesheet import is repointed, two now-unused imports go with the bootstrap, your `App` is exported so we can mount it, and one inert line references two memos your `App()` declares but doesn't read, because this project's compiler rejects unused locals and yours didn't.

That is not a promise, it's a test. Your original source ships inside the repository and a fidelity test diffs the embedded copy against it on every single run, stylesheet included. If anyone — me included — ever "improves" a line of your renderer, the build fails. It also checks that your UI still talks only to `window.xls`, so no future edit can quietly reach around the boundary into our internals.

**Your state model came with it.** Your app keeps one document with thirteen collections, and every one of your handlers is written against that shape. Previous releases split it up and re-derived the behaviour, which is exactly why display pictures took five attempts. Your document is now kept as-is, and your handlers are transcribed rather than reinvented — including the details that matter: duplicating a campaign still names the copy "Copy", clones its profiles with fresh counters, and remaps preset targets onto the clones; deleting one still refuses to remove your last campaign and cascades all thirteen collections; a re-observed post gains fields it predates instead of being thrown away.

**What changed underneath, and only underneath.** Your document is encrypted at rest. Every one of your 47 channels validates its caller before doing anything. Collection runs on this app's Tor gate, signed-in guard, bounded navigation and collection lock, so nothing egresses on clearnet unless you've explicitly acknowledged it. Your UI cannot tell the difference; the security posture is entirely ours.

**Three things answer honestly instead of pretending.** Demo data is refused — seeding invented posts into a real campaign can't be told apart from collected material once it's in the document, and it would ride into every export. PDF export is refused with a message, because it renders through your print pipeline which we don't run, and producing a *different* file under the same button would be worse. The Tor toggle reports your posture rather than switching it, because flipping to clearnet is an app-level decision that shouldn't be reachable from inside an embedded page.

The previous port is still in the build but unreachable. If the embed misbehaves on your machine, restoring the old one is a one-line change rather than a re-port. It gets deleted once you've confirmed this works.

## GeoINT — the map got its CPU back

Events were drawn as one HTML element per event, plus a marker object and a popup object each, capped at 1,500. That element count was the map's dominant cost and it grew with your event cache — which is why narrowing the timeline made the load normalise. Events are now drawn by the graphics card from a single dataset: no per-event elements at all. The cap went from 1,500 to 20,000, and "Play story" and Event Details now work for **every** event rather than only the ones that got an element under the old cap.

Everything the old path guaranteed is re-asserted against the new one: no event with a broken coordinate is ever placed, popups are still built from feed text as DOM nodes rather than markup, and clicking a blip still opens its dossier. The CCTV layer deliberately stays as it was — it draws one marker per cluster for the current view, so it was never the thing costing you frames.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.73.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `83aaa4fa1b1354ad93b213f33a8d707c25df1c1c328c721a3e9963c513e27b68`
- **Size:** `945,018,266 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.73.0**.

> **What I need from you on this one.** The embed has never run on a real machine — I have no X session, so the live paths (logging in, a real capture, a follower/following extraction, an export) are exactly the parts no test here can prove. If the station opens and your campaigns are there, that's the boundary working. If something's off, the **CHANGE INTEL ▸ COLLECTION RUN LOG** now records every attempt with a reason, and that's the fastest thing to send me.
