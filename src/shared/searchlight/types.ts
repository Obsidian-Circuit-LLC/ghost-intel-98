export type CheckType = 'status_code' | 'message' | 'response_url' | 'unknown';
export type SweepStatus = 'found' | 'not_found' | 'blocked' | 'error' | 'unknown';
export type ProbeErrorType =
  | 'DNS_ERROR' | 'SSL_ERROR' | 'TIMEOUT' | 'CONNECTION_REFUSED' | 'CONNECTION_ERROR'
  | 'INVALID_URL' | 'READ_ERROR' | 'TOR_UNAVAILABLE' | null;

/** A site definition. NOTE: there is deliberately no `regexCheck` field — the
 *  username pre-filter was removed to avoid compiling untrusted regex (ReDoS). */
export interface MaigretSiteEntry {
  name: string;
  url: string;
  urlMain: string;
  urlProbe: string;
  category: string;
  tags: string[];
  checkType: CheckType;
  presenseStrs: string[];
  absenceStrs: string[];
  alexaRank: number;
  headers: Record<string, string>;
  usernameClaimed: string;
}

export interface SiteCatalogEntry {
  name: string;
  category: string;
  tags: string[];
  checkType: CheckType;
}

export interface RawCheckResult {
  statusCode: number;
  statusMessage: string;
  elapsed: number;
  redirectUrl: string | null;
  error: ProbeErrorType;
  body?: string;
}

export interface SweepResult {
  id: string;
  jobId: string;
  siteName: string;
  username: string;
  url: string;
  statusCode: number;
  statusMessage: string;
  elapsed: number;
  redirectUrl: string | null;
  error: ProbeErrorType;
  category: string;
  tags: string[];
  checkType: CheckType;
  found: boolean;
  confidence: 'high' | 'medium' | 'low';
  status: SweepStatus;
  timestamp: number;
}

export interface SearchJob {
  id: string;
  username: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'cancelled';
  totalSites: number;
  checkedSites: number;
  results: SweepResult[];
  useTor: boolean;
}

export interface GraphNode {
  id: string;
  type: 'username' | 'result' | 'note' | 'file' | 'custom';
  label: string;
  x: number; y: number;
  color?: string;
  data?: unknown;
  statusCode?: number;
  url?: string;
  notes?: string;
}
export interface GraphEdge { id: string; source: string; target: string; label?: string; color?: string; }
export interface WhiteboardFile { id: string; name: string; type: string; mimeType: string; dataUrl: string; x: number; y: number; width: number; height: number; }
export interface WhiteboardNote { id: string; content: string; x: number; y: number; width: number; height: number; color: string; }

export interface SearchlightCase {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  searches: SearchJob[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  whiteboardFiles: WhiteboardFile[];
  whiteboardNotes: WhiteboardNote[];
  notes: string;
  tags: string[];
}

/** Manifest row written to searchlight/index.json. */
export interface SearchlightCaseSummary { id: string; name: string; updatedAt: number; }
