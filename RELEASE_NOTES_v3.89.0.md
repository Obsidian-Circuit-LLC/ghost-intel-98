# Ghost Intel 98 v3.89.0 — HumanDB, a real Spectre bug fix, and External Apps

## HumanDB (was Address Book)

Renamed at your request — the name/title only, your data and files stay exactly where they are.

Added four new categories: **DOB**, **Place of Birth**, **Address**, and **Criminal Record**. All
four are plain free text, same as Notes — nothing is parsed into a structured date or address, and
a Criminal Record entry is your own research note, not a claim the app is making on its own
authority.

Also fixed two layout bugs:
- The empty "select a contact" screen used to read as stray text off to one side. It now shows
  your illustration, centered, with the text alongside it.
- Maximizing the window used to clip the bio picture into the contact list on the left — a 23-pixel
  mismatch between two numbers that should have been one. Fixed at the source; measured before and
  after to confirm it's actually gone (0px overlap now).

## Spectre — the actual bug from your video

You sent a video of Spectre's clearnet toggle "needing refinement." Here's what was actually
happening: when Tor isn't ready, the error told you to "enable clearnet in Settings" — and you
spent the whole video scrolling through every single category in the app-wide Settings window
looking for it. It was never going to be there. The toggle lives on **Spectre's own Settings tab**,
right next to Map Search, inside Spectre's own window.

The error message now says that specifically. Also cleaned up the error popup itself — it was
showing raw Electron plumbing text ("Error invoking remote method...") in front of the actual
reason; now it just shows the reason.

## External Apps

Your idea, built: a button opens a Programs folder, you drop any `.exe`/`.bat`/`.cmd` in (or a
folder with the app's own `app.json` describing it), and it shows up in a new **External Apps**
section of the Access menu — launch it directly, or open a "Manage Programs" window to see
everything with its description. Nothing runs on its own just by sitting in the folder; every
launch is you clicking Launch.

One judgment call worth flagging: the folder lives in your user data folder rather than the
install directory. Program Files isn't writable after install without admin rights, and this way
an uninstall or reinstall never wipes programs you've dropped in. `.ps1` scripts aren't supported
yet — running them safely needs more care than this pass took on.

## Under the hood

- 724 test files, 5,480 tests, zero failures; typecheck clean.
- Everything above was verified against evidence, not guessed — the layout fixes were measured
  live in the packaged app before and after, and the Spectre bug was diagnosed by watching your
  video frame by frame rather than assuming what "needs refining" meant.

## Installer

`GhostIntel98-Setup-3.89.0.exe` — 946,921,339 bytes
SHA-256 `8c04e45fc80141795d8546ea74123910bb7fa6c67d42b7ed004b0bf5db9bb3bd`
