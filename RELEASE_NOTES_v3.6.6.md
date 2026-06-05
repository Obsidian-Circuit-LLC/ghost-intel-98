# Dead Cyber Society 98 — v3.6.6

**A warmer startup chime, and the TTS voice picker is honest again.**

## What's new

- **New startup chime.** The launch sound is a revoiced, lower-register **original** synthesized
  power-on swell — an F-major bed (with faintly detuned twin oscillators for an analog shimmer), a
  slow arpeggio rising an octave, and two soft bells settling on the major third so it resolves warm
  rather than shrill. Like every other sound in the app it is generated at runtime from oscillators
  — **no sampled audio, no copyrighted assets.** It is *not* the Windows 9x startup recording.
- **TTS voice picker no longer silently disappears.** When text-to-speech is on but no eligible
  on-device voice is found, the picker used to render *nothing*, which looked like the feature had
  been removed. It now says **why**: cloud/"online" voices are blocked by design (no-cloud), so the
  message points you to install Windows Natural voices (Settings → Accessibility → Speech).
- **Live voice discovery.** Voices are now tracked with a persistent `voiceschanged` subscription
  in addition to the initial load. Voices that Chromium populates *after* launch — or a voice pack
  you install while the app is open — now appear in the picker without a restart, instead of being
  lost to the old one-shot fetch window.

## Why the voice picker looked "gone"

Nothing was stripped. The selector has always been gated on at least one **on-device** voice
existing (`localService === true`) — the no-cloud posture filters out cloud voices, and `speak()`
fails closed rather than letting Chromium fall back to a cloud voice that would egress text. If your
machine only had cloud voices, or voices populated after the initial fetch, the control was hidden
with no explanation. v3.6.6 keeps the no-cloud enforcement exactly as-is and just stops hiding the
reason.

## Verification

- `typecheck` clean · **254 tests** (3 new: `onVoicesChanged` does not fire on subscribe, emits the
  mapped list with `remote = !localService` when `voiceschanged` fires, and stops after unsubscribe).
- The no-cloud enforcement tests are unchanged and still pass — cloud voices stay blocked, `speak()`
  still fails closed on a cloud-only / cold-start empty list.
- Audio is synthesized at runtime; the chime can't be unit-tested by ear, but the boot path
  typechecks, builds, and stays wired into launch (gated behind the existing startup-sound setting).

## Notes

- Renderer-only change — no IPC, network-egress, or encryption-at-rest code touched. The no-cloud
  TTS guarantee is intact.
- **Unsigned** build — SmartScreen will warn; **More info -> Run anyway**. Verify the SHA-256 below.

---

**Artifact:** `DCS98-Setup-3.6.6.exe` (124,481,407 bytes ≈ 119 MB, NSIS, x64, unsigned)
**SHA-256:** `8aab66ed7f82315129eab2037bbc8ca512690418f93ec0fc69124ca7d312d2dd`
