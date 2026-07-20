# Ghost Intel 98 — v3.56.0

**Jukebox: mp3 playback no longer cuts out after a minute or two.**

GhostExodus reported that a track would start playing fine and then, at some random point a minute or two in, just go silent — a glitch that appeared with the Windows-Media-Player reskin.

## Root cause

The reskin added a Web-Audio EQ graph. The Jukebox now routes the `<audio>` element through `createMediaElementSource → [10-band EQ] → analyser → ctx.destination`, so sound reaches the speakers **only** through that graph. The graph object kept references to the audio context, the EQ bands, and the analyser — but the **`MediaElementAudioSourceNode` (the node the `<audio>` feeds into) was held only in a local variable** and dropped once the graph was built.

Chromium garbage-collects an unreferenced `MediaElementAudioSourceNode` *even while it is connected*, which severs the `<audio>` element from `ctx.destination`. The element keeps "playing" — its clock advances, the seek bar moves — but no audio is produced. Because garbage-collection timing is non-deterministic, it struck "randomly, after a minute or two."

## The fix

Retain the source node on the graph instance, exactly as the context, EQ bands, and analyser already were. One field; no behavior change beyond keeping the node alive.

This was diagnosed systematically: the two obvious alternatives were ruled out first — there is **no timer** that pauses playback, and the `<audio>` element is **not remounted** on a shade/mode switch (it sits outside those conditionals), which left GC of the unreferenced node as the cause. A regression test asserts the graph now retains the source-node reference.

> **Final confirmation is real-world:** GC timing can't be reproduced headlessly, so the definitive check is playing a track for several minutes on this build. The mechanism and fix are the standard Web-Audio practice (keep references to your nodes).

## Verification

- **3,692 automated tests** passing (1 skipped); `pnpm typecheck` clean across both project configs.
- No new dependency, no new network egress.

## Install

Windows NSIS installer — `GhostIntel98-Setup-3.56.0.exe` (per-user, no admin; unsigned → **More info → Run anyway**):

- **SHA-256:** `7651d94731215b51a275f6f0f17ab5dce8ec2d0b69d302483eeb2608f6e057ac`
- **Size:** 963,132,904 bytes (~963 MB).

*Everything from v3.55.0 and earlier carries forward.*
