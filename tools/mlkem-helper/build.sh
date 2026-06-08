#!/usr/bin/env bash
# Build the DCS98 ML-KEM-1024 helper (mlkem-helper.c) against AWS-LC, into
# resources/mlkem/<platform>/. Run once per target platform; the output binary is bundled via
# package.json extraResources and hash-pinned in scripts/fetch-mlkem.mjs + the runtime client.
#
# PRODUCTION / FIPS: for the FIPS-validated module, build AWS-LC from its FIPS-validated release with
# the documented FIPS build (-DFIPS=1 + the validated toolchain), so the module runs its power-on
# self-test at init. The command below builds a REGULAR AWS-LC (correct ML-KEM-1024, but not the
# validated module) — use it for dev/CI functional builds; swap in the FIPS build for release.
#
# Per-platform native builds: linux-x64 builds here; win-x64 needs a Windows toolchain (MSVC/clang)
# and mac-* needs macOS — produce those on their own CI runners, drop into resources/mlkem/<platform>/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
AWSLC="${AWSLC_DIR:-/tmp/aws-lc}"           # path to a built AWS-LC checkout (override with AWSLC_DIR)
PLATFORM="${PLATFORM:-linux-x64}"
OUT="$ROOT/resources/mlkem/$PLATFORM"
BIN="mlkem-helper"; [ "$PLATFORM" = "win-x64" ] && BIN="mlkem-helper.exe"

if [ ! -f "$AWSLC/build/crypto/libcrypto.a" ]; then
  echo "Build AWS-LC first, e.g.:"
  echo "  git clone --depth 1 https://github.com/aws/aws-lc \"$AWSLC\""
  echo "  cmake -GNinja -B \"$AWSLC/build\" -S \"$AWSLC\" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF"
  echo "  ninja -C \"$AWSLC/build\" crypto"
  echo "  # (FIPS release build for production — see AWS-LC's FIPS docs)"
  exit 1
fi

mkdir -p "$OUT"
if [ "$PLATFORM" = "win-x64" ]; then
  # Cross-compile from Linux with mingw-w64 (verified working; functional, NOT the FIPS module).
  # Requires a mingw cross-build of AWS-LC (libcrypto.a), e.g.:
  #   cmake -GNinja -B "$AWSLC/build-win" -S "$AWSLC" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  #     -DBUILD_TESTING=OFF -DOPENSSL_NO_ASM=ON -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=AMD64 \
  #     -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
  #     -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres
  #   ninja -C "$AWSLC/build-win" crypto
  # -lpthread = mingw winpthreads (AWS-LC's cross build uses the pthread threading impl); -static makes
  # the .exe standalone (no libgcc/winpthread DLLs). NOTE: Windows stdio MUST be binary (handled in
  # mlkem-helper.c via _setmode) — without it the length-prefixed protocol corrupts.
  x86_64-w64-mingw32-gcc -O2 -I"$AWSLC/include" -o "$OUT/$BIN" "$HERE/mlkem-helper.c" \
    "$AWSLC/build-win/crypto/libcrypto.a" -lpthread -lws2_32 -lbcrypt -ladvapi32 -lcrypt32 -static -static-libgcc
else
  cc -O2 -I"$AWSLC/include" -o "$OUT/$BIN" "$HERE/mlkem-helper.c" "$AWSLC/build/crypto/libcrypto.a" -lpthread -ldl
fi
echo "built $OUT/$BIN"
sha256sum "$OUT/$BIN" || shasum -a 256 "$OUT/$BIN"
echo "→ pin this hash in scripts/fetch-mlkem.mjs (PINNED) and src/main/services/mlkem-sidecar.ts (PINNED_SHA256)"
