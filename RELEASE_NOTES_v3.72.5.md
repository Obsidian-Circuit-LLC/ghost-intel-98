# Ghost Intel 98 — v3.72.5

**Display pictures, actually fixed — plus the sweep tells you what it's doing.**

This release came out of a side-by-side video of the original X Listening Station against Ghost Intel 98, and the comparison found things no amount of testing this build alone would have.

## Fixes

**Display pictures work now, and this time the cause was upstream of everything I fixed before.** Three previous releases fixed the picture *fetching*. None of them helped, because the list of pictures to fetch was empty before the fetcher ever ran. The original app stores each author's picture URL on **every captured post** — it reads it straight out of the tweet as it collects — and can therefore show a picture for any account it has ever seen. This build never captured that, so the only pictures it could ever hold were the profile headers of accounts you explicitly targeted; every other account was incapable of showing a picture no matter what else was fixed. Posts now carry the author's picture, and pictures are resolved for any account from everything already collected — profile headers, network rows, and posts, newest first — with **no extra fetching over the network at all**.

**The sweep now says what it is doing.** Pressing Sweep showed "X Listening Station ready." for the entire run. It now announces each target as it is collected — **"Collecting @handle…"** — in both places the original shows it: the banner under the header and the session box in the sidebar, with a position counter on a multi-target run.

**`@@handle` and the `@` avatar circle were the same bug.** Handles are stored with their `@` already attached; the post card added a second one, and used the first character of that same value for the monogram — which is why every picture-less card showed an `@` instead of the account's initial. Fixed, and swept across the whole module this time rather than the single line I had a screenshot of.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.72.5.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `ca508af26124b575845b0363e293f27e15aecea2b79374ff6a48ef0007f54e3b`
- **Size:** `945,158,587 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.72.5**.

> **Note on existing campaigns:** posts captured before this build have no stored picture URL, because the field did not exist when they were collected. Pictures will fill in for accounts as new posts are captured. The **FETCH DISPLAY PICS** button in the Entity Index (added in v3.72.4) fetches what is resolvable right now and reports exactly what it did.
