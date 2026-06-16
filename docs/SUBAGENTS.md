# Subagent Deployment Plan

Per operator directive, every module of Ghost Intel 98 is built with explicit subagent review. Subagents are recorded in commit messages (`Reviewed-by:` trailer) so the audit trail is permanent.

## When each subagent runs

| Phase | Subagent | Trigger | Purpose |
|---|---|---|---|
| Before each MVP module | `feature-dev:code-architect` | Module start | Per-module architecture blueprint |
| After first cut | `code-simplifier:code-simplifier` | First green build | Trim accidental complexity |
| Pre-commit | `feature-dev:code-reviewer` | Before `git commit` | Confidence-filtered bug/quality check |
| Disk + secrets paths | `pr-review-toolkit:silent-failure-hunter` | Touching file I/O or safeStorage | Catch swallowed errors |
| Library edge-case research | `general-purpose` | New external dep (ssh2, imapflow, hls.js, etc.) | Off-thread research |
| Plan deviation > 1 module | `skeptic` | Considering a pivot | Challenge load-bearing assumption |

## Recording subagent review in commit messages

```
feat(mvp-3): Cases module CRUD + dashboard

Implements CaseStore.list / create / read / rename / archive / delete
backed by json-fs. Dashboard + detail view in renderer.

Reviewed-by: feature-dev:code-architect (architecture)
Reviewed-by: feature-dev:code-reviewer (no high-confidence findings)
Reviewed-by: pr-review-toolkit:silent-failure-hunter (1 swallowed error fixed: rename collision)
```

## Anti-patterns the subagents enforce

- No hard-coded user paths
- No telemetry / analytics / phone-home
- No plaintext credentials
- No silent error swallowing in file I/O or IPC handlers
- No untyped IPC channels
- No copyrighted audio assets
- No discovery / brute-force features in EyeSpy
