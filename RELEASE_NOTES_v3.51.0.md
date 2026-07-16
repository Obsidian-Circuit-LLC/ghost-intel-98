# Ghost Intel 98 — v3.51.0

**Report editor follow-ups: font pickers that actually apply, and a proper structured recipient.**

Two fixes to the Report Template Generator from GhostExodus's field testing.

## What's fixed

- **The font-family and font-size pickers work now.** Choosing a font or size did nothing — the native dropdowns stole focus from the editor and lost your text selection before the change could apply (which is also what "some functions have no response" was). The editor now snapshots your selection the moment you open a picker and restores it, so the font/size lands on the text you had highlighted — the same trick the working Bold/Italic/Underline and link buttons already use. Typing, B/I/U, alignment, lists, links, and export are unchanged.

## What's new

- **The recipient is now a real contact, not just a name.** Previously the report's "To" was a single plain text field while the sender was a full contact. Now the recipient uses the same **Contact** structure the sender does — pick or add one through the Contact book popup with **Organization, Name, Title, Email, Phone, and Address**, for both sender and recipient. The structured recipient renders into the **PDF and DOCX** exports just like the sender block. Existing reports with a plain "To" line still export exactly as before.

## Under the hood

- The font fix mirrors the report editor's existing selection-snapshot pattern (no change to the v3.50.2 typing/text-body fixes). The recipient contact (`toContactId`) carries through the report **and** the save-as-template / create-from-template paths, with validators on both.
- **3,626 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs. No new network egress; no new dependencies.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.51.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `e5dee293f0f8326b6e3e1e9899ba2dfec09db99027a9be70726e2e0d39d73364`
- **Size:** 960,206,503 bytes (~960 MB).

*Everything from v3.50.x and earlier carries forward.*
