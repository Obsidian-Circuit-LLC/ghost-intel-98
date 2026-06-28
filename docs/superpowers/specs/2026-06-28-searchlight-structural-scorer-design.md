# Searchlight Structural + ML Detection Scorer — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation-plan
**Target version:** 3.23.0 (no beta)
**Origin:** Operator (GhostExodus) dogfooding feedback — soft-404 false positives in username sweeps; request to integrate Aliens_eye-style detection (structural feature scoring + ML) and a `rich`-style results UI into Searchlight.

---

## Goal

Replace Searchlight's status-code-trusting fallback detection with a structural confidence scorer (heuristic weighted signals + a ported logistic-regression ML model, blended) that distinguishes a real profile page from a soft-404 that returns HTTP 200, plus a first-class `maybe` tier, an adaptive two-phase probe, an in-app retrain pipeline, and a modernized sweep-panel UI.

## Problem

`src/shared/searchlight/interpret.ts` resolves non-curated sites by trusting the status code:

```ts
// status_code checkType:
return finalize(result.statusCode === 200, 'high');   // HIGH-confidence found on a bare 200
```

Many modern sites return **200 for non-existent users** (soft-404), so this surfaces confident false positives. The operator observes this in live casework. The discriminator between a real profile and a soft-404 lives entirely in the **response body** (profile markers vs. error template) — invisible to a HEAD/status check.

Searchlight already does well where Maigret curates per-site `presenseStrs`/`absenceStrs` (those paths read the body and stay authoritative). The false positives are concentrated in the **uncurated tail**: `status_code`/`response_url` sites, custom user-added sites, and sites whose curated strings have rotted after an HTML change. A structural scorer is *database-maintenance-independent* — it degrades gracefully where curation is absent or stale.

## Scope decisions (operator-approved)

1. **Scorer scope:** fallback tail only. Curated `message`-string sites stay byte-for-byte authoritative; the scorer never overrides them.
2. **Body-fetch posture:** adaptive two-phase. Cheap `HEAD` first; escalate to a body `GET` only when the cheap verdict is ambiguous (200, no redirect). On by default; a `lightweightMode` setting forces HEAD-only.
3. **Tuning surface:** threshold knobs only (Found/Maybe cutoffs in settings); per-signal weights stay audited code constants.
4. **Maybe tier:** first-class `SweepStatus`, with its own badge, tally, and filter.
5. **Spec boundary:** scorer **and** full sweep-panel UI polish (progress, sortable columns, summary panel).
6. **ML:** baked in, matching Aliens_eye — **port their model verbatim AND add in-app retrain**.

## Global Constraints

- **No new network egress.** Phase-2 `GET` reuses existing `socksDial`/`safeFetch` to the *same* hosts; netns/no-egress gate must still pass. Retrain is loopback-only/offline.
- **Determinism in critical paths.** Scorer and ML inference are pure functions of the feature vector — no `Date.now`/RNG inside scoring (elapsed is an *injected* input). The retrain fit is full-batch, zero-init, fixed-iteration, stable-ordered, **no RNG** → bit-identical model from identical data. `determinism-auditor` gates `signals.ts`, `scorer.ts`, `ml.ts`, `train.ts`.
- **Untrusted-HTML safety.** Body parsing runs in the main process on untrusted HTML: **static regexes only, never `new RegExp(untrustedInput)`** (ReDoS/main-thread-freeze rule), guarded `JSON.parse`, bounded by the existing 64 KB `BODY_CAP`. Routed through the commit-time security-review hook.
- **No telemetry, no analytics, no phone-home.** Unchanged charter baseline.
- **Encrypt-at-rest.** Training samples + retrained model persist via the existing Searchlight secure-fs store.
- **Attribution.** Aliens_eye is MIT (© 2021 Aaron Thomas). `THIRD_PARTY_LICENSES` must carry its notice, covering the vendored `model.json` and the ported extractor logic.
- **Installer size:** negligible — `model.json` is ~KB of coefficients dropped into the existing `resources/searchlight` extraResources entry; no new bundle wiring, no native dep, no blob.
- **Releases are operator-authority.** Version `3.23.0` proposed; cut only on explicit operator instruction.

---

## Architecture

### New pure modules (shared, deterministic, unit-testable)

- `src/shared/searchlight/signals.ts` — `extractSignals(site, raw, url): SignalVector`. Computes **cheap signals** always; **body signals** only when `raw.body` is present. Dependency-free, bounded parsing (static regexes + a `<script type="application/ld+json">` scan with guarded `JSON.parse`).
- `src/shared/searchlight/scorer.ts` — `DEFAULT_WEIGHTS`, `scoreSignals(sig, weights): number` = `sigmoid(Σ weights·signals / SCALE)`; `classify(prob, thresholds): { status: 'found'|'maybe'|'not_found', confidence }`. Pure.
- `src/shared/searchlight/ml.ts` — `predict(vector, model): number` = `sigmoid(Σ coef·z_i + intercept)` where `z_i = (x_i − mean_i) / scale_i` (per-feature standardization). The model is **self-describing** JSON (shape confirmed from the shipped artifact, v2.0.0): `{ version, feature_schema: string[30], mean: number[30], scale: number[30], coef: number[30], intercept: number, ml_weight: number, thresholds: { found: number, not_found: number }, training: {...} }`. `predict` aligns the feature vector to `feature_schema` by name. Pure, deterministic.

### Integration (single decision authority preserved)

- `interpret.ts`: only the **fallback branches** (the `status_code` / `response_url` / no-string `finalize(statusCode===200, …)` paths) route through the blend. Curated `message` sites and the `blocked`/`error` short-circuits are untouched.
- **Blend (verbatim Aliens_eye, model-driven):** `final = ml_weight·ml + (1 − ml_weight)·heuristic` when `useMl` and a model is loaded (the shipped model's `ml_weight` is 0.6); else heuristic-only. `classify()` uses the model's own `thresholds` (shipped: found 0.5559, not_found 0.3224) as defaults, overridden by the `foundThreshold`/`maybeFloor` settings when the operator sets them. Hardcode none of these — read from the model.

### Adaptive two-phase (in `sweep.ts`)

1. Cheap `HEAD` probe → interpret on cheap signals only (no body). **Phase 1 is heuristic-only** — the ML model is never run on a body-less vector (its profile-marker features would be `0`, i.e. out-of-distribution); ML runs only in phase 2 against the full vector.
2. A clean `404` / redirect-away resolves immediately — **no body fetched**.
3. A bare `200`-no-redirect scores into the **Maybe band on cheap signals alone, and that Maybe verdict is the escalation trigger** → re-probe `GET` (body) over a fresh circuit → re-interpret with the full signal set, now applying the model-driven blend (`ml_weight·ml + (1 − ml_weight)·heuristic`).
4. Phase-2 `GET` failure → **fall back to the phase-1 cheap verdict** (graceful; never worse than today).
5. `lightweightMode` setting disables escalation entirely (HEAD-only).

Curated `message` sites already fetch the body once and are unaffected (scorer not invoked — tail-only).

### Model storage

- Bundled default: `resources/searchlight/model.json` (vendored from Aliens_eye). The `searchlight` extraResources entry already exists — no `package.json` build wiring change.
- `src/main/searchlight/model-store.ts`: load bundled default, override from a retrained model in userData (secure-fs), reset-to-default.

---

## Signals & weights

Lifted `detector.py` baseline (ratios authoritative; absolute `SCALE` re-derived against fixtures — see Calibration). Weights to be confirmed against a **verbatim** read of `features.py`/`detector.py` during implementation (the feature-fidelity gate).

**Cheap signals (phase 1, no body):** `http_200` (+5), `http_404` (−10, strongest negative), `http_5xx` (−3), `http_3xx`/`http_4xx` (small), `has_username_in_path` (+), `has_auth_pattern` (−, redirect/URL contains `/login`,`/signin`), `redirect_count` (−, 1-hop presence — Tor path captures one `location`), `response_time`/`content_length` (weak).

**Body signals (phase 2, on escalation):** `og_type_profile` (×6, strongest positive), `has_json_ld_person` (×5), `meta_has_username` (+5), `username_in_canonical` (×4), `profile_section_count` (×4), `error_section_count` (×3 penalty), `meta_error_keyword_count` (×3 penalty), `meta_positive_keyword_count` (×2), `error_keyword_count` (×2 penalty), `positive_keyword_count` (×1.5), `title_has_username` (+), `img_count`/`form_count`/`input_count`/`link_count`/`text_length` (weak).

**Unavailable for v1:** `fingerprint_match_found`/`fingerprint_match_not_found` require Aliens_eye's learned per-site fingerprint cache (a subsystem we don't have). Under standardization, feeding raw `0` is **not** neutral (`(0−mean)/scale` injects a fixed offset); instead set these two features to their training `mean` so they standardize to `0` (neutral, zero contribution). A per-site fingerprint cache is a noted *future* enhancement. `heuristic_score` (feature #30) *is* retained — our heuristic score feeds the ML vector as that feature, computed with Aliens_eye's exact weights and sigmoid scale (their 6.0, not a re-derived value) so it lands in the distribution the model's `mean`/`scale` expect.

**Calibration:** the heuristic uses Aliens_eye's exact weights and sigmoid `SCALE` = 6.0 (not re-derived), so `heuristic_score` matches the distribution the model was trained against. The heuristic-only path (phase 1, or `useMl=false`) classifies that score against the active thresholds. The **parity test** against `seed_dataset.csv` (below) quantifies any drift introduced by the unavailable fingerprint terms; if drift exceeds tolerance, the remedy is a Plan-2 retrain of a fingerprint-free model fit to our exact feature set — not a hand-tuned `SCALE`.

**English-keyword limitation (accepted):** keyword signals are English-first. Mitigation is structural — `og:type`, JSON-LD, and canonical are language-independent and carry the heaviest weights, so non-English soft-404s are still caught by structure. Keyword lists ship as extensible constants.

---

## ML port & feature fidelity

- **Standardization is in the model file:** `vectorize_features()` emits raw values, but `predict` standardizes with the model's stored `mean`/`scale` before the dot product. So a verbatim port needs the extractor to match theirs **and** must apply `(x − mean)/scale` — both `mean` and `scale` ship in `model.json`, so we have everything for an exact port.
- **Doc-vs-artifact discrepancy (resolved in favor of the artifact):** `WORKING.md`/`detector.py` prose says `ml_weight` 0.4 and thresholds 0.6/0.35; the shipped `model.json` says `ml_weight` 0.6 and thresholds 0.5559/0.3224. The shipped model is what actually runs and is authoritative — read these from the file, never hardcode the prose values.
- **Feature-fidelity gate (plan task):** obtain `features.py` + both keyword lists **verbatim**; pin as constants; **parity test** — re-vectorize their `seed_dataset.csv` rows through our extractor and confirm `predict()` reproduces the model's outputs within tolerance. This test is the proof the port is faithful.
- **Charter posture:** shipping the pre-trained model = we never train at build → zero nondeterminism; inference is a pure dot-product + sigmoid over ~30 auditable coefficients in version control (not an opaque blob, no native dep).

---

## In-app retrain (collect + fit)

- **Collect:** a "Train" tab. Label sources: (a) operator-entered known-exists / known-not-exists ground truth run through a labeled sweep; (b) labeling existing sweep results (mark a row right/wrong → a `{featureVector, label}` sample). Samples persist in the encrypted secure-fs store. Optionally vendor `seed_dataset.csv` to bootstrap.
- **Fit:** `src/main/searchlight/train.ts` — full-batch gradient descent, zero-init, fixed iteration count, stable sample ordering, **no RNG** → bit-identical model from identical data. Writes a new `model.json` to userData; active model switches; reset reverts to the bundled Aliens_eye default.
- Operator-triggered, offline (loopback only).

---

## Data model & settings

- `types.ts`: add `'maybe'` to `SweepStatus` (canonical order `found → maybe → blocked → not_found → unknown → error`); add `probability?: number`; new `SignalVector` type. Confidence for scored results derived from distance to nearest threshold.
- **Ripple (must be in the same task as the enum change):** `interpret.ts`, SweepPanel rows + filter, `export-pdf.ts` status labels/colors, and the **searchlight contract/interpret tests** (exact-set assertions that bite on enum changes — known prior pain).
- Settings (threshold knobs only): `searchlight.scorer.foundThreshold` and `searchlight.scorer.maybeFloor` default to `null` → use the active model's `thresholds.found`/`thresholds.not_found` (shipped: 0.5559 / 0.3224); an operator-set number overrides. `searchlight.scorer.lightweightMode` (false), `searchlight.scorer.useMl` (true). Settings → Searchlight, with reset-to-defaults (clears the overrides back to the model's values).

## Sweep-panel UI (full polish)

- **Maybe badge:** amber (`~#d8a83a` on dark) with inline probability (`Maybe · 48%`). Background **restated on `.sl-sweep-table`/`.sl-sweep-th` class** per the 98.css white-cascade rule.
- **Sortable columns:** Site / Status / Confidence(%) / Category / Response-time, asc↔desc, **stable deterministic tie-break** (by site name).
- **Live progress + ETA:** Win98 progress bar tracking **sites checked (0..total)**, never requests (escalations stay invisible), rolling-average ETA, cancel via existing `cancelSweep`.
- **Summary panel:** live per-status tallies (Found/Maybe/Blocked/Not-found/Unknown/Error) + by-category mini-breakdown, updating as results stream.

---

## Testing strategy

- `test/searchlight-signals.test.ts` — cheap signals from synthetic `RawCheckResult`s; body signals from real-profile + soft-404 HTML fixtures; case-insensitive username match; malformed JSON-LD → guarded `0`, no throw; same input → identical vector.
- `test/searchlight-scorer.test.ts` — **load-bearing regression = the operator's screenshot, verbatim:** real-profile fixture (200 + `og:type` + JSON-LD `Person` + title=username) classifies **found**; soft-404 fixture (200 + "doesn't exist" + error template) classifies **not_found** — under the active model thresholds. Boundary tests at the model's `thresholds`; an operator threshold override flips the verdict.
- `test/searchlight-ml.test.ts` — `predict()` determinism; **parity test** vs. `seed_dataset.csv`; `useMl=false` → heuristic-only path.
- `test/searchlight-interpret.test.ts` (extend) — fallback branches route through the blend; **curated `message`-string sites stay byte-for-byte authoritative** (explicit assertion); blocked/error short-circuits unchanged.
- `test/searchlight-sweep.test.ts` — adaptive two-phase via mocked probe: ambiguous 200 → exactly one phase-2 fetch; clean 404/redirect → zero body fetches; phase-2 failure → phase-1 fallback.
- `test/searchlight-train.test.ts` — fit determinism (identical data → bit-identical model); sample round-trip through mock secure-fs.
- Settings round-trip; `lightweightMode` disables escalation.
- UI: `maybe` badge verified via the headless Playwright computed-style harness (paints amber-on-dark, not white); sortable headers; live tallies; progress tracks sites.
- Gates: `determinism-auditor` over `signals.ts`/`scorer.ts`/`ml.ts`/`train.ts`; security-review the body parser; netns/no-egress with the scorer + retrain enabled.

---

## Implementation decomposition (two sequenced plans, one spec)

**Plan 1 — Detection** (shippable on its own; runs the full ported Aliens_eye model):
signals + heuristic scorer + ported ML inference + blend + `useMl` + adaptive two-phase + `maybe` status + sweep-panel UI (progress/sortable/summary) + threshold settings + model-store (bundled default + override hooks) + attribution + the feature-fidelity parity gate.

**Plan 2 — Retrain** (builds on Plan 1's extractor):
Train tab + result labeling + sample store + deterministic fit + model override/reset + optional `seed_dataset.csv` bootstrap.

Both may land in `3.23.0`; the split is implementation/review structure, not separate releases.

---

## Out of scope / future

- Per-site learned fingerprint cache (`fingerprint_match_*` signals).
- Non-English keyword lists (structure-only fallback ships in v1).
- macOS sidecar / cross-platform (tracked elsewhere).
