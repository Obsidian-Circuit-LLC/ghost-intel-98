#!/usr/bin/env node
/**
 * Stage the bundled embedding model (nomic-embed-text) for the offline vector-memory feature.
 *
 * Runs on the BUILD host (which must have `ollama` on PATH). Starts a throwaway Ollama server
 * pointed at resources/local-ai/models, pulls the pinned embedding model into that models dir, and
 * drops an EMBED_MODEL_PRESENT marker. electron-builder then ships resources/local-ai/models so the
 * app's bundled Ollama can serve /api/embeddings fully offline.
 *
 * Idempotent: if the marker exists it does nothing. This populates ONLY the embedding model; the
 * chat-model + Ollama-runtime bundling is the separate local-AI mega-installer task.
 *
 * NOTE: the model blob (~274 MB) is git-ignored like the other bundled binaries — CI/build-host
 * supplied, never committed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBED_MODEL = 'nomic-embed-text';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_AI = join(ROOT, 'resources', 'local-ai');
const MODELS = join(LOCAL_AI, 'models');
const MARKER = join(LOCAL_AI, 'EMBED_MODEL_PRESENT');
const HOST = '127.0.0.1:11439'; // throwaway port so we don't collide with a dev Ollama on 11434

if (existsSync(MARKER)) {
  console.log(`[fetch-embed] ${EMBED_MODEL} already staged → ${MODELS}`);
  process.exit(0);
}

function haveOllama() {
  try { execFileSync('ollama', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!haveOllama()) {
  console.error('[fetch-embed] `ollama` not found on PATH. Install Ollama on the build host to bundle the embedding model, or skip (memory will need the model fetched at runtime).');
  process.exit(1);
}

mkdirSync(MODELS, { recursive: true });
const env = { ...process.env, OLLAMA_HOST: HOST, OLLAMA_MODELS: MODELS, OLLAMA_NO_ANALYTICS: '1' };
const server = spawn('ollama', ['serve'], { env, stdio: 'ignore' });

async function waitReady(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try { const r = await fetch(`http://${HOST}/api/tags`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

try {
  if (!(await waitReady(30_000))) throw new Error('Ollama server did not become ready.');
  console.log(`[fetch-embed] pulling ${EMBED_MODEL} into ${MODELS} …`);
  execFileSync('ollama', ['pull', EMBED_MODEL], { env, stdio: 'inherit' });
  writeFileSync(MARKER, `${EMBED_MODEL}\n`);
  console.log('[fetch-embed] done.');
} catch (err) {
  console.error(`[fetch-embed] failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  server.kill();
}
