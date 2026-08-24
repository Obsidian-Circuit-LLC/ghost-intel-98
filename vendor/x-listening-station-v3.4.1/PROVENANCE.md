# X Listening Station Enterprise v3.4.1 — GhostExodus's original source

Reference material, **not built and not bundled**. `vendor/` sits outside both `tsconfig.*.json`
`include` globs and the electron-vite renderer root, so nothing here is compiled into the app.

## Why it is in the repo

The embedded X Listening Station runs GhostExodus's renderer verbatim. "Verbatim" is only a
meaningful claim if it can be checked, so his original lives here and
`test/xls-embed-fidelity.test.ts` diffs the embedded copy against it. Any divergence is a defect,
not a decision.

It is also the answer to the failure mode that produced five consecutive display-picture releases:
each one re-derived his behaviour from our port instead of reading his source. His source is the
authority; when our behaviour and his disagree, his wins.

## Contents

- `src/main.tsx` — his whole renderer: type block, helper components, and one `App()`
- `src/styles.css` — his stylesheet
- `src/global.d.ts` — his `window.xls` declaration
- `electron/main.cjs` — his main process (state document, 53 handlers, capture, Tor)
- `electron/preload.cjs` — his context bridge, the exact `window.xls` surface
- `electron/enterprise.cjs` — his Enterprise additions
- `index.html`, `LICENSE`

Assets (his banner PNG) are not vendored; the app ships its own copy under `src/renderer/assets`.
