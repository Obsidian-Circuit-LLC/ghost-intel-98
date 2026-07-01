# Ghost Intel 98 — v3.25.0

**Searchlight sweeps survive tab switches; SOCMINT gets a case picker, a visible reason when it's blocked, and an X launcher.**

Four casework-blocking papercuts reported from the field, fixed. **The underlying detection, collection, and encryption engines were not touched** — this release is renderer wiring and UX.

## What was wrong

- **Searchlight sweep results vanished on tab switch.** `SweepPanel` tracked which job was on screen in its own local component state. `SearchlightModule` unmounts the panel whenever you leave the Sweep tab, so switching to Graph (or anywhere else) and back wiped that pointer — the results were still sitting in the case, but the panel fell back to "No sweep yet…" as if nothing had run. Leaving the tab mid-sweep also meant the panel wasn't listening, so switching back looked like the sweep had stalled.
- **SOCMINT's Start Monitor looked dead.** The button was disabled whenever a required field was missing, but the only explanation was a hover tooltip — easy to miss, and not a fix for someone working a case under time pressure. A disabled button with no on-screen reason reads as broken.
- **SOCMINT Case ID was free text.** Nothing validated it against your actual cases, so a typo silently pointed a monitor run at a case that doesn't exist (or doesn't exist yet).
- **No way to reach the X collector from SOCMINT.** Telegram and WhatsApp monitoring lived in the SOCMINT module; X/Twitter collection lived in its own separate window with no link between them, so it was easy to forget it existed.

## The fix

- **Searchlight: the selected sweep job now lives in the store**, not local component state, so it survives the panel unmounting and remounting. A mount-independent stream manager keeps writing incoming results into the store whether or not the Sweep tab is on screen — a sweep keeps collecting while you're on another tab, and switching back shows the same job, with every result collected while you were away. The selection is scoped to the active case, so switching between cases shows each case's own sweep rather than a blank panel.
- **SOCMINT Start Monitor now names the next concrete step in plain language** directly under the button — pick a case, add a channel, enter a burner — instead of a silently disabled control.
- **SOCMINT case selection is now a dropdown of your real, existing cases** (via the same `window.api.cases.list()` the rest of the app uses) instead of a typed Case ID.
- **A new "X / Twitter ↗" button inside SOCMINT** opens the existing X collector window. X remains a quarantined clearnet trust domain in its own separate window — this is a launcher, not an embed, and does not add any new network egress or link between the X and Tor/Telegram transports.

No change to the egress model, the encryption model, or any collector's IPC contract — all four fixes are renderer-only wiring around window/store lifecycle and case data that already existed.

## Quality

- **2,249 automated tests** passing, TypeScript strict (`pnpm typecheck` clean), clean `pnpm build`.
- No dependency, protocol, crypto, or network-egress change.

## Install

Windows NSIS installer attached.
SHA-256: `07ed212a2e1dd0f5734a4fc998ac520f847cf269d3b844c761de43ba9c9d26c7`
Size: 906,320,292 bytes (~864 MiB)
