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

import { join } from 'node:path';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';

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
// Path helpers (deferred require so this module stays importable in Vitest)
// ---------------------------------------------------------------------------

/**
 * Absolute path to the corpus JSON file in the user's app data directory.
 * Mirrors the model-store.ts pattern for the learning/ subdirectory.
 */
export function corpusPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return join(app.getPath('userData'), 'searchlight', 'learning', 'corpus.json');
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/**
 * Load the persisted corpus from disk.
 * Returns an empty array when the file does not exist yet or cannot be parsed.
 * All reads go through secureReadText (vault-aware).
 */
export async function loadCorpus(): Promise<LabelEntry[]> {
  try {
    const text = await secureReadText(corpusPath());
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as LabelEntry[]) : [];
  } catch {
    // ENOENT on first run, or parse error → treat as empty corpus.
    return [];
  }
}

/**
 * Append a single label entry to the persisted corpus and return the updated list.
 * All writes go through secureWriteFile (vault-aware, atomic temp→rename).
 */
export async function appendLabel(entry: LabelEntry): Promise<LabelEntry[]> {
  const existing = await loadCorpus();
  const updated = [...existing, entry];
  await secureWriteFile(corpusPath(), JSON.stringify(updated));
  return updated;
}
