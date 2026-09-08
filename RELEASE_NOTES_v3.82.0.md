# Ghost Intel 98 v3.82.0 — the station explains itself

Read this part first, because it's the honest answer.

## I did not find a bug this time

I checked three specific ways v3.81.0 could have stopped collection, and killed all three:

- The profile-snapshot work I added runs **after** the posts are saved and inside a catch, so it
  cannot lose a capture even if it fails.
- The images fix reads the **same** setting your screen displays, so it can't disagree with what
  the toggle says.
- The new code I imported is type-only, so it can't break startup.

I'm not going to invent a fourth explanation. The last three rounds punished exactly that.

## What I think is actually going on

"Not scraping, no display pictures" has now meant three completely different things: a records file
the station never reads, a page being read before it had loaded, and a follower scraper you'd
already replaced. All three produced an identical-looking symptom, and each round cost a release to
identify.

So the problem isn't only the bugs. It's that a report of the symptom can't tell us which one it is.
That's what this release fixes.

## The station now reports its own state

When a collection runs and comes back with nothing — or comes back with findings and no pictures —
the app writes a short account of itself and shows it to you, instead of saying "Collection sweep
complete." Copy it into a message and it answers, in one paste, what I've been guessing at for three
rounds:

```
Ghost Intel 98 v3.82.0 — X Listening Station diagnostic
Campaign: Operation Midnight
X session — cookie: connected · capture window: none
Egress — Tor: disconnected · clearnet opt-in: on
Images — campaign: ON · @exodusghost ON · @dcs_vortex OFF (off)
Findings: 55 · sources: 2
Findings with a picture: 0 of 55
Follower/following rows: 0 · entities: 0 · change events: 0
Last 6 collection run(s), newest first:
  posts @exodusghost — ok · observed=0 added=0 passes=5 · stable_end
```

Three lines there are worth the whole release:

**`Findings with a picture`** separates *the pictures were never captured* from *the pictures are
stored and something isn't showing them*. Those are opposite bugs with opposite fixes, and more than
one release has gone to the wrong one. It splits three ways: already cached, fetched but not yet
localised, or never seen at all.

**`capture window: none`** is a trap this project has hit before. Your session cookie survives a
restart, so the screen says SESSION CONNECTED while this campaign has no window to actually capture
through.

**`Images — @dcs_vortex OFF (off)`** matters because until v3.81.0 that per-source switch did
nothing. If you ever clicked it and saw no effect, it's now being honoured for the first time — and
a source set to OFF collects no pictures, correctly and silently. The report names any source in
that state.

## One thing to check before anything else

The diagnostic states the running build. Please confirm it says **3.82.0** after installing.

This project has already shipped an installer that left a stale install in place (v3.70.1 exists to
fix exactly that), and "reverted to a previous state" has an unglamorous explanation worth ruling
out first: it may literally *be* a previous state. Nothing in the app has ever told you which build
you're running. Now it does.

## Under the hood

- 710 test files, 5,360 tests, 1 skipped, zero failures; typecheck clean.
- The diagnostic is a pure function with no clock, no I/O — everything it reports is passed in, and
  it is capped so it stays pasteable.
- It stays quiet on a healthy sweep, and quiet when you have deliberately turned pictures off.
