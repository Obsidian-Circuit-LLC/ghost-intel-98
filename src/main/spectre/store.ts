/**
 * Spectre credential store — the six upstream API keys, ENCRYPTED at rest via secure-fs.
 *
 * Deliberately NOT in AppSettings: that file is plaintext on disk (the lock screen renders the
 * saved theme before unlock), so a credential there would defeat encrypt-at-rest. Upstream
 * WireTapper keeps keys in a plaintext `.env`/SQLite — this is one of the five hardening
 * substitutions. Keys are written here and NEVER returned to the renderer; the renderer sees only
 * which slots are filled (`keyStatus`).
 */
import { join } from 'node:path';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { SpectreKeys, SpectreKeyStatus } from '@shared/spectre/types';

const KEY_SLOTS: (keyof SpectreKeys)[] = ['wigleName', 'wigleToken', 'opencellid', 'shodan', 'censysId', 'censysSecret', 'unwiredlabs'];
const MAX_KEY = 512;
const keysFile = (): string => join(dataRoot(), 'spectre-keys.json');

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function empty(): SpectreKeys {
  return { wigleName: '', wigleToken: '', opencellid: '', shodan: '', censysId: '', censysSecret: '', unwiredlabs: '' };
}

/** MAIN-ONLY read of the actual key values — for the client, never the renderer. */
export async function readKeys(): Promise<SpectreKeys> {
  try {
    const parsed = JSON.parse(await secureReadText(keysFile())) as Partial<SpectreKeys>;
    const out = empty();
    for (const k of KEY_SLOTS) if (typeof parsed?.[k] === 'string') out[k] = String(parsed[k]);
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw err; // a decrypt/corruption error must not read as "no keys" and then be overwritten
  }
}

/** Merge in only the slots the caller supplied — an omitted slot keeps its stored value, an empty
 *  string clears it. Never echoes values back. */
export async function saveKeys(patch: Partial<SpectreKeys>): Promise<SpectreKeyStatus> {
  return serialize(async () => {
    const cur = await readKeys();
    for (const k of KEY_SLOTS) {
      if (patch[k] !== undefined) cur[k] = String(patch[k] ?? '').slice(0, MAX_KEY);
    }
    await secureWriteFile(keysFile(), JSON.stringify(cur, null, 2));
    return keyStatusOf(cur);
  });
}

export function keyStatusOf(keys: SpectreKeys): SpectreKeyStatus {
  const status = {} as SpectreKeyStatus;
  for (const k of KEY_SLOTS) status[k] = Boolean(keys[k]);
  return status;
}

/** The ONLY key state the renderer receives — filled/empty per slot, no values. */
export async function keyStatus(): Promise<SpectreKeyStatus> {
  return keyStatusOf(await readKeys());
}
