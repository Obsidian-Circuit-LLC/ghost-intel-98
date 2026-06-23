import type {
  SearchlightCase,
  SweepResult,
  SweepStatus,
  ProbeErrorType,
  SearchJob,
  GraphNode,
  GraphEdge,
  WhiteboardFile,
  WhiteboardNote,
} from './types';

const VALID_SWEEP_STATUS: readonly SweepStatus[] = [
  'found', 'not_found', 'blocked', 'error', 'unknown',
];

const VALID_PROBE_ERRORS: readonly string[] = [
  'DNS_ERROR', 'SSL_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED', 'CONNECTION_ERROR',
  'INVALID_URL', 'READ_ERROR', 'TOR_UNAVAILABLE',
];

const VALID_GRAPH_NODE_TYPES: readonly GraphNode['type'][] = [
  'username', 'result', 'note', 'file', 'custom',
];

const VALID_JOB_STATUS: readonly SearchJob['status'][] = [
  'running', 'completed', 'cancelled',
];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function boolVal(v: unknown): boolean {
  return Boolean(v);
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeResult(raw: unknown): SweepResult | null {
  if (!isPlainObject(raw)) return null;
  const statusRaw = raw.status;
  const status: SweepStatus = VALID_SWEEP_STATUS.includes(statusRaw as SweepStatus)
    ? (statusRaw as SweepStatus)
    : 'unknown';

  const errorRaw = raw.error;
  const error: ProbeErrorType =
    errorRaw === null
      ? null
      : typeof errorRaw === 'string' && VALID_PROBE_ERRORS.includes(errorRaw)
      ? (errorRaw as Exclude<ProbeErrorType, null>)
      : null;

  const confidenceRaw = raw.confidence;
  const confidence: SweepResult['confidence'] =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'low';

  const checkTypeRaw = raw.checkType;
  const checkType: SweepResult['checkType'] =
    checkTypeRaw === 'status_code' || checkTypeRaw === 'message' ||
    checkTypeRaw === 'response_url' || checkTypeRaw === 'unknown'
      ? checkTypeRaw
      : 'unknown';

  return {
    id: str(raw.id),
    jobId: str(raw.jobId),
    siteName: str(raw.siteName),
    username: str(raw.username),
    url: str(raw.url),
    statusCode: num(raw.statusCode),
    statusMessage: str(raw.statusMessage),
    elapsed: num(raw.elapsed),
    redirectUrl: strOrNull(raw.redirectUrl),
    error,
    category: str(raw.category),
    tags: strArray(raw.tags),
    checkType,
    found: boolVal(raw.found),
    confidence,
    status,
    timestamp: num(raw.timestamp),
  };
}

function sanitizeJob(raw: unknown): SearchJob | null {
  if (!isPlainObject(raw)) return null;

  const statusRaw = raw.status;
  const status: SearchJob['status'] = VALID_JOB_STATUS.includes(
    statusRaw as SearchJob['status']
  )
    ? (statusRaw as SearchJob['status'])
    : 'completed';

  const rawResults = Array.isArray(raw.results) ? raw.results : [];
  const results: SweepResult[] = rawResults
    .map(sanitizeResult)
    .filter((r): r is SweepResult => r !== null);

  return {
    id: str(raw.id),
    username: str(raw.username),
    startedAt: num(raw.startedAt),
    completedAt: raw.completedAt !== undefined ? num(raw.completedAt) : undefined,
    status,
    totalSites: num(raw.totalSites),
    checkedSites: num(raw.checkedSites),
    results,
    useTor: boolVal(raw.useTor),
  };
}

function sanitizeGraphNode(raw: unknown): GraphNode | null {
  if (!isPlainObject(raw)) return null;

  const typeRaw = raw.type;
  const type: GraphNode['type'] = VALID_GRAPH_NODE_TYPES.includes(
    typeRaw as GraphNode['type']
  )
    ? (typeRaw as GraphNode['type'])
    : 'custom';

  return {
    id: str(raw.id),
    type,
    label: str(raw.label),
    x: num(raw.x),
    y: num(raw.y),
    color: typeof raw.color === 'string' ? raw.color : undefined,
    data: isPlainObject(raw.data) ? raw.data : undefined,
    statusCode: raw.statusCode !== undefined ? num(raw.statusCode) : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
  };
}

function sanitizeGraphEdge(raw: unknown): GraphEdge | null {
  if (!isPlainObject(raw)) return null;
  return {
    id: str(raw.id),
    source: str(raw.source),
    target: str(raw.target),
    label: typeof raw.label === 'string' ? raw.label : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
  };
}

function sanitizeWhiteboardFile(raw: unknown): WhiteboardFile | null {
  if (!isPlainObject(raw)) return null;
  const dataUrl = raw.dataUrl;
  // Only allow data: URIs — anything else (javascript:, http:, etc.) is rejected
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  return {
    id: str(raw.id),
    name: str(raw.name),
    type: str(raw.type),
    mimeType: str(raw.mimeType),
    dataUrl,
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
  };
}

function sanitizeWhiteboardNote(raw: unknown): WhiteboardNote | null {
  if (!isPlainObject(raw)) return null;
  return {
    id: str(raw.id),
    content: str(raw.content),
    x: num(raw.x),
    y: num(raw.y),
    width: num(raw.width),
    height: num(raw.height),
    color: str(raw.color),
  };
}

export function sanitizeImportedCase(raw: unknown): SearchlightCase | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string' || !raw.name) return null;

  const searches: SearchJob[] = Array.isArray(raw.searches)
    ? raw.searches.map(sanitizeJob).filter((j): j is SearchJob => j !== null)
    : [];

  const graphNodes: GraphNode[] = Array.isArray(raw.graphNodes)
    ? raw.graphNodes.map(sanitizeGraphNode).filter((n): n is GraphNode => n !== null)
    : [];

  const graphEdges: GraphEdge[] = Array.isArray(raw.graphEdges)
    ? raw.graphEdges.map(sanitizeGraphEdge).filter((e): e is GraphEdge => e !== null)
    : [];

  const whiteboardFiles: WhiteboardFile[] = Array.isArray(raw.whiteboardFiles)
    ? raw.whiteboardFiles
        .map(sanitizeWhiteboardFile)
        .filter((f): f is WhiteboardFile => f !== null)
    : [];

  const whiteboardNotes: WhiteboardNote[] = Array.isArray(raw.whiteboardNotes)
    ? raw.whiteboardNotes
        .map(sanitizeWhiteboardNote)
        .filter((n): n is WhiteboardNote => n !== null)
    : [];

  return {
    id: raw.id,
    name: raw.name,
    description: str(raw.description),
    notes: str(raw.notes),
    tags: strArray(raw.tags),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    searches,
    graphNodes,
    graphEdges,
    whiteboardFiles,
    whiteboardNotes,
  };
}
