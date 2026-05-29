import { app } from 'electron';
import { join } from 'node:path';

/** Where the online wizard stores a fetched runtime + models. */
export function fetchedRoot(): string { return join(app.getPath('userData'), 'local-ai'); }
export function fetchedModelsDir(): string { return join(fetchedRoot(), 'models'); }

/** Where the bundled mega-installer places runtime + model (electron-builder extraResources). */
export function bundledRoot(): string { return join(process.resourcesPath, 'local-ai'); }

/** Loopback endpoint the runtime is always pinned to. */
export const LOCAL_AI_HOST = '127.0.0.1';
export const LOCAL_AI_PORT = 11434;
export const LOCAL_AI_ENDPOINT = `http://${LOCAL_AI_HOST}:${LOCAL_AI_PORT}`;
export const LOCAL_AI_MODEL = 'llama3.1';
