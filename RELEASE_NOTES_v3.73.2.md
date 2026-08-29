# Ghost Intel 98 — v3.73.2

**The app stops wearing the X Listening Station's clothes — and you get to pick the button colour on purpose.**

## The gold buttons, the unreadable fields, the font bug, the squashed Case Manager

All four were one bug, and it was mine.

Your X Listening Station is embedded as *your* app, which is the point — but your stylesheet was written for a standalone program, so it styles things by their type: "every button", "every text box", "every heading". Once your app was living inside Ghost Intel 98, those rules applied to **the whole application**, not just your station. That's where the gold buttons everywhere came from. It's also why text in input boxes went unreadable (your dark field styling landed on light panels), why the Settings dropdowns showed boxes instead of letters, and why the Case Manager folded in on itself at its default size.

Your file has not been touched — it's still byte-for-byte your original, which is the whole point of embedding it. It's now *fenced in* so it can only style your station and stops at its edge. Inside, your app looks exactly as it should. Outside, the rest of Ghost Intel 98 goes back to normal.

I've also added the test that should have existed: it loads your stylesheet and the app's together in a real browser and checks your styling reaches your station and nothing beyond it. Given the unfenced version, it reproduces all three of the visible symptoms you reported — so this can't come back silently.

## You liked the gold, so now you can have it deliberately

Fencing your stylesheet takes the look away again, and you were right about why it mattered: *"when things look flat, you end up getting lost when you're on a race against time"*.

**Settings ▸ Theme** now has a **Button colour** picker: choose any colour, **Reset to default** puts back the classic Windows face, and **Save preset** keeps a swatch — click a saved swatch to use it, right-click to remove it. The buttons keep their raised Win98 edge, so a custom colour still looks like a button rather than a flat block.

One thing I decided rather than asked: the *text* colour on the buttons isn't a separate setting, it's worked out from the colour you pick — dark text on a light button, light text on a dark one. You've just spent a week with unreadable text caused by exactly that mismatch, and a picker that let you set a dark button and keep dark text would be a way to recreate that on purpose.

## Also

The case photo, the campaign carry-over and the display pictures from v3.73.1 are all working in your videos — your Live Feed, Network Intelligence and Common Followers all show real collected data, which means the carry-over did its job.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.73.2.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.73.2**.

> **Still open — WebSDR.** I've had no new detail on this one and I'd rather ask than guess: does the receiver spill *outside* its window over other windows, come up blank, or only break when you resize it? Those are three different causes and your answer picks one.
