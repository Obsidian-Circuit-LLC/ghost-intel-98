/**
 * ga98model:// — serves the bundled Vosk speech model to the renderer so vosk-browser's
 * `createModel()` can fetch + unpack it offline.
 *
 * Like the Firefox payload, the ~50 MB model is NOT vendored in this repo — the operator drops
 * a `model.tar.gz` into `resources/vosk/`. This protocol serves ONLY that one fixed file; it
 * accepts no renderer-supplied path, so there is no traversal surface. If the model is absent,
 * `status()` reports it and the renderer shows setup guidance instead of failing opaquely.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { app, protocol } from 'electron';

function modelBase(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

/** Absolute path to the bundled model archive (operator-supplied). */
export function modelFile(): string {
  return join(modelBase(), 'vosk', 'model.tar.gz');
}

export interface ModelStatus {
  installed: boolean;
  path: string | null;
}

export function status(): ModelStatus {
  const path = modelFile();
  try {
    return existsSync(path) ? { installed: true, path } : { installed: false, path: null };
  } catch {
    return { installed: false, path: null };
  }
}

/** Register the ga98model:// handler. Call once, after app is ready. Serves only modelFile(). */
export function registerModelProtocol(): void {
  protocol.handle('ga98model', async () => {
    const f = modelFile();
    let size: number;
    try { size = statSync(f).size; } catch { return new Response('not found', { status: 404 }); }
    return new Response(Readable.toWeb(createReadStream(f)) as ReadableStream, {
      status: 200,
      headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(size) }
    });
  });
}
