# Ghost Intel 98 — v3.76.0

**Right-click Cut/Copy/Paste everywhere, and the report rails give the page its space back.**

## Right-click now works on text fields

Anywhere you can type — a case title, a note, a search box, the report editor — right-click gives you **Cut, Copy, Paste, Select All**. This was simply missing: the framework the app is built on provides no menu of its own for text fields, so right-clicking an input did nothing at all. In a tool that leans this hard on feeling like Windows 98, that was a conspicuous gap.

Items grey out the way Windows does: Cut and Copy need something selected, Cut and Paste need a field you can actually type in, Select All needs something to select. A greyed item stays on the menu rather than vanishing, so the menu is always the same shape and you stop having to read it after the first few times.

**One deliberate exception: password fields don't offer Cut or Copy.** Your master password and your recovery key are both typed into one of those, and putting either one keystroke away from the system clipboard — where every other program on the machine can read it — isn't a trade worth making for convenience. Paste still works, so a password manager is fine.

Your existing right-click menus are untouched — the ones on Web Links and Entities in the case manager still do their own thing.

## Libraries and Descriptor Preview are narrower

Both rails in the report editor were wider than they needed to be and were eating room the document wanted. They've come in to give roughly 84 pixels back to the page you're actually writing.

I measured rather than eyeballed it: the widest thing either rail has to hold is the "Introductions…" button, so there's a hard floor below which the buttons would start getting clipped. The new width keeps a comfortable margin above it, and there's a check that fails the build if anything in those rails ever overflows.

## Still waiting on

Two of the four things you asked for came with screenshots that didn't make it through — the *"make it appear more like this"* one, and whether the right-click Copy/Paste was meant somewhere specific rather than everywhere. Send those and I'll finish them off.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.76.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `d3decb078478ad27a73d5cd80fa9f8b56db24b0bd22afbd46e55e9824b6b4d65`
- **Size:** `945,165,691 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.76.0**.
