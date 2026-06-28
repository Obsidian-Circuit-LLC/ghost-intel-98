/**
 * Corpus persistence layer for the Searchlight adaptive-learning engine.
 *
 * Stores and retrieves user-labelled sweep results (the personal corpus).
 * All I/O goes through secureReadText / secureWriteFile so encrypt-at-rest
 * is applied transparently when the vault is enabled.
 *
 * Constraints:
 *   - No Math.random / no Date.now in storage logic.
 *   - No network egress — pure local filesystem I/O via secure-fs.
 *   - soft is an eval-only stratifier and MUST NOT appear in the feature vector.
 */

import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import { corpusFile } from './paths';

// ---------------------------------------------------------------------------
// LabelEntry — canonical definition (imported by orchestrator.ts and trainer.ts)
// ---------------------------------------------------------------------------

/**
 * A single labelled entry in the personal corpus.
 * Persisted in corpus.json; produced when the user manually labels a sweep result.
 */
export interface LabelEntry {
  /** UUID assigned by the sweep engine to the SweepResult. */
  resultId: string;
  /** Feature vector in DATASET_COLUMNS order. */
  features: number[];
  /** Ground-truth label: 1 = genuine profile found, 0 = false positive. */
  label: 0 | 1;
  /**
   * Soft-404 flag: true when the site returned HTTP 200 for the probe URL.
   * Eval-only stratifier — NEVER placed in the feature vector.
   */
  soft: boolean;
  /** Human-readable site name (e.g. "GitHub"). */
  siteName: string;
  /** ID of the case this label belongs to. */
  caseId: string;
  /** Unix-ms timestamp when the label was recorded. */
  ts: number;
}

// ---------------------------------------------------------------------------
// IO interface — injectable for testability
// ---------------------------------------------------------------------------

/**
 * IO dependency injectable for corpus-store functions.
 * readAll/writeAll are path-free so tests can supply in-memory mocks without
 * needing to compute or mock the corpus file path (which requires an Electron
 * runtime).  The default implementation delegates to secure-fs + corpusFile().
 */
export interface CorpusIO {
  /** Read the entire corpus text. Throws on ENOENT or other IO errors. */
  readAll(): Promise<string>;
  /** Write the entire corpus text (atomic). */
  writeAll(data: string): Promise<void>;
}

function makeDefaultIO(): CorpusIO {
  return {
    readAll: () => secureReadText(corpusFile()),
    writeAll: (data) => secureWriteFile(corpusFile(), data),
  };
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Validate a single candidate LabelEntry.
 * Returns true when the entry has:
 *   - resultId: non-empty string
 *   - features: non-empty array of finite numbers
 *   - label: exactly 0 or 1
 * Entries failing validation are silently dropped so a corrupt corpus.json does
 * not block the entire training cycle.
 */
function isValidEntry(e: unknown): e is LabelEntry {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  if (typeof o['resultId'] !== 'string' || o['resultId'] === '') return false;
  if (!Array.isArray(o['features']) || (o['features'] as unknown[]).length === 0) return false;
  if (!(o['features'] as unknown[]).every((v) => typeof v === 'number' && isFinite(v))) return false;
  if (o['label'] !== 0 && o['label'] !== 1) return false;
  return true;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Load the persisted corpus from disk.
 * Returns an empty array when the file does not exist yet or cannot be parsed.
 * Silently drops entries with missing/invalid resultId, non-numeric features,
 * or label outside {0,1} so a partially-corrupted file does not abort training.
 * All reads go through the supplied io.readAll (vault-aware by default).
 */
export async function loadCorpus(io: CorpusIO = makeDefaultIO()): Promise<LabelEntry[]> {
  try {
    const text = await io.readAll();
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    // ENOENT on first run, or parse error → treat as empty corpus.
    return [];
  }
}

/**
 * Append a single label entry to the persisted corpus and return the updated list.
 * All writes go through the supplied io.writeAll (vault-aware, atomic temp→rename by default).
 */
export async function appendLabel(
  entry: LabelEntry,
  io: CorpusIO = makeDefaultIO(),
): Promise<LabelEntry[]> {
  const existing = await loadCorpus(io);
  const updated = [...existing, entry];
  await io.writeAll(JSON.stringify(updated));
  return updated;
}

/**
 * Remove the label entry with the given resultId and persist the updated corpus.
 * Returns the updated list. If no entry with that resultId exists the corpus is
 * unchanged (idempotent).
 * All writes go through the supplied io.writeAll (vault-aware, atomic temp→rename by default).
 */
export async function removeLabel(
  resultId: string,
  io: CorpusIO = makeDefaultIO(),
): Promise<LabelEntry[]> {
  const existing = await loadCorpus(io);
  const updated = existing.filter((e) => e.resultId !== resultId);
  await io.writeAll(JSON.stringify(updated));
  return updated;
}
