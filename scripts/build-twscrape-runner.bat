@echo off
REM scripts\build-twscrape-runner.bat
REM
REM Build the twscrape-runner PyInstaller onedir sidecar for Windows x64.
REM Must be run natively on a Windows x64 host.
REM For Linux/macOS: use scripts/build-twscrape-runner.sh instead.
REM
REM Usage:
REM   build-twscrape-runner.bat [--clean]
REM
REM Output directory:
REM   resources\twscrape-runner\win-x64\twscrape-runner\twscrape-runner.exe
REM
REM After a successful build:
REM   1. Copy the printed SHA-256 into src\main\x\sidecar-client.ts:
REM        PINNED_SHA256['win32'] = '<sha256>';
REM   2. Run: pnpm typecheck && pnpm test test/x-sidecar-build.test.ts
REM   3. Continue with: pnpm package:win
REM
REM Supply-chain (spec §5.7):
REM   - Verify pypi.org/project/twscrape/ belongs to vladkens before running.
REM   - Packages downloaded to vendor\ and pinned with --require-hashes.
REM   - No network access at install time once vendor\ is populated.
REM
REM SEALED: The output binary is NOT committed to the repo.

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set REPO_ROOT=%SCRIPT_DIR%..
set RUNNER_DIR=%REPO_ROOT%\resources\twscrape-runner
set VENV_DIR=%RUNNER_DIR%\.venv-build
set VENDOR_DIR=%RUNNER_DIR%\vendor
set LOCK_FILE=%RUNNER_DIR%\requirements-lock.txt
set BASE_REQS=%RUNNER_DIR%\requirements.txt
set SRC=%RUNNER_DIR%\twscrape-runner.py
set PLATFORM=win-x64
set OUT_DIR=%RUNNER_DIR%\%PLATFORM%\twscrape-runner
set BIN=%OUT_DIR%\twscrape-runner.exe
set WORK_DIR=%RUNNER_DIR%\.build-work\%PLATFORM%

echo [build] ================================================================
echo [build] twscrape-runner sidecar build -- Ghost Intel 98
echo [build] platform: win-x64  (Node.js key: 'win32')
echo [build] source:   %SRC%
echo [build] output:   %BIN%
echo [build] ================================================================
echo.

if not exist "%SRC%" (
    echo [build] ERROR: source not found: %SRC%
    exit /b 1
)

if "%1"=="--clean" (
    echo [build] --clean: removing build artifacts...
    if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"
    if exist "%VENDOR_DIR%" rmdir /s /q "%VENDOR_DIR%"
    if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%"
    echo [build] (lockfile preserved; delete %LOCK_FILE% manually to re-pin^)
)

REM ---- Step 1: create build venv ------------------------------------------

if not exist "%VENV_DIR%" (
    echo [build] creating build venv at %VENV_DIR% ...
    python -m venv "%VENV_DIR%"
)
call "%VENV_DIR%\Scripts\activate.bat"

for /f "tokens=*" %%v in ('python --version') do echo [build] Python: %%v
echo.

REM ---- Step 2: supply-chain gate ------------------------------------------

if not exist "%LOCK_FILE%" (
    echo [build] requirements-lock.txt not found -- generating...
    echo.
    echo [build] !! SUPPLY-CHAIN CHECK (spec §5.7) !!
    echo [build]    Before continuing, verify:
    echo [build]      pypi.org/project/twscrape/ maintainer = vladkens
    echo [build]      github.com/vladkens/twscrape  (compare content^)
    echo [build]    Press ENTER to continue or Ctrl-C to abort.
    pause > nul

    if not exist "%VENDOR_DIR%" mkdir "%VENDOR_DIR%"

    echo [build] downloading packages...
    pip download --dest "%VENDOR_DIR%" -r "%BASE_REQS%"

    echo.
    echo [build] generating hash-pinned lockfile...
    pip install pip-tools --quiet
    pip-compile --generate-hashes --allow-unsafe --output-file "%LOCK_FILE%" "%BASE_REQS%"

    echo.
    echo [build] generated: %LOCK_FILE%
    echo [build] REVIEW the lockfile before continuing. Press ENTER to proceed or Ctrl-C to abort.
    pause > nul
)

REM ---- Step 3: install with --require-hashes --------------------------------

echo [build] installing from %LOCK_FILE% with --require-hashes...
pip install --require-hashes --no-index --find-links "%VENDOR_DIR%" -r "%LOCK_FILE%" --quiet
echo [build] install OK
echo.

REM ---- Step 4: PyInstaller (--onedir; console mode required per spec §2.2) --

echo [build] running PyInstaller --onedir...
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if not exist "%WORK_DIR%" mkdir "%WORK_DIR%"

REM NOTE: the 'noconsole' PyInstaller mode is intentionally NOT used (spec §2.2):
REM       enabling it sets stdio to None, breaking stdin/stdout IPC.
pyinstaller --onedir --noconfirm --name twscrape-runner ^
    --distpath "%RUNNER_DIR%\%PLATFORM%" ^
    --workpath "%WORK_DIR%" ^
    --specpath "%RUNNER_DIR%" ^
    "%SRC%"

REM ---- Step 5: verify output and compute SHA-256 ---------------------------

if not exist "%BIN%" (
    echo [build] ERROR: expected binary not produced at %BIN%
    exit /b 1
)

REM certutil computes SHA-256 on Windows without extra tools.
set SHA256_LINE=
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "%BIN%" SHA256') do (
    if not defined SHA256_LINE set SHA256_LINE=%%h
)

echo.
echo [build] ================================================================
echo [build] SUCCESS
echo [build] binary: %BIN%
echo [build] SHA-256: %SHA256_LINE%
echo [build] ================================================================
echo.
echo [build] Next steps -- MUST complete before packaging:
echo.
echo [build]   1. Commit the SHA into src\main\x\sidecar-client.ts:
echo [build]      PINNED_SHA256['win32'] = '%SHA256_LINE%';
echo.
echo [build]   2. Verify: pnpm typecheck ^&^& pnpm test test/x-sidecar-build.test.ts
echo.
echo [build]   3. Package: pnpm package:win
echo.
echo [build] WARNING: the binary is NOT committed to git (operator-lock gate).

endlocal
