# Ghost Intel 98 — v3.75.0

**The logon screen, rebuilt to your design.**

## Ghost Intel 98 - Logon

The unlock screen is now the classic Windows logon dialog you drew: the key-and-monitor icon on its blue tile, *"Enter your master password to log on to Ghost Intel 98."*, a right-aligned **Password:** field, and **Use recovery key…** on the left with **OK** and **Cancel** on the right.

Three things I decided while building it, so you know what you're getting:

**The icon is drawn, not loaded.** This is the one screen that has to appear before your vault is open — if it depended on an image file and that file ever went missing, you'd be staring at a broken icon on the front door. It's drawn in code instead, so it can't go missing and stays sharp at any size.

**It follows your theme.** The same dialog picks up QUIET AMETHYST without a separate design, so it won't drift out of step when the theme changes.

**Cancel and ✕ close the app.** That's what Cancel means on a logon box — you're choosing not to log on — and while the vault is locked there's nowhere else for it to go. It deliberately does *not* get a new privileged shortcut to do that, because anything reachable from the lock screen is reachable before you've proven who you are.

The recovery-key route is unchanged and still there. Worth mentioning: when you switch to it, the field deliberately shows what you type. A recovery key gets copied by eye off paper, and masking it just invites typos on the one thing standing between you and a vault nothing else can open.

## Also in this build

Everything from v3.74.5 and earlier this week: the capture window being opened before collection navigates to a target, Clear Session genuinely signing you out instead of only saying so, sweeps reporting failures with a reason in the run log, and the collection fixes behind them.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.75.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installs over the previous build in place.

- **SHA-256:** `__SHA256__`
- **Size:** `__SIZE__`

Confirm **Settings ▸ About** reads **3.75.0**.

> You'll see the new screen the moment you launch it — it's the first thing the app shows. If the proportions want nudging (tile size, wording, button widths), that's a quick change now the structure is in place.
