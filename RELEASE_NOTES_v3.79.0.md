# Ghost Intel 98 v3.79.0 — the three dead buttons in X Listening Station

Good news received and confirmed: the station is scraping profile and display pictures.
That was the hard one.

This release is your two follow-up reports. All three buttons were broken, all three for
the same underlying reason, and one of them was hiding the other two.

## 1. OPEN REAL THREAD

Your post card hands the button a finding's ID. The code behind it expected a web address
and checked it like one — so an ID failed that check every time and no window ever opened.
It now looks the finding up first and opens the address it stored, which is what your own
version does.

## 2. VERIFY LIVE

Your screenshot had the whole answer in it:

    Post not found in this campaign.

The finding was there. The code was looking in the wrong filing cabinet — an older store
this build stopped writing to. Same shape as the display-picture bug: a working service
pointed at the wrong place.

It now reads and writes your campaign document. Verification results stick to the finding,
and a post that has been deleted files a **post unavailable** entry in CHANGE INTEL — a
section that has been empty this whole time because nothing was writing to it.

## 3. EXTRACT FOLLOWERS / FOLLOWING / BOTH

This one is the reason the other two looked mysterious, and it is the honest answer to
your last report as well.

When an extraction is stopped — Tor down, session expired, X showing a challenge — the
station tells the screen why. That message goes through a channel that needed a field we
weren't sending. So the message crashed on arrival and displayed nothing. Then the click
finished and the app announced "Network extraction complete."

Nothing wrong, nothing collected, nothing said. That is exactly what "unresponsive" looks
like.

**This is also why v3.77.0 didn't help.** That release added the blocked-reason reporting
you were supposed to see. It worked. The reason was produced and then thrown away one
frame later, every time.

Two changes:

- Failure messages now carry everything the screen needs to display them.
- A blocked extraction, and a sweep where every source failed, now **stop with the reason
  on screen** instead of finishing quietly and claiming success.

## What this does and does not promise

I fixed the reporting. I have **not** proven your followers/following extraction will now
return accounts — that needs a real X session and your machine.

What changed is that it can no longer fail in silence. Click EXTRACT FOLLOWERS and one of
two things happens: accounts arrive, or a plain-language reason appears where the status
line is. **Whatever it says is what I need.** That sentence was in the v3.79.0 notes'
predecessor too, and this time the message can actually get to you.

## Under the hood

- 705 test files, 5,318 tests, 1 skipped, zero failures; typecheck clean.
- New tests drive the real verification path end to end against a campaign document, and
  assert every failure message satisfies the shape the screen requires.
- Mutation-verified: the fix was proven by reproducing your exact error string first.
- One bug caught by the new tests before it shipped: the store adapter's safety guard
  would have rejected every verification in production.
