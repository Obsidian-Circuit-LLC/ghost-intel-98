# Ghost Intel 98 v3.84.0 — the Address Book you couldn't open

## You were right, and the wording was exact

"Is it there, but didn't get indexed?" Yes. Exactly that.

Registering a module puts it in the app's internal list. The **Access menu is a hand-written list**,
and I never added the new entry to it. So the Address Book shipped complete — storage, photos,
search, everything, all of it in the installed app — with no way on earth to open it.

My test checked that the module was registered. It was. Registered and reachable are two different
things, and only one of them is the one you experience. That's on me.

**It's in Access ▸ Organizer now**, alongside Calendar and Reminders.

And there's now a check that walks every way the app can open something — the Access menu, the Games
submenu, the desktop icons, the OSINT Toolkit list — and fails the build if any module can't be
opened from at least one of them. A module that's deliberately opened from inside another module has
to name the module that opens it. No future feature can ship invisible.

## Why you saw no diagnostic either

Same mistake, different place.

v3.82.0 was supposed to show you a report when collection came back without pictures. It asked
whether **any** finding in the campaign had a picture. You have 55 findings, so some of them do —
and the report stayed quiet, even when every newly collected one came back without.

It now judges **what the sweep just brought back**, which is the only thing that says whether
collection is working now. So the next sweep that pulls in picture-less findings will actually tell
you, and quote the station's state while it does.

That's also why I can't say anything useful yet about the collection problem itself: the thing I
built to answer that question was broken, so the last two reports carried no information about it.
This time it should speak.

**What I need from the next run:** run a sweep, and send me whatever block of text appears where the
status line is. It states the running build, whether there's a live capture window, the Tor state,
the image setting per source, and how many findings came back with a picture — captured versus
merely stored. That last number separates two opposite faults that have each cost a release.

## Under the hood

- 713 test files, 5,390 tests, 1 skipped, zero failures; typecheck clean.
- The reachability guard is deliberately dumb: it reads the launcher source files and the module
  registrations, so it cannot be satisfied by anything except an actual entry a person can click.

## Installer

`GhostIntel98-Setup-3.84.0.exe` — 945,756,742 bytes
SHA-256 `2b0b4456a9c30e7d60dab5b1ff38c6c03812c033cd4eb573bcdbee7f155c79df`
