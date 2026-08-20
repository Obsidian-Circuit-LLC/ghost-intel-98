# Releasing Ghost Intel 98

## Why this is a script and not a checklist

Two steps in this pipeline are easy to get wrong and expensive to get wrong:

1. **A release must not be published before its assets are attached.** Publishing raises
   `release: published`, which triggers `anonymize-release.yml` — that workflow deletes and recreates
   the release to change its author. If it runs while a ~900MB installer is still uploading, the
   installer is destroyed and GitHub holds no other copy. Drafts raise no event, so the order is
   always **draft → upload → publish**.
2. **A release created by a person is authored by that person, permanently.** GitHub will not
   reassign a release's author, so anonymity depends on the swap actually happening.

`scripts/publish-release.mjs` enforces both, and the workflow makes the swap automatic even for a
release cut by hand or from the web UI.

## Routine

```bash
# 1. bump package.json, write RELEASE_NOTES_vX.Y.Z.md, commit, merge to main
pnpm typecheck && pnpm vitest run          # green before building
pnpm package:win                           # ~900MB installer in release/X.Y.Z/

# 2. stamp the notes with the real hash + size (no __SHA256__ / __SIZE__ left)
sha256sum release/X.Y.Z/GhostIntel98-Setup-X.Y.Z.exe
stat -c '%s' release/X.Y.Z/GhostIntel98-Setup-X.Y.Z.exe

# 3. commit the stamped notes, push main, then publish:
node scripts/publish-release.mjs vX.Y.Z RELEASE_NOTES_vX.Y.Z.md release/X.Y.Z/GhostIntel98-Setup-X.Y.Z.exe
```

The script refuses to publish if the notes still contain a placeholder or do not carry the built
asset's SHA-256, verifies the uploaded asset's digest against the local file **before** flipping the
draft, and then waits for the release to become `github-actions[bot]`, failing loudly if it does not.

## Verifying a build carries no maintainer identity

The packaged app embeds `package.json`'s `author`, so a stale value ships inside every installer.

```bash
A=release/X.Y.Z/win-unpacked/resources/app.asar
grep -a -c 'Obsidian Circuit' "$A"     # expect >= 1
grep -a -c 'users.noreply.github.com' "$A"   # expect 0
```

Note `grep -a` (binary-safe), not `grep -c` alone.

## If the automatic swap fails

`anonymize-release.yml` never deletes a release until every asset reports `uploaded` and the asset
set has stopped changing, and it leaves the tag alone regardless. To redo a swap by hand:

```bash
gh workflow run republish-release.yml -f tags="vX.Y.Z"
```

## Publishing without the swap

Don't. A release authored by a person cannot be reassigned — the only remedy is deleting and
recreating it, which costs a full re-upload of the installer.
