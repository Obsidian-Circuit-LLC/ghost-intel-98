# Ghost Intel 98 — v3.70.1

**Installer fix: updating from an older build now reliably replaces it.**

This is an installer-only patch. The app itself is identical to v3.70.0 (the X Listening Station Enterprise rebuild, module banners, and custom boot screen).

## What changed

Some over-installs of v3.70.0 didn't actually replace the previous version — the new files installed, but an older build kept launching (so the X Listening Station still showed the old 7-tab "clearnet-quarantined" screen instead of the Tor-default, 11-tab, campaign-managed rebuild). Two installer hardening changes fix that:

- **Fixed install location** — the installer no longer offers to change the install directory, so an update always lands on top of the existing install instead of orphaning it in a second folder.
- **Closes a running instance first** — the installer force-closes a running Ghost Intel 98 before writing files, so the old renderer/main can't stay locked and survive the update.

**If you were stuck on an older build:** install this over it (or, to be certain, uninstall the old one first, then install this). Confirm **Settings ▸ About** reads **3.70.1**. The X Listening Station should then show the campaign dock, a TOR badge with a clearnet opt-in, and 11 tabs.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.70.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `f4e88d2321f3c813b88946e396c6d776a66c12850d891728d4f36ba2fae22cbf`
- **Size:** 944,299,605 bytes (~901 MB).

*Everything from v3.70.0 carries forward unchanged.*
