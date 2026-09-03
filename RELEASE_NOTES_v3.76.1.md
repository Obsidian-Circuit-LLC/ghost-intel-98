# Ghost Intel 98 — v3.76.1

**Copy and paste on the right-click menu inside report text boxes.**

You spotted the gap exactly. v3.76.0 added Cut/Copy/Paste to text fields across the app — but not the one place you most wanted it, and that wasn't an oversight so much as a design decision biting back: report text blocks already claim the right-click for the descriptor inserter, and the new menu is built to step aside for anything that already handles the click. So the descriptor menu appeared and the edit options didn't.

They're on **that** menu now. Right-click inside a report text box and you get **Cut, Copy, Paste, Select All** across the top, then your descriptors and introductions underneath as before. They grey out the same way as everywhere else — Cut and Copy need something selected.

## One thing I did carefully

Pasting into a report is the riskiest of the four, so it doesn't take the clipboard at face value. Whatever you paste is treated as plain text and stripped of any markup before it goes in — the same treatment a descriptor's text already gets.

The reason: your clipboard could be holding anything you copied from anywhere, including markup off a scraped page, and reports get exported to PDF, DOCX and HTML. Anything that made it into the document would make it into the exported file too. Line breaks survive so a pasted paragraph doesn't collapse into one line; nothing else does.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.76.1.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.76.1**.

> Still open from your last batch: the *"make it appear more like this"* screenshot never came through, so that one's untouched. Send it whenever.
