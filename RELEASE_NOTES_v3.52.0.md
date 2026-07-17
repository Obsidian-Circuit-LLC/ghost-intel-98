# Ghost Intel 98 — v3.52.0

**Report editor polish: a sane descriptor popup, a flexible recipient, a real signature, and a document that grows.**

Six fixes and one feature from GhostExodus's continued testing of the Report Template editor.

## What's fixed

- **The right-click descriptor/introduction popup behaves now.** It used to open two overlapping menus and land off-screen (following your clicks, appearing out of view). Root cause: the right-click both opened the descriptor menu *and* bubbled up to open the block menu, and the menu's `position: fixed` was broken by the document page's zoom transform. Now a single menu opens right where you click and dismisses on an outside click.
- **Dropped images no longer have a huge white margin, and they resize on their corner.** The image's frame now hugs the image instead of spanning the whole column, so the white band is gone and the resize handle sits on the image's actual corner (and the drag tracks the pointer correctly relative to the page width).
- **The document grows with your content** instead of stopping at one screen. It was pinned to the viewport height by a flexbox quirk; now the page extends downward as you add content and scrolls normally.

## What's new

- **The "To" recipient is a combobox.** Pick a saved contact from the dropdown *or* just type a recipient name — whichever you use is what appears on the report (structured contact block, or the plain name). This restores free-typing alongside v3.51.0's contact picker.
- **Draw or upload a signature.** The report signature is now the same signature pad as the invoice module — draw with your mouse or upload an image — and it renders as an actual image in the PDF and DOCX exports (not just a line of text). The old text signature still works.
- **Upload a report image from your computer.** The "Import from case" photo dialog now also offers **upload from computer**, alongside the case photos (the toolbar "+ Photo" button already did this — now the picker does too).

## Under the hood

- All changes are renderer/CSS/wiring plus one model field (`signatureRef`, carried through the report, the save/create-template paths, and both exporters with validators). No new dependency, no new network egress. The v3.50.2 typing fix and v3.51.0 font-picker/recipient-contact work are untouched.
- Built subagent-driven over 6 TDD tasks with a parallel adversarial whole-branch review that caught + fixed a resize-calibration regression the image-frame change introduced.
- **3,656 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.52.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `09b4e283e357298383394d9846d3ee9018e2cbea1d562dfb04cbe1f34a8d082e`
- **Size:** 960,207,753 bytes (~960 MB).

*Everything from v3.51.0 and earlier carries forward.*
