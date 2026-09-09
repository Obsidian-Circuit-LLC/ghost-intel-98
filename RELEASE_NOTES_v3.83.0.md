# Ghost Intel 98 v3.83.0 — Address Book, and what your portable build proved

## First: the portable build

I diffed it against the source this app's X Listening Station was built from. Here is the whole
result.

**Your collection code and ours are the same code.** `preload.cjs`, `enterprise.cjs`, `main.tsx`
and `styles.css` are byte-for-byte identical. `main.cjs` differs by 14 lines, and every one of them
moves the data directory. `package.json` differs by the build target. That's it. Nothing about
scraping, sessions, the network, or the interface differs at all.

So replacing our copy with yours would change nothing — it would be swapping code for the same
code. I'd rather tell you that than do it and let you install a release that couldn't possibly
help.

**But the diff still told us something.** The one thing your portable build does differently is
keep its data beside the executable. That means it necessarily started on a **clean browser profile
with a fresh X login**, where the installed build and Ghost Intel 98 both carry a long-lived one.

That fits everything: identical code, one copy collecting fine and the other not, a fault that
comes and goes with no release in between. It points at the session, not the software.

So the Clear Session button now does what a fresh profile does. It was clearing cookies and site
storage; a stale HTTP or authentication cache can keep serving the same degraded session
underneath, which is exactly how a problem survives a sign-out and looks intermittent. It clears
those too now.

**Worth trying, in this order:** Clear Session → sign in to X again → run a sweep. If that fixes
it, we finally know what we're dealing with. If it doesn't, the diagnostic from v3.82.0 will say
what the station actually is, and that answer is worth more than another guess from me.

## Second: the Address Book

Built to your spec.

**The contact.** Name, Alias, Occupation, Skills, Notes, and Thoughts — Thoughts kept as its own
field so an observation and an opinion are never filed as the same kind of claim.

**Email, Phone, URL and Social Media each add rows with a plus button**, as many as you want. Blank
rows you leave behind are dropped on save. What you type is stored as typed — nothing is
reformatted into a tidier shape you didn't write, which is the right default for a record of what
was actually observed.

**A bio picture and a drag-and-drop album.** Drop images straight onto the Photos panel or use the
button. Photos are stored encrypted like everything else and never travel with the contact record.

**Search** covers every text field including your notes and thoughts — searching for how you met
someone means searching your own words about them.

**Always alphabetised by Name, never by alias**, exactly as you asked. Accents and capitals file
where a person would expect rather than where a byte comparison puts them.

**Common contacts are two-way and retro-active.** Link Bob to Ada and Ada gains Bob at the same
moment. Unlink from either side and it goes from both. Link as many as you like. Delete a contact
and they disappear from everyone who knew them, rather than leaving blank rows behind.

That rule lives in the storage layer, not the screen. A one-sided link isn't a cosmetic glitch in
an investigative tool — one contact would say they know each other and the other would say they
don't. Putting it where the data is written means no route through the interface can produce a
half-link.

One deliberate limit: you can't link contacts until the new one is saved, and the dropdown says so
rather than failing quietly afterwards. A link needs two records to point at.

Your banner art is the module header.

## Under the hood

- 712 test files, 5,385 tests, 1 skipped, zero failures; typecheck clean.
- Contacts and photos are encrypted at rest through the same vault as case data. Zero network.
- Every photo reference is path-checked at the boundary and again at the read, so a contact's photo
  can never resolve into another module's store or anywhere else on disk.

## Installer

`GhostIntel98-Setup-3.83.0.exe` — 945,753,680 bytes
SHA-256 `5a0fa35c2c9ff8ee4f59b6cf48c56510c1f3668a2618844e5a019ae312af65d4`
