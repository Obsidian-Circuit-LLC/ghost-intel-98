# Ghost Intel 98 v3.81.0 — everything, in one release

You said fix everything and fold it into one release. This is that. Seven things, six of which you
hadn't reported yet because there was no way for you to see them.

## 1. Follower and following rows have pictures

The blank circles in the follower network. The collector always read each account's picture off the
page, and the code immediately threw it away — it accepted only pictures that had already been
downloaded, which for a freshly scraped follower is never. So those circles could not have shown
anything, ever.

They now keep the picture's address and fetch it the same way posts already do — through the
hardened cache, over your session, stored encrypted. Addresses pointing anywhere other than X's own
image hosts are still refused, and a picture still can't affect a record's evidence hash. Both of
those are covered by tests.

## 2. ENTITY INDEX works

It has been reading 0 against 55 findings, and that wasn't bad luck — nothing in the app had ever
written an entity. The extractor was there the whole time and was simply never called. Mentions,
hashtags, emails, links, addresses and phone numbers now index as findings arrive, counted once per
post so an archive cycle can't turn one mention into a pattern.

## 3. CHANGE INTEL works

Same story. Every collection now records a snapshot of the source's profile, and when the display
name, bio, picture, location or website actually changes you get one **profile metadata changed**
entry. The first snapshot is a baseline and raises nothing — a change needs something to change
from.

## 4. The follower network keeps its own history

Newly-seen and no-longer-seen accounts, and a record of each scan, now land where you can see them.
This also gives each scan a previous scan to compare against, which it never had — every scan was
being treated as the first one.

A "no longer seen" entry stays deliberately cautious: it only appears when the new scan went at
least as deep as the last one, so a shallow scan can't invent a story about someone unfollowing you.

## 5. IMAGES: OFF now actually turns images off

This is the one I'd want to know about. That switch was writing to your campaign and the collector
was reading a different setting entirely — one that defaults to on. So turning images **off** kept
fetching them. A privacy control that quietly does nothing is worse than no control, and it was
doing nothing. Both it and the per-source override are honoured now.

## 6. A partly-failed sweep tells you

If two of five sources fail, that used to be announced mid-sweep and then immediately overwritten by
"Collection sweep complete." The summary now arrives after the sweep finishes, so the last thing on
screen is what actually happened.

## 7. Everything from v3.80.0, carried forward

The render-timing fixes ship here too: the page is allowed to load before it's read, the follower
scrape uses your accumulator, and the progress line shows the running count.

## Under the hood

- 709 test files, 5,349 tests, 1 skipped, zero failures; typecheck clean.
- Found by auditing which of your document's thirteen collections are ever **written** rather than
  read. Four of them appeared exactly once outside their initial value: inside a filter that
  deletes rows. Nothing ever added one. Reading the code from the panel's side shows all four
  correctly wired up and tells you nothing.
- Every fix is a test that was watched to fail first.
