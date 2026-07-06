/**
 * electron-builder afterPack hook — fail the build LOUDLY if the offline embedding stack is not in
 * the package. The recurring 0-chunks/404 memory bug shipped THREE times because nothing ever
 * checked the packaged artifact: the dedicated embed runtime spawns resources/local-ai/ollama.exe,
 * but that binary was never bundled, so `embedBundled()` was always false and memory 404'd. This
 * hook asserts the whole chain (CPU Ollama runtime + a CPU runner + the embed model blobs) is
 * present in the packed app, so a missing runtime can never silently ship again.
 */
const { join } = require('node:path');
const { existsSync, readdirSync, statSync } = require('node:fs');

// The Vosk speech model is bundled on EVERY platform (OS-independent data unpacked by vosk-browser
// WASM), so it is guarded before the win32-only embedding-stack checks. 10 MB floor catches an
// empty/truncated artifact (the real model is ~35-40 MB).
const VOSK_MODEL_MIN_BYTES = 10 * 1024 * 1024;
function sufficientVoskModel(bytes) { return bytes >= VOSK_MODEL_MIN_BYTES; }

function assertVoskModel(appOutDir) {
  const f = join(appOutDir, 'resources', 'vosk', 'model.tar.gz');
  if (!existsSync(f)) {
    throw new Error(`[afterpack-verify] Vosk model MISSING in the package: ${f}\n  Voice input would be dead. Did 'pnpm fetch:vosk' run before packaging?`);
  }
  const size = statSync(f).size;
  if (!sufficientVoskModel(size)) {
    throw new Error(`[afterpack-verify] Vosk model too small (${size} bytes < ${VOSK_MODEL_MIN_BYTES} floor) — truncated/empty artifact would ship a dead voice feature.`);
  }
  console.log(`[afterpack-verify] Vosk speech model present (${size} bytes) ✓`);
}

module.exports = async function afterPack(context) {
  assertVoskModel(context.appOutDir); // all platforms — the Vosk model is OS-independent

  // Only the Windows build bundles the CPU Ollama runtime + embed model today.
  if (context.electronPlatformName !== 'win32') return;

  const res = join(context.appOutDir, 'resources', 'local-ai');
  const required = [
    join(res, 'ollama.exe'),
    join(res, 'lib', 'ollama', 'ggml-base.dll'),
    join(res, 'EMBED_MODEL_PRESENT'),
  ];
  const missing = required.filter((p) => !existsSync(p));

  const libDir = join(res, 'lib', 'ollama');
  const hasCpuRunner = existsSync(libDir) && readdirSync(libDir).some((f) => /^ggml-cpu-.*\.dll$/.test(f));

  const blobsDir = join(res, 'models', 'blobs');
  const hasBlobs = existsSync(blobsDir) && readdirSync(blobsDir).some((f) => f.startsWith('sha256-'));

  if (missing.length || !hasCpuRunner || !hasBlobs) {
    throw new Error(
      '[afterpack-verify] Offline embedding stack INCOMPLETE in the package — memory would 404 at runtime.\n' +
      (missing.length ? `  missing: ${missing.join(', ')}\n` : '') +
      (!hasCpuRunner ? `  no ggml-cpu-*.dll runner in ${libDir}\n` : '') +
      (!hasBlobs ? `  no model blobs in ${blobsDir}\n` : '') +
      "  Did 'pnpm fetch:ollama' and 'pnpm fetch:embed' run before packaging?"
    );
  }
  console.log('[afterpack-verify] offline embedding stack present (ollama.exe + CPU runner + embed model) ✓');
};

module.exports.sufficientVoskModel = sufficientVoskModel;
module.exports.VOSK_MODEL_MIN_BYTES = VOSK_MODEL_MIN_BYTES;
