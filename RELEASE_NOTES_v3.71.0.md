# Ghost Intel 98 — v3.71.0

**The X Listening Station, fully restored — GhostExodus's Enterprise v3.4.1 feature set and look, on Ghost Intel 98's hardened core.**

v3.70.x rebuilt the X Listening Station's skeleton but landed feature-reduced and in the plain Win98 chrome. v3.71.0 completes it: every Enterprise capability is restored, and the module now wears the Enterprise **dark-console look** — reskinned in Ghost Intel 98's themes so it renders as a light console in the classic theme and a dark neon console in QUIET AMETHYST. Nothing user-visible was traded away, and the security hardening is intact throughout.

## What's restored

**Evidence integrity**
- **Verify Live** — re-open a captured post over Tor to confirm it still exists or was edited.
- **Version history + change tracking** — edited posts keep prior versions; profile-metadata changes are recorded; a two-column **Change Intel** tab shows historical change events + the collection run log alongside network deltas.

**Follower network**
- **Extract Followers / Following / Both**, the **multi-target overlap** table, **common-followers / common-following** panels, and the interactive **Common Network mind-map** graph (identity nodes sized by cross-target overlap; focus, modes, inspector).
- Per-source **Refresh / View X / Network / Remove**, and **open-in-X** affordances throughout — all routed through the hardened, Tor-gated in-app window.

**Collection control**
- The full **collection-settings form** (per-campaign, every value bounded): record types, scroll/pass depths, retention, and incremental-archive depth.
- **Per-profile image policy** (on / off / inherit).
- **Automatic sweeps + auto-archive** on a schedule, with a **clearnet toggle** carried behind an explicit real-IP warning — Tor stays the default and fails closed; a scheduled sweep never silently leaves Tor.

**Presentation**
- A **rich post card** (media, engagement metrics, provenance + per-post SHA-256, inline analyst notes) reused across Live / Dashboard / Search / Notes.
- Campaign **duplicate** + a full name/purpose/description **editor**.
- The **Enterprise shell** — brand block, campaign dock, count-badged navigation, Tor + session status, lightning masthead, and topbar.

## Hardening (unchanged, verified)

Tor-default fail-closed capture; a one-time real-IP acknowledgement gates any clearnet path; unattended sweeps and avatar repair require that acknowledgement explicitly. Case state and cached media stay AES-GCM-encrypted at rest; media fetches are host-anchored; demo/synthetic data is excluded from analysis, exports, and evidence hashes and exposes no network action. The whole restore was built as four independently reviewed passes; each review caught and fixed a real defect — including an auto-sweep evidence-contamination bug — before merge.

## Also in this release

- **Journal Jots** — right-clicking a text block no longer surfaces an empty "descriptors/introductions" menu (that Reports-only feature is now correctly scoped out of Journal Jots).

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.71.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**). Installing over an older build replaces it in place.

- **SHA-256:** `cac4306d731b78ccf56c50187bdd5b3e637cf02702f73eb46934a5957ce2f0a0`
- **Size:** 944,462,724 bytes (~901 MB).

Confirm **Settings ▸ About** reads **3.71.0**. The X Listening Station will show the Enterprise console — a count-badged sidebar, the mind-map on Follower Network, and the full collection settings on System.

*The live X login + Tor capture path still wants an on-device smoke test (real session required); everything else is verified.*
