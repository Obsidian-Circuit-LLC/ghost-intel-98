// Shared contract for the Autonomous OSINT Investigator (SP-2). Core + the OSINT plugin agree on these.
import type { EntityType } from './types';

export type ConfidenceBand = 'high' | 'medium' | 'low';
export type AttributionStatus = 'attributed' | 'unattributed' | 'unconfirmed';

/** A machine-readable signal derived from a transform's raw output — feeds the deterministic scorer. */
export interface EvidenceSignal { kind: string; weight: number }

export interface ConfidenceResult { band: ConfidenceBand; attribution: AttributionStatus; score: number }

/** An edge a transform asserts between two entities (resolved to ids on merge). */
export interface TransformEdgeOut {
  fromValue: string; fromType: EntityType;
  toValue: string; toType: EntityType;
  relation: string; // e.g. 'registrant-of', 'resolves-to', 'co-occurs-with'
}

export interface RunBudget { maxPivots: number; maxDepth: number; maxWallClockMs: number; maxTokens: number }

export interface RunAction {
  seq: number;
  kind: 'transform' | 'ask' | 'assert' | 'reflect' | 'done';
  transformId?: string; inputEntityId?: string; evidenceId?: string;
  at: string;
}

export interface EvidenceRecord {
  id: string;
  runId: string;
  transformId: string;
  transformVersion: string;
  inputEntityId: string;
  producedEntityIds: string[];
  producedEdges: TransformEdgeOut[];
  signals: EvidenceSignal[];
  rawRef: string;       // path to the encrypted raw-output blob
  createdAt: string;    // caller-supplied
}

export interface Finding {
  id: string;
  runId: string;
  claim: string;
  evidenceIds: string[];
  confidence: ConfidenceResult;
  createdAt: string;
}

export interface InvestigationRun {
  id: string;
  caseId: string;
  seedEntityIds: string[];
  objective: string;
  budget: RunBudget;
  status: 'planned' | 'running' | 'stopped' | 'done';
  stopReason?: string;
  actionLog: RunAction[];
  createdAt: string;
  updatedAt: string;
}
