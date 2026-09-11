# Ghost Intel 98 v3.88.0 — Spectre's map was rendering at 34 pixels wide

You asked whether I'd actually checked that Spectre renders correctly. I hadn't — and checking
found a real bug, in two modules.

## What "checking" actually meant this time

Every previous verification was: run the automated tests, run the type checker, search the
packaged file for text that proves the code shipped. None of that proves a person can see
something render correctly on screen. So this time I built a way to actually launch the finished
app and look at it — a driver that opens the real installed build in a virtual display and drives
it with genuine mouse clicks, the same way you would.

## What it found

Spectre's map was rendering **34 pixels wide** inside a window nearly 1,000 pixels across. Not
slow to load, not a wrong tile — the space for it had collapsed to a sliver, so it looked like
nothing was there at all.

Tracing it down: the app already wraps every module in its own frame. Spectre's code was ALSO
wrapping its own content in a second, identical frame — a redundant copy left over from how it was
written, copied from the Address Book code. That inner frame has no explicit width of its own, so
without one it shrinks down to whatever its content naturally takes up. Spectre's content is mostly
a map with an empty toolbar above it, so it shrank to almost nothing.

**Address Book had the exact same bug.** It didn't show it as obviously, because a form full of
text fields is naturally wide enough to mostly hide the missing width — but it was still losing
more than half the window, silently, this whole time.

Both are fixed the same way: the inner frame now explicitly claims the full width instead of
guessing from its content.

## Why nothing caught this until now

The automated tests can't lay out a page the way a real browser does, so this exact kind of bug is
invisible to them — they'd stay green whether the map was full-width or a sliver. This release adds
a new kind of test that actually launches a real rendering engine and measures the pixels, which is
the only way this class of bug can be caught before it ships.

## Under the hood

- 717 test files, 5,429 tests, zero failures; typecheck clean.
- The fix is confirmed against the actual packaged installer, not just the source — read back out
  of the built file to make sure it's really there.
- Two dead ends along the way, in case they're useful again: a script that fakes a mouse click
  doesn't open hover-menus (only a real mouse does), and this had nothing to do with the testing
  environment itself — both were ruled out by testing them directly rather than guessed at.

## Installer

`GhostIntel98-Setup-3.88.0.exe` — 945,760,820 bytes
SHA-256 `f7592aa314a6fd85149a9d09d27ec396205e4dee748bf77e73bb964fc970d295`
