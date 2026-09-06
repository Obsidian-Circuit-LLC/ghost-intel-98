# Ghost Intel 98 v3.80.0 — the two X Listening bugs, found properly this time

You reported the display pictures gone again and the follower extraction still dead. Both are
fixed, and they turned out to be **the same bug in two places**.

First, the correction you're owed.

## v3.79.0 did not fix the follower extraction, and I said it did

I fixed the channel that *reports* a blocked extraction. But your extraction was never being
blocked. It was completing successfully, in about a second, having read nothing — so there was no
failure to report and my fix had nothing to do.

I actually spotted that exact case while building v3.79.0, decided it was unlikely, and left it. It
was the one that mattered. "It can no longer fail in silence" was wrong, and you spent another
install finding that out.

## The real cause: we never let the page load

X renders in the browser after the page arrives. Your own version knows this and waits 3.5 seconds
after opening a page before reading anything. This build waits **zero**, in two places:

**Follower extraction.** It opened the followers list and read it in the same instant — an empty
page. It then scrolled and re-read as fast as the code could run, with no pause at all. After a few
empty reads it concluded the list had ended, and reported a clean, successful scan of zero accounts.
No error, nothing to display, button appears dead. That is the whole bug.

**Display pictures.** The picture comes from the profile header, and the header was being read the
same instant the page opened — before it had drawn. No header, no picture.

That second one also explains "reverted". **Nothing in v3.79.0 touched picture collection** — I
checked the diff line by line. It is a race, so it depends on how fast the page happens to render,
and there are two routes into it: opening a source manually waits for the page (there's a check on
that path), while a sweep does not. Same feature, different route, different result. Which is why it
looked fixed one release and broken the next with nothing in between.

## And one more: we shipped a scraper you'd already thrown away

Your v3.4.1 collects followers with a page-side accumulator, because X *removes* follower rows from
the page as they scroll past. This build was using the older per-pass reader from your v2.3.0 — the
one you replaced for exactly that reason. It only ever saw whatever was on screen at that moment.

Your accumulator is now what runs. A test scrolls three screens of followers past it: the
accumulator keeps all six accounts, the old reader sees only the last two.

## What you'll see now

- **A progress line while it runs** — `Extracting @name — pass 3/9 — 124 unique`, the way yours
  does. A scan takes 10–15 seconds instead of appearing instant; that pause is the fix, not a hang.
- **An extraction that reads nothing now says so**, in plain words, instead of announcing
  completion. It states what happened without inventing a reason for it.
- **The progress bar always clears.** It gates your extract buttons, so a scan that failed without
  clearing left all three disabled — a dead button we could have manufactured ourselves.
- **One more screen of followers per scan.** The loop was doing one fewer pass than yours.

## Still open, and not fixed here

**Follower rows have no pictures**, and won't after this. That is not a regression — the follower
path was built to discard avatar URLs, so those circles have always been blank. Posts and sources
localise their pictures through the cache; follower rows never had that wiring. Say the word and it
is a small, contained job, but I'm not folding it into a bugfix release you're waiting on.

I also can't prove from here that your extraction returns accounts now — that needs your machine.
What I can prove is that it no longer reads an unrendered page and calls the result empty, and that
the progress line will tell you what it found while it's finding it.

## Under the hood

- 708 test files, 5,335 tests, 1 skipped, zero failures; typecheck clean.
- The old tests all passed while this was broken because the fake page returned its rows in the
  first read. Real ones don't. The new tests model a page that renders over time.
- Every finding was checked against a falsifier before it was believed: the picture regression
  against the release diff, the scraper against your v3.4.1 source, the "it's all just Tor-gated"
  theory against the session code that refuted it.
