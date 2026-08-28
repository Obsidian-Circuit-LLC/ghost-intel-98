# Ghost Intel 98 — v3.73.1

**Two fixes to v3.73.0's X Listening Station, and the case photo you asked for.**

If you installed v3.73.0, please install this one. Two defects in how I wired your app into Ghost Intel 98 made the station look broken in exactly the ways you reported — neither was anything you did, and neither was your app.

## X Listening Station

**Your campaigns are back.** This is the one I'd most want you to know about. v3.73.0 gave your app its own state document — the right call, it's what your handlers are written against — but I never carried your *existing* campaigns into it. So the station opened on an empty "Primary Campaign" and everything you'd collected looked gone. **It was never gone.** Every post, follower network, note and campaign has been sitting safely on disk the whole time; the new station just wasn't reading them. This build carries them across on first launch, once, and tells the log what it moved.

Two details I was careful about, because a migration that quietly gets them wrong looks like it worked: your target sources are rebuilt from the account each post was *collected from*, never from the post's author — on a reply or repost that's some third party — and follower rows are written in the form your UI actually filters on. Get that second one wrong and your Follower Network reads as empty even with the data present.

**Display pictures work.** They could not have worked in v3.73.0 — not intermittently, not sometimes: never, on any machine. Your app stores each avatar as the web address it read off the page, and I was handing that address to a function that only accepts an already-downloaded local file, so it returned "nothing" every single time. That's the sixth run at this feature and the first where the cause was me porting your model correctly and then breaking the *reading* half. Pictures are now downloaded through your X session (so it still goes over Tor when Tor is on), stored encrypted, and reused — fetched once, not every time you look at them. If you're not connected to X it shows initials rather than reaching for the network some other way.

## Case Manager

**The case photo now appears next to Identity.** The first image you add — or whichever you mark as primary, the same one the case list shows — is displayed beside the Title/Reference/Status fields, so you can see who a case is about without scrolling. It's never stretched or cropped: the whole frame is shown inside a fixed box, so a portrait fills it and a wide photo letterboxes. Cases with no photo look exactly as they do now.

## Still open

**WebSDR.** I've no new information on this one and I'd rather say so than guess. What would settle it fast: does the receiver spill *outside* its window over other windows, come up blank, or only break when you resize? Those are three different causes and the answer picks one.

**RetroSpectrum.** I read it — it's an SDR toolkit, not a CCTV project: no cameras, no stream lists, nothing to bring over. It's also Linux-only C under GPLv3, which can't go into this app without relicensing all of it. Its layout ideas are interesting for the SDR side; the code can't come across. If you meant a different repo for the cameras, send it and I'll look properly.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.73.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.73.1**.

> On first launch, open X Listening Station and check your campaigns are listed. If they are, the carry-over worked. If anything's missing, **CHANGE INTEL ▸ COLLECTION RUN LOG** and the app log will say what it couldn't read — nothing is deleted either way, so a missing campaign is a reading problem I can fix, not a loss.
