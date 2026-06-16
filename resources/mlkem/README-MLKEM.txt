Ghost Intel 98 ML-KEM-1024 helper (chat handshake PQ leg)
================================================

The chat handshake's ML-KEM-1024 operations are served by a small native helper that links AWS-LC's
libcrypto, rather than an in-process JS implementation. This gives the KEM an audited,
constant-time-designed, FIPS-tested implementation, isolated from the V8 JIT.

Layout (bundled via package.json `extraResources`, resolved at runtime by
src/main/services/mlkem-sidecar.ts):

    resources/mlkem/
      linux-x64/mlkem-helper
      win-x64/mlkem-helper.exe
      mac-x64/mlkem-helper
      mac-arm64/mlkem-helper

Build: see ../../tools/mlkem-helper/build.sh (compiles mlkem-helper.c against a built AWS-LC).
Per-platform binaries must be built on their own toolchains (win-x64 on Windows, mac-* on macOS).

PRODUCTION / FIPS: for the FIPS posture (CNSA 2.0 / ML-KEM-1024, security category 5), build the
helper against AWS-LC's FIPS-VALIDATED release using AWS-LC's documented FIPS build, so the validated
module runs its power-on self-test at init. A regular AWS-LC build is functionally correct ML-KEM-1024
but is NOT the validated module.

Integrity: after building, pin each binary's SHA-256 in BOTH:
  - scripts/fetch-mlkem.mjs   (PINNED, verified at package time)
  - src/main/services/mlkem-sidecar.ts (PINNED_SHA256, verified before spawn — fail-closed)

If a platform's helper is absent, that build ships without ML-KEM and chat fails closed there (it will
not silently fall back to a JS implementation).

This binary is NOT vendored in git history beyond the operator-supplied drop; treat it like the other
operator/CI-supplied resources (tor, piper, vosk, firefox).
