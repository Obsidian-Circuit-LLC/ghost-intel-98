// SP-7 INTELREPORT model types + Narrator interface.
// Pure types, shared main↔renderer. Facts are machine-derived from the SP-2 ledger;
// prose narrative is an injected Narrator that writes *around* facts it cannot alter.
import type {
  EntityType,
  ConfidenceBand,
  AttributionStatus,
  ConfidenceResult,
  RunBudget,
} from './investigation-types';

export interface ProvenanceRef {
  evidenceId: string;
  transformId: string;
  transformVersion: string;
  createdAt: string;      // ISO, verbatim from EvidenceRecord.createdAt
  rawRef: string;         // encrypted-blob pointer — chain of custody
  relation?: string;      // the producing edge relation, when this record produced the actor
}

export interface KeyActor {
  entityId: string;
  type: EntityType;
  value: string;
  role: string;                    // machine-derived: producing-edge relation → label, else type label
  cluster: number;                 // from the scene
  salience: number;                // deterministic rank score (§5)
  degree: number;                  // graph centrality
  confidence: ConfidenceBand;      // best band among findings referencing this actor, else 'low'
  attribution: AttributionStatus;  // attribution of that best finding, else 'unattributed'
  findingBacked: boolean;          // false ⇒ graph-present but no finding references it (stated honestly)
  evidence: ProvenanceRef[];       // every evidence record that produced/touched this actor, createdAt asc
  findingIds: string[];
}

export interface ReportFinding {
  id: string;
  claim: string;
  confidence: ConfidenceResult;    // verbatim from Finding
  evidence: ProvenanceRef[];       // resolved from Finding.evidenceIds
  createdAt: string;
}

export interface MethodologyEntry {  // one per in-scope run
  runId: string;
  objective: string;
  budget: RunBudget;
  status: string;
  stopReason?: string;
  actionCount: number;             // actionLog.length
  transformsUsed: string[];        // distinct transformId across the run's evidence, sorted
  createdAt: string;
}

export interface NarrativeSections {
  summary?: string;
  perActor?: Record<string, string>;   // entityId → prose
  source: 'template' | 'model';        // ALWAYS labeled
  model?: string;                       // model id when source === 'model'
}

export interface IntelReport {
  caseId: string;
  runId?: string;                  // set when run-scoped
  scope: 'case' | 'run';
  generatedAt: string;             // new Date(now()).toISOString() — injected now, storage-boundary conversion
  entityCount: number;
  findingCount: number;
  keyActors: KeyActor[];           // salience desc, top-N
  actorTail: { shown: number; total: number };   // honest truncation
  findings: ReportFinding[];       // confidence.score desc, id asc
  methodology: MethodologyEntry[];
  narrative?: NarrativeSections;   // filled by the Narrator, if any
}

export interface Narrator { narrate(report: IntelReport): Promise<NarrativeSections>; }
