# Ghost Intel 98 — v3.74.4

**Hotfix: sweeps said "complete" and collected nothing.**

Your video showed it plainly — add `@exodusghost`, run a sweep, get *"Collection sweep complete."* and then LOCAL FINDINGS 0, POSTS 0 · FOLLOWERS 0 · FOLLOWING 0, "No records collected." The images were never the problem. Nothing was being scraped at all, and the app was telling you it had succeeded.

## What was happening

Your X login is remembered independently of any window — that's why the station shows **SESSION CONNECTED** the moment you open it. But collecting needs an actual browser window pointed at the target, and after a restart (or before you've clicked Open Session) there isn't one yet.

The station asked for that window, didn't find one, gave up on that target, and then reported the sweep as finished. Every target failed the same way, so every sweep "succeeded" with nothing to show.

It now opens the window itself when one is missing — **hidden**, so it doesn't throw a Chromium browser in your face mid-sweep, and still routed through Tor exactly as before. If Tor isn't ready it says so instead of quietly doing nothing.

## And it will stop lying to you about it

This is the part that let it hide for three releases. A sweep that reports "complete" having collected nothing looks identical to a sweep that worked on a quiet account. The only explanation was going to a developer console you'll never see.

Now: failed sources are counted and reported in the sweep result, and **each failure is written into CHANGE INTEL ▸ COLLECTION RUN LOG with its reason**. If a sweep comes back empty from here on, that log will tell you why in one look rather than leaving you to guess.

## Honest note

You said this thing would be a pain, and you've been right. This is the fourth attempt at the same underlying complaint, and each time I fixed something real that wasn't the whole story — misfiled results, a dropped argument, a stripped record — while the collection itself was never running. The reason I kept missing it: everything I tested exercised the pieces, and nothing exercised a sweep end to end. The tests added here do, and both fail against the build you're running.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.74.4.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `7674ba7405334c1e9a1cfcbbba13dcf5eccc2f02b2b1c855dc2b85eb82ddee1c`
- **Size:** `945,166,319 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.74.4**.

> Try the same thing you filmed: add a source, RUN SWEEP. If posts come in, the pictures should come with them — that part was fixed in 3.74.3 and never got a chance to run. If it's still empty, **CHANGE INTEL ▸ COLLECTION RUN LOG** now has the reason, and that's the thing to send.
