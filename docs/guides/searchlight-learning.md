# How Searchlight Learns

### A plain-English guide to the "smart detector" in Searchlight

---

## The one-line version

Searchlight already guesses, for every site it checks, whether your target **really has an account there**. You can make those guesses *better over time* by telling it when it got one right or wrong. That's the whole feature. It learns **only from you**, **only on your machine**, and it stays off until *your* version is provably better than the one it ships with.

---

## 1. What the detector is doing in the first place

When you run a username sweep, Searchlight visits each site and has to decide one of three things:

- ✅ **Found** — looks like a real account.
- ❔ **Maybe** — it's not sure. The page was ambiguous.
- ⬚ **Not found** — looks like there's no account.

Most sites are easy (the site flat-out says "user not found"). The hard ones land in **Maybe** — and *those* are where your help is worth the most.

> You don't have to do anything for this part. It happens automatically on every sweep. The learning feature below is just about making the **Maybe** pile smaller and the ✅/⬚ calls more trustworthy.

---

## 2. The big idea: it learns from *you*, not from the internet

Searchlight ships with one **generic** detector — a starting point trained on a small public sample. It's decent, not brilliant.

The catch with any generic detector is that *your* cases aren't average. You work specific sites, specific kinds of targets. So instead of trying to be clever for everyone, Searchlight lets **your own corrections** retrain a detector that's tuned to **your** work.

Here's the loop, and it's short:

```
   You run sweeps  ─►  You thumbs-up / thumbs-down a few results
          ▲                              │
          │                              ▼
   It gets better  ◄──  You press "Train", it checks itself
```

**Nothing leaves your computer.** There is no shared model, no upload, no "anonymous data to improve the product." Your corrections train a file that lives only in your own app data. (More on privacy in section 6.)

---

## 3. Why it starts switched OFF (and that's on purpose)

When you first install, the smart detector is **off**. The Settings screen even labels it *"experimental; bundled model pending retrain."* That's honest, not a bug.

The reason: a generic model that hasn't learned your cases yet is, at best, a tie with the plain detector. Turning it on before it has earned its place would just add risk for no gain. So Searchlight makes you **earn the upgrade** — it won't even let you *check* whether the smart detector is better until you've given it enough corrections to judge fairly.

Think of it like this: **off by default = "prove it first."**

---

## 4. How to teach it — step by step

You teach it by **labeling** results: a 👍 or 👎 on results Searchlight wasn't sure about.

### Where the buttons are

You can label in **two places** — use whichever fits your flow:

1. **Right on the sweep results** — every ✅ Found and ❔ Maybe row has a small 👍 / 👎 next to it (you'll only see them when a case is open). Tap one and a ✓ replaces it. Done.
2. **The "Learning" tab** (inside Searchlight, next to Sweep) — this is the calmer way. It hands you a **short, prioritized list** — at most **10 of the most useful "Maybe" results at a time** — so you're never staring at a wall. Label them, they drop off the list, next chunk appears.

### What the two buttons mean

- 👍 **Real** — "yes, this account is genuinely theirs."
- 👎 **Not real** — "no, that's a false hit / not them."

That's the entire skill. You're not scoring anything. You're just confirming or correcting.

### The one number to watch: **80**

Under the action button there's a progress bar toward **80 labels**. Eighty is the point where Searchlight has *enough* of your corrections to test itself honestly. Until then it'll just say:

> *"Keep labeling — 34/80 until your model can be checked."*

You don't have to do all 80 in one sitting. Label a handful after each sweep; it remembers. The bar fills up as you go.

---

## 5. The "Learning" tab, button by button

The Learning tab always shows you **one** thing to do next and **one** plain sentence about where you stand — never a pile of statistics. Here's every state you might see, and what it means:

| What the button says | What it means | What to do |
|---|---|---|
| **Label results to teach the detector** | You're still building up corrections. *"Keep labeling — N/80 until your model can be checked."* | Keep thumbs-up/down-ing results. Watch the bar climb to 80. |
| **Train now** | You hit 80+. *"You have enough labels — train to check if your model beats the built-in detector."* | Press it. It builds your detector and tests it (takes a moment). |
| **Enable — beats the built-in detector** | Your detector passed the test. *"Your model now beats the built-in detector on your cases."* | Press it to switch your smarter detector ON. |
| **Train again** | It trained but didn't beat the default yet. *"Not yet — your model doesn't beat the built-in detector. Label more, then retrain."* | Label more results, then press it again. No harm done. |
| **Retrain** | Your smart detector is already ON. *"ML is on — beating the built-in detector on your cases."* | Optional. As you label more, retrain occasionally to keep it sharp. |

**The safety net:** if you retrain and the new version *isn't* actually better, Searchlight **keeps your old working one**. A bad retrain can never make your detector worse. So pressing "Retrain" is always safe.

---

## 6. The privacy promise (why this is safe to use)

This feature was built to *not* leak anything:

- **Local only.** Your corrections, the captured page-features, and your trained detector all live in your own app data folder. There is **no central model** and **no network connection** in the learning part at all. The only time Searchlight touches the network is the actual username-checking on sites — which is the same Tor-gated switch you already control.
- **Encrypted at rest — when you're logged in.** If you use the app with a vault/login, all of it (your labels, your model) is encrypted on disk. *Note:* if you run the app with **no login set up**, those files sit in plain text — so if this is sensitive casework, use a login.
- **You can't accidentally poison it.** The buttons only send "this result, thumbs-up/down" — the actual page data it learns from is captured by the app itself during the sweep, not typed in. So a stray click is just a stray click, easily corrected by labeling it the other way.

---

## 7. For the curious: the Settings switches (optional)

You never *need* to touch these — the Learning tab handles everything. But if you open **Settings → Searchlight** you'll find:

- **Deep scan** (on by default) — lets Searchlight take a second, closer look at ambiguous sites. Leaving it on gives better answers; turning it off makes sweeps faster but leaves more results in "Maybe."
- **Use ML model** — the same on/off switch as the Learning tab's Enable button. Marked *experimental* for the reason in section 3.
- **Found / Maybe thresholds** — advanced dials for *how confident* a result must be to count as Found or Maybe. The placeholders show the model's own defaults. **Leave these blank unless you know exactly why you're changing them** — the detector's own calibrated values are almost always better than a hand-picked number.

---

## Quick reference card

> **To make Searchlight smarter:**
> 1. Run sweeps like normal.
> 2. After each, open the **Learning** tab and 👍/👎 a few **Maybe** results.
> 3. Watch the bar climb to **80**.
> 4. Press **Train now**.
> 5. If it says **"beats the built-in detector"**, press **Enable**.
> 6. Every so often, **Retrain** to keep it sharp.
>
> It learns only from you, only on your machine. You can't break it — a worse retrain is always thrown away.

---

*Ghost Intel 98 — Searchlight. This guide describes the adaptive-learning feature as shipped in v3.24.x.*
