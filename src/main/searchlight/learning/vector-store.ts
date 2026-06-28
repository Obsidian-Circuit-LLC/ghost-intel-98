/**
 * Per-case vector store for the Searchlight adaptive-learning engine.
 *
 * At sweep time, the main process captures feature vectors for each probe result
 * (see sweep.ts → captureVector callback) and saves them here keyed by caseId.
 * When the user later labels a sweep result, labelResult loads these
 * main-process-captured vectors instead of trusting renderer-supplied values.
 *
 * Trust model:
 *   - Features are ALWAYS captured in the main process from raw probe data.
 *   - The renderer NEVER supplies feature values; it only supplies resultId + label.
 *   - This prevents a compromised renderer from poisoning the training corpus.
 *
 * Constraints:
 *   - No Math.random / no Date.now in storage logic.
 *   - No network egress — pure local filesystem I/O via secure-fs.
 *   - soft is derived from http_200 in DATASET_COLUMNS and never stored separately
 *     (it is recomputed from the feature vector at labelResult time).
 */

import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import { vectorsFile } from './paths';

// ---------------------------------------------------------------------------
// CapturedVector
// ---------------------------------------------------------------------------

/**
 * A feature vector captured at sweep time for a single probe result.
 * Keyed by resultId (the UUID assigned to the SweepResult by sweep.ts).
 */
export interface CapturedVector {
  /** UUID of the SweepResult this vector was captured for. */
  resultId: string;
  /**
   * Feature vector in DATASET_COLUMNS order, captured from the probe's
   * RawCheckResult in the main process via rowToFeatures.
   */
  features: number[];
  /** Human-readable site name (e.g. "GitHub"). */
  siteName: string;
  /** Unix-ms timestamp when this vector was captured. */
  ts: number;
}

// ---------------------------------------------------------------------------
// VectorIO — injectable for testability
// ---------------------------------------------------------------------------

/**
 * IO dependency for vector-store functions.
 * Path-free so tests can supply in-memory mocks without an Electron runtime.
 */
export interface VectorIO {
  /** Read the raw JSON text for a case's vector store. Throws on ENOENT. */
  readVectors(caseId: string): Promise<string>;
  /** Write the raw JSON text for a case's vector store (atomic). */
  writeVectors(caseId: string, data: string): Promise<void>;
}

function makeDefaultIO(): VectorIO {
  return {
    readVectors: (caseId) => secureReadText(vectorsFile(caseId)),
    writeVectors: (caseId, data) => secureWriteFile(vectorsFile(caseId), data),
  };
}

// ---------------------------------------------------------------------------
// saveVectors
// ---------------------------------------------------------------------------

/**
 * Persist the complete vector list for a case to disk.
 * All writes go through secureWriteFile (vault-aware, atomic temp→rename).
 * Creates the vectors/ subdirectory transparently.
 *
 * @param caseId   - UUID of the Searchlight case.
 * @param vectors  - All CapturedVectors captured during sweep(s) for this case.
 * @param io       - Injectable IO (default: secure-fs backed by vectorsFile).
 */
export async function saveVectors(
  caseId: string,
  vectors: CapturedVector[],
  io: VectorIO = makeDefaultIO(),
): Promise<void> {
  await io.writeVectors(caseId, JSON.stringify(vectors));
}

// ---------------------------------------------------------------------------
// loadVectors
// ---------------------------------------------------------------------------

/**
 * Load the persisted vector list for a case.
 * Returns an empty array when the file does not exist (no sweep yet) or
 * cannot be parsed.
 * All reads go through secureReadText (vault-aware).
 *
 * @param caseId - UUID of the Searchlight case.
 * @param io     - Injectable IO (default: secure-fs backed by vectorsFile).
 */
export async function loadVectors(
  caseId: string,
  io: VectorIO = makeDefaultIO(),
): Promise<CapturedVector[]> {
  try {
    const text = await io.readVectors(caseId);
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as CapturedVector[]) : [];
  } catch {
    // ENOENT on first sweep, or parse error → treat as empty.
    return [];
  }
}
