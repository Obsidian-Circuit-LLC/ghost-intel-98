# Ghost Intel 98 — v3.23.0

**Searchlight detection scorer — soft-404 false positives, killed.**

Username sweeps used to trust the HTTP status code, so a site that returns a styled "this account doesn't exist" page while still answering **200** (a *soft-404*) was reported as a confident **FOUND**. That's the false-positive class you've been hitting in live casework. This release replaces the status-code-trusting fallback with a structural confidence scorer.

## What changed

- **Adaptive two-phase probe.** A cheap header check runs first. A clean 404 or redirect-away resolves immediately with no body fetched. Only when a bare 200-with-no-redirect is genuinely ambiguous does Searchlight fetch the page body and score it — so the extra bandwidth is spent only where it buys a decision.
- **Structural signal scoring.** The fetched page is scored on ~25 structural signals: `og:type=profile`, JSON-LD `Person`, username-in-title / `<link rel=canonical>`, profile-vs-error keyword and DOM-shape counts, redirect distance, HTTP-code buckets. A real profile reads as a profile; a soft-404 reads as an error template.
- **First-class `MAYBE` tier.** Borderline results get their own status — a badge with a confidence %, a filter chip for triage, and a line in the PDF/HTML report — instead of being forced into FOUND or NOT-FOUND.
- **Modernized Sweep panel.** Sortable columns (stable, deterministic tie-break), a live progress bar with ETA, and a summary panel tallying per-status and by-category counts as results stream in.
- **Site-database folder button.** A new **SITE DB FOLDER** button (Sweep toolbar) opens the writable site-database folder and supports a **drop-in `maigret_sites.json` override** — a quick fix for corruption or stale entries. It's **fail-safe**: a corrupt override silently falls back to the bundled database, so it can never brick detection.
- **Tuning, zero-config by default.** Detection works out of the box (deep-scan on, nothing to configure). Optional controls live in **Settings → Searchlight**: a deep-scan toggle, the ML toggle, and Found/Maybe threshold knobs (blank = the model's own calibrated values) with a reset.

## Why this beats a status-code check

Curated Maigret sites — those with hand-labeled presence/absence strings — stay **byte-for-byte authoritative**; the scorer never overrides them. It engages only on the **uncurated tail**: `status_code`/`response_url` sites, your custom additions, and sites whose curated strings have **rotted** after an HTML change. That makes detection *database-maintenance-independent* — it degrades gracefully where curation is absent or stale, which a curated-string database can't.

## The ML model (bundled, off by default — honest scope)

A logistic-regression model is **ported and bundled** from the MIT-licensed [Aliens_eye](https://github.com/arxhr007/Aliens_eye) (© 2021 Aaron Thomas; notice in `THIRD_PARTY_LICENSES`), with standardized inference and the model's own blend weight and thresholds read from the model file. It is **toggle-able in Settings but ships off by default**, because it **fails its feature-fidelity parity gate** (~46% agreement vs an 85% bar): two of its 30 features (`fingerprint_match_*`) require a per-site learned fingerprint cache this release doesn't build, so they can't be reproduced faithfully. A **fingerprint-free retrain** fit to the features we actually compute is the planned follow-on. The heuristic path that fixes the soft-404 false positives is **independent of the model and ships on** — you get the fix whether or not the ML toggle is ever touched.

## Trust posture (unchanged)

- No new network egress: the phase-2 body fetch reuses the existing Tor/clearnet probe path to the same hosts; the site-DB button is a local folder open.
- Deterministic scoring (pure functions, no clocks/RNG); untrusted HTML parsed with static patterns only.
- No telemetry, no phone-home.

## Quality

- **2,072 automated tests** passing, TypeScript strict, clean `pnpm build`.
- Built subagent-driven across **15 TDD tasks** with per-task review, then a parallel adversarial whole-branch review across four dimensions; **four confirmed findings fixed before merge** (ML `response_time` unit scaling, the `heuristic_score` model feature, `maybe` import-sanitization, and the Settings UI).

## Install

Windows NSIS installer attached.
SHA-256: `68ec255621f69939335b7a3ba68574ea8834e968e07367ab3ec33edd8c8d4b36`
Size: 906,303,596 bytes (865 MB)
