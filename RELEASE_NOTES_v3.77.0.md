# Ghost Intel 98 — v3.77.0

**Display pictures, honest follower reporting, and the logon screen you drew.**

## Display pictures

Found it, and it was one line's worth of omission in an unlikely place.

When a capture finishes, each post is rebuilt into the artifact that actually gets stored. That rebuild copied the author's name across but never the author's picture — so every freshly scraped post arrived in your station with no picture reference at all. The store had a field for it. The capture just never filled it in. That is why the pictures survived on your migrated data and vanished on everything you scraped after the purge: the old data was carried over whole, the new data went through the rebuild.

The picture is attached before the evidence hash is computed and deliberately excluded from it, exactly as the display name already is, so nothing about evidence integrity moves. There's a test for that specifically — it captures a post twice, once with a picture and once without, and fails if the hashes differ.

## Followers and following

I have not fixed this one. What I've fixed is it lying to you about it.

The extraction step was throwing away the reason it stopped and returning a plain zero, which reads on screen exactly like "this account has no followers." Blocked by X, rate-limited, window closed, never ran — all of it came out as an empty list. It now writes the reason into the collection run log, raises it as a background error, and hands it back to the panel.

So the next time you run it, it will tell you what actually happened. Send me what it says and I'll have something to work with — right now I genuinely don't know which of those it is, and guessing has cost us releases before.

## The logon screen

Built to your sketch: **WELCOME** and the badge on the left, a divider, the password prompt and buttons on the right.

One honest note — the artwork in your mockup is a chrome hex "G" wordmark, and that isn't a file I have. What's on the left is the badge the app already ships. The layout is yours; the picture is ours. If you send me that PNG it's a one-line swap.

Also checked in both themes rather than assumed: in Quiet Amethyst the token that gives the classic screen its Windows navy is redefined as a near-black *surface*, so WELCOME would have been dark-on-dark and effectively invisible. It gets the amethyst accent instead. Measured contrast is 8.8:1 classic, 5.0:1 amethyst.

## Quieter in the background

Closing the WebSDR window within a second of opening a receiver left a re-layout loop running with nothing to lay out — up to forty frames of it, after the module was gone. Nothing was visible on screen and the receiver was already torn down properly, so this never showed up as a bug; it just meant the app was doing work for a window that no longer existed. It stops with the window now.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.77.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `PENDING`
- **Size:** `PENDING`

Confirm **Settings ▸ About** reads **3.77.0**.
