# Ghost Intel 98 — v3.74.5

**Hotfix: the last fix was in the wrong place, and Clear Session wasn't clearing anything.**

## Refresh / sweep — I fixed the right thing in the wrong order

Your error told me exactly what I'd done:

> `[xls:profiles:refresh] No capture window is open for this campaign.`

Last release I made collection open its own browser window when one wasn't there. But I put that *after* the step that drives the window to the profile — and that step is the one that gives up when there's no window. So it never got as far as the fix. Right idea, wrong order, and order was the whole point.

The window is opened first now, then pointed at the target. Same as before: hidden, so it doesn't jump in front of you, and still routed through Tor.

## Clear Session actually clears the session

You caught a genuinely bad one. Clear Session was only closing the window — it never signed you out. And since the station decides whether you're connected by looking at your saved login, it kept right on saying **CONNECTED**, because you *were*. It told you it had cleared and nothing had been cleared.

That's worse than not having the button. Someone could hit Clear Session, believe their X account is off the machine, and hand it over. It now genuinely signs out — the saved login is removed, and the status updates to match instead of contradicting it.

## Your other theory

You wondered whether your own installed copy of the Station was clashing with this one and making it think it was connected. It isn't — two separate apps keep entirely separate browser data, so your build's login and this one's never touch. The CONNECTED reading was this app's own saved login, which was real. Nothing had ever removed it, because Clear Session didn't.

Good instinct though: something *was* reporting a connection that couldn't be used. It just came from inside the house.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.74.5.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `79418caba80db35206ce6bc9916ec462617e2cbf0cd5c35f201336bd0d3c2c32`
- **Size:** `945,164,609 bytes (~901 MB)`

Confirm **Settings ▸ About** reads **3.74.5**.

> Suggested order once installed: **SYSTEM ▸ CLEAR SESSION** (it should now flip to NOT CONNECTED — that's the fix proving itself), then **CONNECT / REOPEN X** and log in, then add a source and **RUN SWEEP**. If a sweep still comes back empty, **CHANGE INTEL ▸ COLLECTION RUN LOG** now records a reason per source.
