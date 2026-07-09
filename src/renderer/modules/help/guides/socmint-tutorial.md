# SOCMINT: X, Telegram & WhatsApp

### A step-by-step guide to the social-media collectors in Ghost Intel 98

---

## Read this first (the one safety rule)

These tools reach out to **real social-media networks**. So:

- **Nothing connects until you turn the network on.** Every collector is **off by default**. You flip it on yourself, per the steps below.
- **Two of them can run over Tor. One cannot.**
  - **Telegram** and **WhatsApp** go through **Tor** (or direct — your choice).
  - **X / Twitter cannot use Tor.** X blocks Tor instantly, so the X collector connects over the **normal internet** — your real IP is visible to X. The app makes you tick a clear warning before it'll let you turn X on. That's by design.

If a step ever says "did not start" with a reason, read the reason — the app now tells you what's wrong instead of failing silently.

---

# Part 1 — X / Twitter

X collection has **two steps**: log in an account once (in Settings), then collect (in the X Collector window).

## 1a. Log in your X account (one time)

The collector harvests *as a logged-in account*. Without one, X gives you basically nothing. You give it your account by pasting two cookie values from a browser where you're already logged in to x.com.

> **Get the two cookies:** log in to **x.com** in a browser → open the browser's developer tools → **Application/Storage → Cookies → x.com** → copy the values of **`auth_token`** and **`ct0`**. Use a **burner** X account, not your personal one.

Then in Ghost Intel 98:

1. Open **Settings › X / Twitter Collector**.
2. Tick the **clearnet acknowledgement** (it explains the no-Tor exposure). Until you do, the network switch stays locked.
3. In **X Account Credentials**, fill in:
   - **Account ID** — any short label you'll recognise (e.g. `burner-1`).
   - **auth_token** — paste the cookie.
   - **ct0** — paste the cookie.
   - **Username** — optional.
4. **Save**, then turn the **X network** switch **on**.

Your cookies are stored encrypted in the app and **never shown again** — the rest of the app only ever sees the account's label, never the cookie.

## 1b. Collect

1. Open the **X / Twitter Collector** window (Start menu or desktop).
2. Enter a **Case ID** and press **Load**. Everything you collect lands in that case.
3. On the **Collect** tab:
   - **Account** — pick the account you just added. *(Collect stays disabled until you do — that's the app stopping you from running a pointless logged-out harvest.)*
   - **Collection Mode**:
     - **Keyword Search** — type a search like `from:someuser breach lang:en`.
     - **User Timeline** — type a username (without the @) to pull their tweets.
   - **Max results** — defaults to 500.
4. Press **Collect**. Watch the **Status** badge.

> **What the status means — this matters:**
> - **Done** (green) — the only status that means "complete."
> - **Partial** — it stopped early (often just hit your max-results cap). **A partial result is NOT proof the rest doesn't exist.**
> - **Collector is broken** (red) — X changed its internals and the collector needs an update. Your already-collected data is safe.

## 1c. X — honest limits

- **Clearnet only.** Your IP is visible to X. Use a burner account on a connection you're comfortable using.
- **It will break occasionally.** When X rotates its internals you'll get the red "broken" banner until the collector piece is rebuilt. Normal, expected, not your fault.
- **Windows & Linux only** right now — the X engine isn't built for macOS yet.

---

# Part 2 — Telegram

Telegram is **live monitoring**: you pick channels/groups to watch, and new messages stream in. (There's no "search all of Telegram" — you watch specific places.)

## 2a. Set up a Telegram burner (one time)

Telegram needs a **session string** from a burner Telegram account, which you generate **outside** the app (using your own `api_id` / `api_hash` from <https://my.telegram.org> and any standard Telegram session-string tool). Then:

1. Open **Settings › SOCMINT**.
2. Choose your **Collector transport**: **Tor** (recommended) or **Direct**.
3. Under **Burner identity**, fill in:
   - **Burner ID** — a label you'll reuse (e.g. `tg-burner-1`).
   - **Session string** — paste it.
   - **API ID / API Hash** — optional, if your session needs them.
4. **Save.**

## 2b. Watch channels

1. Open the **SOCMINT** window, enter a **Case ID**, press **Load**.
2. Make sure **Telegram** is selected at the top.
3. On the **Channels** tab, add each place to watch:
   - **Channel ID / @username** — e.g. `@somechannel` or `-100123456789`.
   - **Label** — optional, for your own reference.
   - **Keywords** — comma-separated; leave empty to capture everything.
   Press **Add Channel**. Repeat for each.
4. In the **Monitor** section:
   - **Burner ID** — type the same burner label you set in Settings.
   - Press **Start Monitor**.
5. New matching messages now stream into the **Harvested Items** tab. Press **Stop Monitor** when done.

> If Start Monitor says it couldn't start, it'll tell you why — usually "add a channel first," "enter your Burner ID," or (in Tor mode) "Tor isn't connected."

---

# Part 3 — WhatsApp

WhatsApp is **monitoring-only**, and the most sensitive of the three. Read the warning the app shows you — it's not boilerplate.

> **The WhatsApp reality:** to watch a group you **join it with a real burner phone number**, and **every member and admin of that group can see that number**. This is infiltration, not passive watching. The number traces back to wherever you bought the SIM. Treat it accordingly.

## 3a. Link a WhatsApp burner (one time)

1. In the **SOCMINT** window, select **WhatsApp** at the top, then open the **WA Setup** tab.
2. Enter:
   - **Burner ID** — a label (e.g. `wa-burner-1`).
   - **Phone** — the burner's number, **digits only, no `+`**.
3. Press **Request Pairing Code**. An **8-character code** appears.
4. On the burner phone: **WhatsApp → Linked Devices → Link a Device → Link with phone number instead**, and enter the code.

To retire a burner later, use **Unlink** here — then also remove the device in the phone's **WhatsApp → Linked Devices**.

## 3b. Watch groups

1. On the **Groups** tab, add each group's **JID** — it must end in **`@g.us`** (the app rejects anything else; personal DMs aren't monitored). Add a label and keywords if you like.
2. In the **Monitor** section, enter your **Burner ID** and press **Start Monitor**.
3. Matching group messages stream into **Harvested Items**.

> If you chose **Tor** as the transport, the app warns that Tor *raises* the risk of a WhatsApp ban (WhatsApp dislikes datacenter IPs on long connections). Weigh that against your need for Tor.

---

# Reading & saving results (all three)

Everything lands in the **Harvested Items** tab of whichever collector you used, inside the case you loaded:

- **Rank by keyword** — type a word and the local AI re-sorts items by relevance. *(This ranking runs entirely on your machine — harvested content never goes to any cloud AI.)*
- **Accept / Reject** — mark each item to keep your findings tidy.
- Items are **stored encrypted inside the case** — no separate "export" step; they're there when you reopen the case.
- **Links and media are display-only.** The app never auto-loads an image or follows a link for you (that would reveal your IP). You decide what to open.

---

## Quick reference

> **X / Twitter** — Settings › X: tick clearnet, paste `auth_token` + `ct0`, turn on. Window: load case → **pick your account** → Search/Timeline → Collect. *(Clearnet — real IP visible. Done = complete; Partial ≠ "nothing there.")*
>
> **Telegram** — Settings › SOCMINT: pick transport, paste session string under a Burner ID. Window: load case → Telegram → add channels → enter Burner ID → Start Monitor. *(Live watch only.)*
>
> **WhatsApp** — WA Setup: Burner ID + phone → Request Pairing Code → enter in phone's Linked Devices. Groups: add `@g.us` JIDs → enter Burner ID → Start Monitor. *(Your burner number is visible to the whole group.)*

---

*Ghost Intel 98 — SOCMINT collectors. This guide describes the collectors as shipped in v3.24.2.*
