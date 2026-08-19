# Ghost Intel 98 — v3.72.4

**Display pictures: the app now tells you why.**

Three releases in a row shipped a display-pics fix that changed nothing you could see. This release fixes the reason for that.

## What was actually wrong

Every avatar pass ran in the background and **threw its own result away**. A blocked security gate, an empty list of accounts, a per-run cap, and a failed fetch all looked exactly the same from the Entity Index: monograms, no message, nothing to report. So every attempt at fixing it — mine and the ones before — was a blind swing at an invisible target.

## Fixes

**A FETCH DISPLAY PICS button in the Entity Index.** It runs the picture passes right then, in the foreground, and reports what happened in plain words: how many it fetched, that everything already had one, that there was nothing to fetch yet, that it visited profiles but could not read a picture from any of them (X may have shown a login or challenge page), or that it was blocked — and by what.

**The blocked-by-acknowledgement case is now named outright.** The app uses a stricter rule for picture fetching than for capture: capture only needs clearnet switched on, while picture fetching needs clearnet switched on **and** the real-IP exposure acknowledged. An install where clearnet was enabled but that acknowledgement never got recorded will capture happily while every picture fetch quietly falls back to requiring Tor — and refuses when Tor is not running. If that is your situation, the message says so and offers an **ACKNOWLEDGE CLEARNET** button to resolve it. The acknowledgement is never set for you: consenting to expose your real IP is your decision, not a bug fix.

**Pictures now appear without reopening the module.** The avatar map was only ever re-read when you opened the module or switched campaigns, so even a fully successful fetch could leave monograms on screen until you went away and came back.

## Honest status

This release is **not** a claim that display pictures now work on your machine — it is a claim that when they do not, the app will tell you which link is broken instead of leaving you to guess. Press the button and read the sentence; that sentence names the cause.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.4.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `497d87c4f1bf8aeac42fafcb468d4f785515a79f48a08c8203c49c49965c9470`
- **Size:** `945,156,824 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.72.4**.
