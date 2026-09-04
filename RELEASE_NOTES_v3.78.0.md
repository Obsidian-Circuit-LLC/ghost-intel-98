# Ghost Intel 98 — v3.78.0

**Your logon artwork, a way to delete a text box, and the Enter key finally working.**

## The logon screen

Your mockup had the artwork inside it, so I lifted it straight out of the image rather than approximating it — the hex-G mark and the GHOST INTEL 98 wordmark on the screen are now yours, not the badge the app happened to ship.

Cutting it off the grey background needed a little care: the wordmark's lettering is chrome, which is *also* grey, so keying out the colour would have punched holes through the letters. It's cut by flooding transparency in from the edges instead, which leaves the lettering untouched and lets the artwork sit on either theme's dialog.

## Removing a text box

You found a real gap. Photos and tables have always had a remove button; text boxes never did — the delete function was sitting there in the editor and had simply never been wired to them. An accidental **+ Text** was permanent.

**− Remove text** now sits right next to **+ Text**. It removes the box your cursor is in, and it asks first, because it deletes writing and writing is the one thing in a report that can't be rebuilt from the case file. If you haven't clicked into a box yet the button greys out and tells you why rather than guessing which one you meant.

## The Enter key

You were right, and it's a better catch than it looked.

Pressing Enter in a text box wraps the new line in a `<div>`. The report editor cleans every edit through a strict allowlist before saving, and `div` isn't on that list — so the cleaner *unwrapped* it, and the line break went with it. Two sentences got welded into one: `First sentence.Second sentence.`

So the break wasn't being lost on export. It was being lost the moment you typed it, before the report was ever saved. The export never had anything to lose, which is why the editor looked fine on screen and the exported file didn't.

It also explains your workaround precisely. A second Enter leaves behind an empty line whose break *is* on the allowlist, so it survived on its own. One Enter vanished; two left one. You'd found the exact shape of the bug without being able to see it.

Fixed at the point of loss: those line wrappers are turned into real paragraphs before cleaning, so nothing new gets past the allowlist and the break survives. The editor now writes the same markup it stores, and the editor and the PDF use identical paragraph spacing — what you see while typing is what comes out.

**One thing I can't fix:** reports written before this update lost those breaks when they were saved. That text is already stored without them, and there's no way to tell where you pressed Enter after the fact. New writing is fine, and you can stop double-spacing.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.78.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `2f058bc67b8f527bec30a8c76362db731ff0cacb508ed45d8ed1f415e9db3904`
- **Size:** `945,197,423 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.78.0**.

> Still open from your last report: followers/following. v3.77.0 didn't fix it — it made it tell you *why* it stopped instead of reporting an empty list. Whatever it says now is what I need.
