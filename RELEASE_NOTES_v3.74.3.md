# Ghost Intel 98 — v3.74.3

**Hotfix: fresh collection was writing your posts into the wrong place.**

## You were right

> *"It may be that it's not scraping at all, but was merely displaying archived or cached scrapes from previous beta tests. I just purged it all, and noticed it's not scraping."*

That's exactly what was happening, and purging is what exposed it. Everything you'd been looking at came across in the migration when the embedded station first shipped. Fresh collection had never been filling your station properly.

When a sweep runs, the collector hands the results over in two forms: the **full record** — the post plus its author picture, its images, its counts and its evidence hash — and a **stripped summary** with none of that. I wired the station to the stripped one. So your posts were arriving with no picture and no images attached, and the full versions, pictures and all, were being filed into the *old* storage that your station doesn't read.

That's the whole "it just needs to grab the images" thing. The pictures were being collected the entire time. They were going somewhere nothing displays.

The station now takes the full record, and the stripped copy is discarded instead of being filed away where nothing reads it.

## Two more image fixes riding along

**Your UI was handing me the picture and I was ignoring it.** When your app draws a row it passes the avatar address it just read off the page. My side only ever looked at what was already saved, so a row that appeared before its record had a picture came back empty — while your app was holding the address the whole time. It's used now, and it still goes through the same host check and the same Tor-routed fetch as anything else: newer doesn't mean less checked.

**Two copies of the same conversion had drifted apart.** Migrated posts were converted properly and kept their pictures; freshly collected posts went through a different path that didn't. That's why old material had images and new material never would have, even after the fix above. There's one conversion now.

## What I'd expect after installing

Add a target, run a sweep, and posts should arrive with author pictures and any attached images. If they arrive but stay picture-less, that's a *different* problem from this one and worth telling me — it would mean the fetch is being refused rather than misfiled.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.74.3.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.74.3**.

> Worth saying plainly: this is the seventh pass at display pictures, and six of the seven have been me re-deriving or half-honouring your app's own model instead of reading it — the field names, the argument list, which of two handover points to use. The tests I added this time assert *your* contract rather than my assumptions about it, which is what I should have done from the start.
