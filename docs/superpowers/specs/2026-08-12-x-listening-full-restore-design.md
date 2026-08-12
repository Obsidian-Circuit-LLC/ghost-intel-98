# X Listening Station — Full-Parity Restore (onto the hardened core) — Design

**Date:** 2026-08-12
**Status:** DRAFT for operator review
**Related:** [[xls-enterprise-v3.4.1-port]] (the original port, shipped v3.70.0), the verified feature-diff of 2026-08-12.

## Problem

The X Listening Station shipped in v3.70.0–v3.70.2 is a *feature-reduced* rebuild of GhostExodus's Enterprise v3.4.1. The 11-tab structure and analytical core are present, but a set of capabilities were dropped or thinned. GhostExodus (field user) reports it as "a very stripped down version." Operator directive (2026-08-12): **restore 100% of the source's functionality, reskinned for Ghost Intel 98, while KEEPING the security hardening** (encrypt-at-rest, Tor-default + acked clearnet, SSRF-anchored media fetch, synthetic-excluded exports). Source is "independently tested and verified" by GhostExodus — treated as *functionally* correct; this does not waive GI98's security invariants.

## Resolved decision (operator, 2026-08-12)

- **Target = all features + keep hardening.** Every restored capability is *functionality* rebuilt onto the existing hardened seams. Nothing user-visible is lost; the only differences from source remain invisible (AES-GCM at rest vs plaintext; Tor-default egress vs clearnet-default; anchored host match vs substring). Reverting those would breach the charter and is explicitly NOT in scope.
- **UI = reskin only, and the reskin REPRODUCES the Enterprise look** (operator decision 2026-08-12). The Enterprise shell feel — left sidebar, brand block, campaign dock, nav menu with live count badges, Tor box, session box, masthead banner, topbar — is reproduced in GI98 theme tokens (classic + QUIET AMETHYST), not replaced by bare Win98 module chrome. Feature surface AND look reach parity; only the underlying theming system differs. See J2.

## Global Constraints (bind every task)

1. **Preserve all hardening invariants** (do not regress): AES-GCM at-rest for all case state + cached media (secure-fs); Tor-default fail-closed via the app's single `getBgTor()` engine with the one-time acked clearnet opt-in (`AppSettings.xListening.clearnet`/`clearnetAck` + `resolveXTorGate`); host-**anchored** media fetch (`remoteMediaToDataUri`, `new URL().hostname === 'pbs.twimg.com'`, image content-type check); synthetic/demo records `synthetic:true` and excluded from analysis/exports/hashing; CSV formula-injection prefix-guard (`csvCell`); exports save-dialog-gated + SHA-256 sidecar; `assertTrustedSender` on every IPC channel; capture windows sandbox+contextIsolation+no-nodeIntegration+no-webviewTag; `setWindowOpenHandler` deny-by-default; no telemetry/egress beyond X capture + Tor exit-verify.
2. **Theme tokens only** in any new CSS — `--ga98-*`, no hardcoded colour literals (the no-straggler guard must stay green); reskin must render in both classic and QUIET AMETHYST.
3. **Feature parity target = Enterprise v3.4.1** as inventoried 2026-08-12. Each restored feature must reach behavioural parity with the source (verified against the quarantined `main.cjs`/`enterprise.cjs`/`main.tsx`), not an approximation.
4. **Determinism** in evidence/hash/export paths (no `Date.now()`/unseeded RNG in canonicalization).
5. **No AI/personal identity** in commits (repo persona).
6. **ADHD-friendly UX** (GhostExodus): one-click actions, immediate feedback, plain language, bounded worklists, visible progress.

## Architecture

Same as the original port: Enterprise features rebuilt onto `src/main/x-listening/*` (main) + `src/renderer/modules/x-listening/*` (renderer), reusing the shared hardened capture core (`src/main/capture/*`), secure-fs, and the `HarvestedItem`/artifact-sidecar model. New work extends existing modules rather than adding parallel ones. Renderer stays a single module (`XListeningModule.tsx`) with per-tab render blocks; new heavy sub-views (network graph, rich PostCard) may split into co-located components under the module dir.

## Feature restoration list

Each item: **source behaviour → target seam → hardening constraint → acceptance.** Grouped by the diff buckets. Items marked ◐ are partial-present (extend); ✗ are absent (build).

### A. Evidence-integrity features
- **A1 ✗ Live post verification ("VERIFY LIVE").** Source: `verifyPostLive` opens the real post URL in a hidden authenticated window, detects unavailable-post language + text edits, pushes prior text into `versionHistory`. → Target seam: new `verifyPost` in `capture.ts` using `createCaptureWindow` (Tor-gated), availability-language detector reused from `extract.ts:625`. → Hardening: Tor-gated capture window; no clearnet fallback. → Accept: a captured post can be re-verified; an edited/removed post updates availability badge + records a change event; regression test on the availability-language matcher.
- **A2 ✗ Post version history + profile-change snapshots.** Source: `post_changed` (text/media diff on re-ingest or verify, prior version → `versionHistory` capped 20), `profile_change` (metadata diff vs last snapshot, SHA-256 signature-gated), profile snapshots keep bio/avatar/location/website history. → Target seam: extend `store.ts` artifacts with `versionHistory[]` + `profileSnapshots[]`; diff logic in `analysis.ts`/`capture.ts`. → Hardening: snapshots stored via secure-fs; hashes deterministic. → Accept: re-capturing a changed post appends a version; a changed bio/avatar emits a `profile_change` event.
- **A3 ◐ Collection run log.** Source: per-operation record (observed/added/duplicates, requested vs completed passes, reachedEnd, stopReason, status). → Target seam: extend capture/archive to emit run records into a secure-fs sidecar; Changes tab renders "COLLECTION RUN LOG" column. → Accept: every capture/archive op appends a run-log row visible in Change Intel.

### B. Change Intel tab (◐ → full)
- **B1** Restore the two-column Change Intel: **HISTORICAL CHANGE EVENTS** (profile_change/post_changed/post_unavailable, from A2) + **COLLECTION RUN LOG** (from A3), alongside the existing network deltas. → Accept: all three event streams render, capped + sorted as source.

### C. Network tab (◐ → full)
- **C1 ◐ Explicit follower/following extraction actions.** Source: EXTRACT FOLLOWERS / EXTRACT FOLLOWING / EXTRACT BOTH buttons drive `relationships:extract`. Rebuild has `captureFollowers/captureFollowing` (capability present, UI actions absent). → Target: wire the three actions to the existing capture channels + per-source/all + view selectors. → Accept: the three buttons run the corresponding capture and populate the network view.
- **C2 ◐ Rich network sub-views.** Source: COMMON FOLLOWERS/FOLLOWING expandable pair lists (chips open X profile), MULTI-TARGET OVERLAP table (min-connected input, follows/followed-by lists), interactive **COMMON NETWORK MIND MAP** (`NetworkGraph` SVG: modes, focus, legend, inspector, node size = overlap), RECENT NETWORK DELTAS (conservative unfollow caveat), EXTRACTED NETWORK RECORDS (export JSON/CSV, clear, list). Rebuild has overlap data + a relationship graph. → Target: bring the network tab UI to parity (extend `analysis.ts` outputs already present; build the missing panels/graph interactions). → Hardening: open-in-X affordances Tor-gated (see E1). → Accept: each of the five network panels present + interactive per source.

### D. Sources tab (◐ → full)
- **D1** Per-source card actions to parity: Images on/off (per-profile override — see F1), **Refresh** (single-source capture), **View X** (open native feed — E1), **Network** (jump to Network tab preselected), **Remove** (cascade). → Accept: each action present + wired.

### E. Open-in-X affordances (✗)
- **E1 ✗ Native X windows** from cards/sources/identities: per-card "Open Real Thread", per-source "View X", identity "Open X Profile"/"Open Profile". Source: `feed:open-thread`, `feed:open-profile`, `identity:open-profile`, `relationships:open-profile`. → Target seam: shared `openInX(kind, ref)` using `createCaptureWindow` with strict URL construction (username validator `^[A-Za-z0-9_]{1,15}$`, post-id validation) — reuse the source's `openPostThread` scheme/host/path validation. → Hardening: Tor-gated window on the X partition; deny-by-default navigation; no `shell.openExternal`. → Accept: each affordance opens the correct in-app X window over Tor; rejects malformed refs.

### F. Collection settings + policy (◐ → full)
- **F1 ✗ Per-profile image policy (on/off/inherit).** Source: `effectiveImageCollection` (global toggle + per-profile override), webRequest filter cancels twimg loads when off. → Target: extend profile model + the existing media pipeline; per-webContents policy. → Hardening: default off-ish per posture; anchored fetch unchanged. → Accept: a profile set to "off" fetches no media; "inherit" follows campaign toggle.
- **F2 ◐ Full COLLECTION SETTINGS form (System tab).** Source knobs: automatic-sweeps toggle; RECORD TYPES (collect replies/reposts/third-party comments/retrieve+archive images, comment threads per source, comment scroll passes); TIMING+HEALTH (sweep interval, profile scroll passes, follower/following base passes, network stagnation limit, snapshots retained, delay per pass, retention limit); INCREMENTAL ARCHIVE (enable, interval, post/network depth added per cycle, max depths, archive followers/following). Each clamped min/max, persisted **per-campaign**, restarts timers. → Target: render the full form in the System tab; persist per-campaign settings via secure-fs; clamp every field. → Accept: every knob present, clamped, persisted per-campaign, and actually consulted by the capture/archive paths.

### G. Automatic scheduling (✗ — bounded redesign)
- **G1 ✗ Automatic sweeps + auto archive cycles — source-exact timer (operator decision 2026-08-12).** Source: free-running `setInterval` auto-sweep on `intervalMinutes` + auto archive on `archiveIntervalMinutes`. → Target: restore the **source-exact free-running timer** (fixed cadence, sweeps on schedule regardless of UI state — no automatic pause, no jitter-bounding). **Egress safety is user-controlled, not automatic:** each sweep's actual capture still routes through the existing egress gate (`resolveXTorGate`) — Tor-default **fails closed** (no capture, no silent clearnet leak) unless the user has enabled the **clearnet toggle with the appropriate warnings** (`AppSettings.xListening.clearnet`/`clearnetAck`: one-time real-IP acknowledgement + explicit warning copy on the toggle). So the timer matches the source exactly; the user consciously chooses Tor (fail-closed) or warned-clearnet. → Accept: enabling the schedule sweeps at the fixed interval; in Tor-mode a dropped exit makes the sweep capture fail closed (no clearnet fallback); the clearnet toggle renders a clear real-IP warning and requires the ack; a test asserts no sweep capture egresses over clearnet unless `clearnetAck` is set.

### H. Avatar/media polish (◐)
- **H1 ◐ Avatar-repair-on-startup.** Source: `scheduleAvatarRepair`/`repairExistingProfileAvatars` re-fetch missing avatars on launch. → Target: a bounded startup pass over the active campaign's profiles, Tor-gated, anchored fetch. → Accept: a profile with a missing cached avatar re-fetches on next launch (under Tor).

### I. Rich PostCard (◐ → full)
- **I1** PostCard parity everywhere it's reused (Live/Dashboard/Search/Notes): avatar, name/@user, kind tag, "VIA @source", timestamp, MATCH rows, text w/ preset highlight, media strip (≤3 thumbs, "MEDIA NOT RETRIEVED" fallback), metrics row, provenance (first/last, availability badge, per-post SHA-256 short), actions (Open Real Thread [E1], Verify Live [A1], Analyst Notes toggle with inline add/edit/delete). → Accept: a PostCard renders every element; inline note editing works; reskinned in both themes.

### J. Campaigns / misc parity
- **J1 ◐** Confirm Campaign **Duplicate** (present, verify parity: clones profiles+presets with new IDs, resets counts). Campaign editor modal fields to parity.
- **J2 Enterprise look (GI98-themed) — IN scope (operator decision 2026-08-12).** Reproduce the Enterprise shell feel: left sidebar (brand block, campaign dock, nav menu with **live count badges**, Tor box, session box), masthead banner, topbar (eyebrow + active-campaign line + action buttons). Re-skinned entirely with `--ga98-*` tokens so it renders in classic + QUIET AMETHYST; token-only, no hardcoded colours, no-straggler guard green. Visual parity with GhostExodus's Enterprise app — replaces the bare Win98 module chrome. (Confirm exact look against the demo video once uploaded.)

## UI reskin

The restored surface uses the existing `x-listening.css` token system + the v3.70.2 re-skin patterns (accent tiles, accent buttons, active-tab underline). New panels (network graph, settings form, rich PostCard) get token-only styling that renders in classic + amethyst. No hardcoded colours.

## Testing strategy

- Per feature: a Vitest unit/seam test (evidence diff, run-log emission, image-policy resolution, schedule-gate fail-closed, canonical hash determinism).
- Headless-Chrome computed-style/screenshot harness for the reskinned network graph, settings form, and rich PostCard in both themes.
- Regression: the existing 4319-test suite stays green; no-straggler guard green; typecheck clean.
- The live auth + Tor capture paths remain owed on-device smoke (un-automatable) — same class as prior ports.

## Out of scope

- Any security-invariant regression (plaintext at rest, clearnet-default, substring host match) — explicitly excluded per operator decision. (Note: the free-running auto-sweep timer is source-exact per G1, but its egress still honours the Tor-default/acked-clearnet gate — the timer cadence is source-exact, the leak posture is not regressed.)
- The WebSDR viewer (separate workstream/branch, gated behind its Phase-0 feasibility spike).

## Decomposition (for the plan)

Staged like the original port, each phase ending green + adversarially reviewed:
- **Phase 1 — evidence integrity:** A1, A2, A3, B1.
- **Phase 2 — network parity:** C1, C2, D1, E1.
- **Phase 3 — settings + policy + scheduling:** F1, F2, G1, H1.
- **Phase 4 — PostCard + Enterprise-look shell + campaign parity:** I1, J1, **J2 (Enterprise-look shell reskinned in GI98 tokens)**, whole-branch review.

Each phase: TDD implementers (sequential, shared tree) + per-task review, then a parallel adversarial whole-branch review (refute-by-default) before merge — the pattern that caught a real critical in every phase of the original port.
