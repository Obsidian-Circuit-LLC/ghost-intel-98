// Shared contract for the Autonomous OSINT Investigator (SP-2). Core + the OSINT plugin agree on these.
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type AttributionStatus = 'attributed' | 'unattributed' | 'unconfirmed';

/** A machine-readable signal derived from a transform's raw output — feeds the deterministic scorer. */
export interface EvidenceSignal { kind: string; weight: number }

export interface ConfidenceResult { band: ConfidenceBand; attribution: AttributionStatus; score: number }
