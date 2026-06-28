# Ghost Intel 98 — v3.24.0

**Searchlight learns your casework — local, private, on your terms.**

v3.23.0 shipped a detection model that stays **off**, because a generic model only *ties* the built-in heuristic, and there's no good source of ground-truth labels except real investigative use. This release closes that loop: the labeling and training happen **in the app**, turning your own verdicts into a personal model that adapts to *your* investigations.

## What's new

- **A "Learning" tab** in Searchlight — your one screen for the whole loop: where you stand, what to do next, and (eventually) a one-click enable.
- **One-click labeling** — 👍 **Real** / 👎 **Not real** thumbs appear inline on found/maybe sweep results, and in a focused **"review these"** queue of the most useful (uncertain) candidates. Each label captures the result's feature vector into a **personal, encrypted, on-disk corpus**.
- **Train on demand** — hit **Train** (the app nudges you once you have enough labels). It retrains a model on your labels, **seeded with the MIT-licensed Aliens_eye dataset** for a head start, fully deterministically.
- **It only turns on if it earns it** — after each train the app evaluates your model against the built-in heuristic **on your own held-out labels** and gives a **plain-language verdict** ("beats the built-in detector on your cases"). ML enables **only on your explicit confirm**, and a model that regresses below the heuristic **won't be used** — with a warning, never silently.

## Privacy & trust posture

- **Zero new network egress.** All labeling, training, and evaluation is local CPU + local **encrypted** storage. Your corpus and model **never leave your machine**; no telemetry.
- **No silent change.** Nothing trains in the background; nothing turns ML on without your click.
- The detection heuristic from v3.23.0 keeps doing the soft-404 job throughout, so **day one is already better than before** — the model only ever *adds* to it, once your data proves it helps.

## Honest scope

- **Ships with ML off by design.** This release is the *machinery* to earn ML on, locally, from your work — not a pre-trained model. Early on, before you've labeled enough, the heuristic carries detection (as it should). The Learning tab shows you exactly how far along the climb you are.
- The UI is built for **low cognitive load**: one clear next action at a time, a bounded queue (not the whole result list), plain language over raw metrics, and a visible progress milestone.

## Quality

- **2,190 automated tests** passing, TypeScript strict, clean `pnpm build`.
- Built across two plans — the headless engine (model store, vector capture, encrypted corpus, deterministic trainer + the precision-at-matched-recall gate, regression protection) and the Learning UI — reusing the v3.23.0 ML core.

## Install

Windows NSIS installer attached.
SHA-256: `a30820c22394de460678b1f3048462c6b736f3d06671c478c517c1ad6559cd95`
Size: 906,312,462 bytes (865 MB)
