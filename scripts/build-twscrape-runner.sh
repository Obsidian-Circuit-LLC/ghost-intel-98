#!/usr/bin/env bash
# scripts/build-twscrape-runner.sh
#
# Build the twscrape-runner PyInstaller onedir sidecar for the current platform.
#
# Run natively on each target platform — no cross-compilation.
# Supported hosts: Linux x86-64, macOS x86-64, macOS arm64.
# For Windows: use scripts/build-twscrape-runner.bat instead.
#
# Usage:
#   bash scripts/build-twscrape-runner.sh [--clean]
#
#   --clean   wipe the build venv and vendor cache before building.
#
# Output directory (mirrors sidecar-client.ts productionSidecarPath()):
#   resources/twscrape-runner/<platform>/twscrape-runner/twscrape-runner
#
# After a successful build:
#   1. Copy the printed SHA-256 into src/main/x/sidecar-client.ts:
#        PINNED_SHA256['<process.platform>'] = '<sha256>';
#   2. Run: pnpm typecheck && pnpm test test/x-sidecar-build.test.ts
#   3. Continue with: pnpm package (or electron-builder)
#
# Supply-chain (spec §5.7):
#   - Packages downloaded once to a local vendor/ directory.
#   - requirements-lock.txt generated with --require-hashes via pip-compile.
#   - pip install uses the lockfile with --require-hashes (verify before exec).
#   - No network access at install time (--no-index, --find-links vendor/).
#   - Operator must verify pypi.org/project/twscrape/ belongs to vladkens
#     before the first run (see resources/twscrape-runner/requirements.txt).
#
# SEALED: The output binary is NOT committed to the repo.  This script is the
# operator build gate; the Electron app returns 'sidecar-missing' until the
# binary is present at the expected path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNNER_DIR="${REPO_ROOT}/resources/twscrape-runner"
VENV_DIR="${RUNNER_DIR}/.venv-build"
VENDOR_DIR="${RUNNER_DIR}/vendor"
LOCK_FILE="${RUNNER_DIR}/requirements-lock.txt"
BASE_REQS="${RUNNER_DIR}/requirements.txt"
SRC="${RUNNER_DIR}/twscrape-runner.py"

# ---- Platform detection (must match sidecar-client.ts platformDir()) ------

OS="$(uname -s)"
ARCH="$(uname -m)"
case "${OS}" in
  Darwin)
    if [[ "${ARCH}" == "arm64" ]]; then
      PLATFORM="mac-arm64"
      NODE_PLATFORM="darwin"
    else
      PLATFORM="mac-x64"
      NODE_PLATFORM="darwin"
    fi
    SHA_CMD="shasum -a 256"
    ;;
  Linux)
    PLATFORM="linux-x64"
    NODE_PLATFORM="linux"
    SHA_CMD="sha256sum"
    ;;
  *)
    echo "[build] ERROR: unsupported host OS '${OS}'." >&2
    echo "[build]        For Windows, use scripts/build-twscrape-runner.bat" >&2
    exit 1
    ;;
esac

OUT_DIR="${RUNNER_DIR}/${PLATFORM}/twscrape-runner"
BIN="${OUT_DIR}/twscrape-runner"
WORK_DIR="${RUNNER_DIR}/.build-work/${PLATFORM}"

echo "[build] ================================================================"
echo "[build] twscrape-runner sidecar build — Ghost Intel 98"
echo "[build] platform: ${PLATFORM}  (Node.js key: '${NODE_PLATFORM}')"
echo "[build] source:   ${SRC}"
echo "[build] output:   ${BIN}"
echo "[build] ================================================================"
echo ""

# ---- Pre-flight: verify source exists -------------------------------------

if [[ ! -f "${SRC}" ]]; then
  echo "[build] ERROR: source not found: ${SRC}" >&2
  exit 1
fi

# ---- Clean (optional) -----------------------------------------------------

if [[ "${1:-}" == "--clean" ]]; then
  echo "[build] --clean: removing build artifacts..."
  rm -rf "${VENV_DIR}" "${VENDOR_DIR}" "${WORK_DIR}"
  echo "[build] (lockfile preserved — delete ${LOCK_FILE} manually to re-pin)"
fi

# ---- Step 1: create build venv --------------------------------------------

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "[build] creating build venv at ${VENV_DIR} ..."
  python3 -m venv "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

echo "[build] Python: $(python3 --version)"
echo ""

# ---- Step 2: supply-chain gate — download + pin ----------------------------
#
# If requirements-lock.txt already exists, skip the download/pin step and use it.
# Delete requirements-lock.txt manually to force a re-pin (e.g. after a twscrape
# version bump following a doc_id rotation event).

if [[ ! -f "${LOCK_FILE}" ]]; then
  echo "[build] requirements-lock.txt not found — generating..."
  echo ""
  echo "[build] !! SUPPLY-CHAIN CHECK (spec §5.7) !!"
  echo "[build]    You are about to download packages from PyPI."
  echo "[build]    Before proceeding, verify:"
  echo "[build]      pypi.org/project/twscrape/ maintainer = vladkens"
  echo "[build]      github.com/vladkens/twscrape  (compare package content)"
  echo "[build]    Press ENTER to continue or Ctrl-C to abort."
  read -r _

  mkdir -p "${VENDOR_DIR}"

  echo "[build] downloading packages to ${VENDOR_DIR} ..."
  pip download \
    --dest "${VENDOR_DIR}" \
    -r "${BASE_REQS}" \
    2>&1

  echo ""
  echo "[build] generating hash-pinned lockfile with pip-compile..."
  pip install pip-tools --quiet
  pip-compile \
    --generate-hashes \
    --allow-unsafe \
    --output-file "${LOCK_FILE}" \
    "${BASE_REQS}" \
    2>&1

  echo ""
  echo "[build] generated: ${LOCK_FILE}"
  echo "[build] REVIEW the lockfile before continuing.  Press ENTER to proceed or Ctrl-C to abort."
  read -r _
fi

# ---- Step 3: install from lockfile with --require-hashes ------------------

echo "[build] installing from ${LOCK_FILE} with --require-hashes..."
pip install \
  --require-hashes \
  --no-index \
  --find-links "${VENDOR_DIR}" \
  -r "${LOCK_FILE}" \
  --quiet

echo "[build] install OK"
echo ""

# ---- Step 4: PyInstaller (--onedir; console mode required per spec §2.2) ---

echo "[build] running PyInstaller --onedir ..."
mkdir -p "${OUT_DIR}" "${WORK_DIR}"

pyinstaller \
  --onedir \
  --noconfirm \
  --name twscrape-runner \
  --distpath "${RUNNER_DIR}/${PLATFORM}" \
  --workpath "${WORK_DIR}" \
  --specpath "${RUNNER_DIR}" \
  "${SRC}"
# NOTE: the 'noconsole' PyInstaller mode is intentionally NOT used (spec §2.2):
#       enabling it sets stdio to None in the frozen binary, which breaks IPC over
#       stdin/stdout.  Never pass that flag to this build.

# ---- Step 5: verify output and compute SHA-256 ----------------------------

if [[ ! -f "${BIN}" ]]; then
  echo "[build] ERROR: expected binary not produced at ${BIN}" >&2
  exit 1
fi

SHA256="$(${SHA_CMD} "${BIN}" | awk '{print $1}')"
echo ""
echo "[build] ================================================================"
echo "[build] SUCCESS"
echo "[build] binary: ${BIN}"
echo "[build] SHA-256: ${SHA256}"
echo "[build] ================================================================"
echo ""
echo "[build] Next steps — MUST complete before packaging:"
echo ""
echo "[build]   1. Commit the SHA into src/main/x/sidecar-client.ts:"
echo "[build]      PINNED_SHA256: Record<string, string> = {"
echo "[build]        ...,"
echo "[build]        ${NODE_PLATFORM}: '${SHA256}',"
echo "[build]        ..."
echo "[build]      };"
echo ""
echo "[build]   2. Verify: pnpm typecheck && pnpm test test/x-sidecar-build.test.ts"
echo ""
echo "[build]   3. Package: pnpm package (or electron-builder)"
echo ""
echo "[build] WARNING: the binary is NOT committed to git (operator-lock gate)."
echo "[build]          The Electron app returns 'sidecar-missing' on systems"
echo "[build]          where the binary is absent — this is the expected sealed state."
