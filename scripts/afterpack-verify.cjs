/**
 * electron-builder afterPack hook — fail the build LOUDLY if the offline embedding stack is not in
 * the package. The recurring 0-chunks/404 memory bug shipped THREE times because nothing ever
 * checked the packaged artifact: the dedicated embed runtime spawns resources/local-ai/ollama.exe,
 * but that binary was never bundled, so `embedBundled()` was always false and memory 404'd. This
 * hook asserts the whole chain (CPU Ollama runtime + a CPU runner + the embed model blobs) is
 * present in the packed app, so a missing runtime can never silently ship again.
 */
const { join } = require('node:path');
const { existsSync, readdirSync } = require('node:fs');

module.exports = async function afterPack(context) {
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
