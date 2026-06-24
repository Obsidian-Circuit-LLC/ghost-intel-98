/**
 * GraphView — Searchlight relationship graph panel (Task 10).
 *
 * Port transforms from .searchlight-source/src/renderer/components/Graph/GraphView.tsx:
 * 1. Store: useSearchlightStore instead of useAppStore. All mutations via store actions.
 * 2. uuidv4() → crypto.randomUUID() throughout.
 * 3. framer-motion dropped; CSS transitions used where needed.
 * 4. sfx dropped (no sound utility in searchlight module).
 * 5. lucide-react dropped; icons are inline SVG or Unicode characters.
 * 6. Favicon network fetch dropped (renderer must make no network calls). Only
 *    letter-avatar SVG data-URIs are used, generated locally from node label + color.
 * 7. window.electronAPI?.openExternal → window.api.system.openExternal (this project's IPC).
 * 8. Auto-import reads active case's sweep jobs; found filter uses result.status === 'found'
 *    (SweepResult.status; no statusCode fallback needed — status is authoritative here).
 * 9. Extended entity types (email, ip, domain, etc.) that exceed GraphNode['type'] union are
 *    stored as 'custom' with the display type held in node.data for rendering purposes.
 * 10. Win98 chrome on toolbar and side-panel; dark SVG canvas (sl-graph-* CSS classes added
 *     to searchlight.css).
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useSearchlightStore } from '../store';
import type { GraphNode, GraphEdge } from '@shared/searchlight/types';
import { useFavicons } from './useFavicons';

// ─── Transform state ───────────────────────────────────────────────────────────

interface Transform { x: number; y: number; scale: number; }

// ─── Entity type registry ──────────────────────────────────────────────────────
// Extended visual types beyond what GraphNode.type supports are stored as 'custom'
// nodes; displayEntityType() derives the display label from node.data?.entityType.

interface EntityTypeDef {
  id: string;
  storeType: GraphNode['type'];
  label: string;
  icon: string;
  color: string;
  shape: 'triangle' | 'circle' | 'rect' | 'diamond' | 'hexagon';
}

const ENTITY_TYPES: EntityTypeDef[] = [
  { id: 'username',     storeType: 'username', label: 'USERNAME',     icon: '◈', color: '#00b4ff', shape: 'triangle' },
  { id: 'result',       storeType: 'result',   label: 'PROFILE',      icon: '●', color: '#00ff88', shape: 'circle'   },
  { id: 'note',         storeType: 'note',     label: 'NOTE',         icon: '≡', color: '#ffcc00', shape: 'rect'     },
  { id: 'email',        storeType: 'custom',   label: 'EMAIL',        icon: '✉', color: '#ff8800', shape: 'circle'   },
  { id: 'ip',           storeType: 'custom',   label: 'IP ADDRESS',   icon: '⊞', color: '#ff3377', shape: 'diamond'  },
  { id: 'domain',       storeType: 'custom',   label: 'DOMAIN',       icon: '⬡', color: '#00e5ff', shape: 'hexagon'  },
  { id: 'phone',        storeType: 'custom',   label: 'PHONE',        icon: '☏', color: '#b44fff', shape: 'circle'   },
  { id: 'location',     storeType: 'custom',   label: 'LOCATION',     icon: '⊙', color: '#ff6644', shape: 'circle'   },
  { id: 'organization', storeType: 'custom',   label: 'ORGANIZATION', icon: '◧', color: '#44aaff', shape: 'rect'     },
  { id: 'device',       storeType: 'custom',   label: 'DEVICE',       icon: '⬛', color: '#aaaaaa', shape: 'rect'     },
  { id: 'alias',        storeType: 'custom',   label: 'ALIAS',        icon: '◇', color: '#ffaa00', shape: 'diamond'  },
  { id: 'file',         storeType: 'file',     label: 'FILE',         icon: '◫', color: '#80ccff', shape: 'rect'     },
  { id: 'custom',       storeType: 'custom',   label: 'CUSTOM',       icon: '✦', color: '#ffffff', shape: 'circle'   },
];

/** Resolve display entity type def from a stored GraphNode. */
function resolveEntityType(node: GraphNode): EntityTypeDef {
  // For custom store-type nodes, check data?.entityType for the original display id
  if (node.type === 'custom') {
    const entityId = (node.data as Record<string, unknown> | undefined)?.entityType as string | undefined;
    if (entityId) {
      const found = ENTITY_TYPES.find((e) => e.id === entityId);
      if (found) return found;
    }
  }
  const byId = ENTITY_TYPES.find((e) => e.id === node.type);
  if (byId) return byId;
  return ENTITY_TYPES[ENTITY_TYPES.length - 1]; // fallback: custom
}

// ─── Status code color ─────────────────────────────────────────────────────────

function statusColor(code?: number): string {
  if (!code) return '#ff3344';
  if (code === 200) return '#00ff88';
  if (code >= 300 && code < 400) return '#ff8800';
  if (code === 404 || code === 410) return '#445577';
  if (code === 429) return '#ffcc00';
  if (code >= 500) return '#ff3344';
  return '#1a6fff';
}

// ─── Letter avatar (offline, no network) ──────────────────────────────────────

function letterAvatarDataUri(label: string, color: string): string {
  const letter = (label || '?')[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="6" fill="${color}22" stroke="${color}66" stroke-width="1.5"/>` +
    `<text x="16" y="22" text-anchor="middle" font-size="16" font-family="monospace" font-weight="bold" fill="${color}">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ─── Node shape renderer ───────────────────────────────────────────────────────

function renderNodeShape(
  node: GraphNode,
  et: EntityTypeDef,
  isSelected: boolean,
  isConnecting: boolean,
): React.ReactNode {
  const color = node.color ?? et.color;
  const r = et.shape === 'triangle' ? 28 : et.shape === 'rect' ? 0 : 22;

  const glow = isSelected
    ? <circle r={r + 10} fill="none" stroke={color} strokeWidth="1.5" opacity="0.3" style={{ animation: 'sl-pulse-glow 1.5s ease-in-out infinite' }} />
    : null;
  const connectRing = isConnecting
    ? <circle r={r + 16} fill="none" stroke="#00e5ff" strokeWidth="2" opacity="0.6" style={{ animation: 'sl-pulse-glow 0.8s ease-in-out infinite' }} />
    : null;

  if (et.shape === 'rect') {
    const w = (node.data as Record<string, number> | undefined)?.noteWidth ?? 180;
    const h = (node.data as Record<string, number> | undefined)?.noteHeight ?? 80;
    return (
      <>
        {isSelected && <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={4} fill="none" stroke={color} strokeWidth="1" opacity="0.3" />}
        {connectRing}
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3}
          fill={`${color}18`} stroke={color} strokeWidth={isSelected ? 2 : 1.5} />
        {/* Resize handle bottom-right */}
        <rect x={w / 2 - 10} y={h / 2 - 10} width={10} height={10}
          fill={`${color}44`} rx={2} className="sl-resize-handle" style={{ cursor: 'se-resize' }} />
      </>
    );
  }

  if (et.shape === 'triangle') {
    const pts = `0,${-r} ${r * 0.866},${r * 0.5} ${-r * 0.866},${r * 0.5}`;
    return <>{glow}{connectRing}<polygon points={pts} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2.5 : 1.5} /></>;
  }

  if (et.shape === 'diamond') {
    const pts = `0,${-r} ${r},0 0,${r} ${-r},0`;
    return <>{glow}{connectRing}<polygon points={pts} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2 : 1.5} /></>;
  }

  if (et.shape === 'hexagon') {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i * 60 - 30) * Math.PI / 180;
      return `${r * Math.cos(a)},${r * Math.sin(a)}`;
    }).join(' ');
    return <>{glow}{connectRing}<polygon points={pts} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2 : 1.5} /></>;
  }

  // Default: circle
  return (
    <>
      {glow}{connectRing}
      <circle r={r} fill={`${color}22`} stroke={color} strokeWidth={isSelected ? 2.5 : 1.5} />
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export const GraphView: React.FC = () => {
  const store = useSearchlightStore();
  const activeCaseId = store.activeCaseId;
  const activeCase = store.cases.find((c) => c.id === activeCaseId);

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>({});

  // ── Cross-case import panel ──────────────────────────────────────────────────
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importCaseId, setImportCaseId] = useState<string>('');
  const [importJobIds, setImportJobIds] = useState<Set<string>>(new Set());
  const [importFoundOnly, setImportFoundOnly] = useState(true);
  const [importMsg, setImportMsg] = useState('');

  const panRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodes: GraphNode[] = activeCase?.graphNodes ?? [];
  const edges: GraphEdge[] = activeCase?.graphEdges ?? [];

  // ── Favicon lookup for result/profile nodes ────────────────────────────────
  const resultNodeNames = useMemo(
    () => [...new Set(nodes.filter((n) => n.type === 'result').map((n) => n.label))],
    [nodes.map((n) => `${n.id}|${n.type}|${n.label}`).join(',')] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const graphFavicons = useFavicons(resultNodeNames);

  // ── Letter-avatar pre-generation for result nodes (purely local, no network) ─
  const avatarSig = nodes.map((n) => `${n.id}|${n.label}|${n.color ?? ''}`).join(',');
  useEffect(() => {
    const additions: Record<string, string> = {};
    nodes.forEach((node) => {
      const et = resolveEntityType(node);
      const color = node.color ?? et.color;
      additions[node.id] = letterAvatarDataUri(node.label, color);
    });
    setAvatarCache(additions);
  }, [avatarSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zoom via wheel ────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setTransform((t) => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, t.scale * delta));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...t, scale: newScale };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        scale: newScale,
        x: mx - (mx - t.x) * (newScale / t.scale),
        y: my - (my - t.y) * (newScale / t.scale),
      };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Pan ───────────────────────────────────────────────────────────────────────
  const handleBgMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target !== svgRef.current && !target.classList.contains('sl-bg-rect')) return;
    if (connecting) { setConnecting(null); return; }
    setSelected(null);
    setShowAddMenu(false);
    setIsPanning(true);
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  };

  const handleBgMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setTransform((t) => ({
      ...t,
      x: panRef.current.origX + (e.clientX - panRef.current.startX),
      y: panRef.current.origY + (e.clientY - panRef.current.startY),
    }));
  };

  // ── Add entity ────────────────────────────────────────────────────────────────
  const addNode = (entityId: string) => {
    if (!activeCaseId) return;
    const et = ENTITY_TYPES.find((e) => e.id === entityId) ?? ENTITY_TYPES[ENTITY_TYPES.length - 1];
    const newNode: GraphNode = {
      id: crypto.randomUUID(),
      type: et.storeType,
      label: et.label,
      x: (-transform.x + 400) / transform.scale + (Math.random() - 0.5) * 200,
      y: (-transform.y + 300) / transform.scale + (Math.random() - 0.5) * 200,
      color: et.color,
      // For custom storeType nodes, embed the display entityType in data
      ...(et.storeType === 'custom' ? { data: { entityType: entityId } } : {}),
    };
    store.addGraphNode(activeCaseId, newNode);
    setShowAddMenu(false);
  };

  // ── Node click (select / connect) ─────────────────────────────────────────────
  const handleNodeClick = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (connecting && connecting !== nodeId) {
      if (activeCaseId) {
        store.addGraphEdge(activeCaseId, {
          id: crypto.randomUUID(),
          source: connecting,
          target: nodeId,
        });
      }
      setConnecting(null);
    } else {
      setSelected(nodeId === selected ? null : nodeId);
    }
  };

  // ── Node drag ─────────────────────────────────────────────────────────────────
  const handleNodeDrag = (nodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (connecting) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const startX = e.clientX, startY = e.clientY;
    const origX = node.x, origY = node.y;
    const onMove = (ev: MouseEvent) => {
      if (!activeCaseId) return;
      store.updateGraphNode(activeCaseId, nodeId, {
        x: origX + (ev.clientX - startX) / transform.scale,
        y: origY + (ev.clientY - startY) / transform.scale,
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Note resize ───────────────────────────────────────────────────────────────
  const handleNoteResize = (nodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const nodeData = (node.data as Record<string, number> | undefined) ?? {};
    const startX = e.clientX, startY = e.clientY;
    const origW = nodeData.noteWidth ?? 180;
    const origH = nodeData.noteHeight ?? 80;
    const onMove = (ev: MouseEvent) => {
      if (!activeCaseId) return;
      const dx = (ev.clientX - startX) / transform.scale;
      const dy = (ev.clientY - startY) / transform.scale;
      store.updateGraphNode(activeCaseId, nodeId, {
        data: { ...nodeData, noteWidth: Math.max(100, origW + dx), noteHeight: Math.max(50, origH + dy) },
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Import results to graph ────────────────────────────────────────────────────
  // Auto-import: reads active case sweep jobs; found filter uses SweepResult.status === 'found'.
  // Cross-case: same logic applied to any case in the store.
  const importResultsToGraph = useCallback((
    sourceCaseId: string,
    selectedJobIds: Set<string>,
    foundOnly: boolean,
  ): number => {
    if (!activeCaseId) return 0;
    const sourceCase = store.cases.find((c) => c.id === sourceCaseId);
    if (!sourceCase) return 0;

    const jobs = selectedJobIds.size > 0
      ? sourceCase.searches.filter((j) => selectedJobIds.has(j.id))
      : sourceCase.searches;

    let allResults = jobs.flatMap((j) => j.results);
    if (foundOnly) allResults = allResults.filter((r) => r.status === 'found');

    const usernames = [...new Set(allResults.map((r) => r.username))];
    const existingIds = new Set(nodes.map((n) => n.id));
    let added = 0;

    const offsetX = nodes.length > 0 ? nodes.reduce((acc, n) => Math.max(acc, n.x), 0) + 300 : 400;

    usernames.forEach((username, ui) => {
      const uId = `username-${sourceCaseId.slice(0, 6)}-${username}`;
      if (!existingIds.has(uId)) {
        store.addGraphNode(activeCaseId, {
          id: uId,
          type: 'username',
          label: username,
          x: offsetX + ui * 280,
          y: 300,
          color: '#00b4ff',
          notes: `From case: ${sourceCase.name}`,
        });
        existingIds.add(uId);
        added++;
      }

      const userResults = allResults.filter((r) => r.username === username);
      const step = (2 * Math.PI) / Math.max(userResults.length, 1);
      userResults.forEach((result, ri) => {
        const nId = `result-${result.id}`;
        if (!existingIds.has(nId)) {
          const a = step * ri - Math.PI / 2;
          const rad = 200;
          store.addGraphNode(activeCaseId, {
            id: nId,
            type: 'result',
            label: result.siteName,
            x: offsetX + ui * 280 + Math.cos(a) * rad,
            y: 300 + Math.sin(a) * rad,
            statusCode: result.statusCode,
            url: result.url,
            color: statusColor(result.statusCode),
            notes: `From case: ${sourceCase.name}`,
          });
          existingIds.add(nId);
          store.addGraphEdge(activeCaseId, {
            id: `edge-${uId}-${nId}`,
            source: uId,
            target: nId,
          });
          added++;
        }
      });
    });

    return added;
  }, [activeCaseId, nodes, store]);

  const handleImportFromPanel = useCallback(() => {
    if (!importCaseId) return;
    const count = importResultsToGraph(importCaseId, importJobIds, importFoundOnly);
    if (count > 0) {
      setImportMsg(`Added ${count} nodes`);
      setTimeout(() => setImportMsg(''), 4000);
    } else {
      setImportMsg('No new results (already on graph or none match filter)');
      setTimeout(() => setImportMsg(''), 4000);
    }
  }, [importCaseId, importJobIds, importFoundOnly, importResultsToGraph]);

  const selectedNode = nodes.find((n) => n.id === selected);

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (!activeCaseId || !activeCase) {
    return (
      <div className="sl-graph-empty-root">
        <div className="sl-graph-empty-icon">⬡</div>
        <div className="sl-graph-empty-text">NO ACTIVE CASE</div>
      </div>
    );
  }

  return (
    <div className="sl-graph-root">

      {/* ── Toolbar ── */}
      <div className="sl-graph-toolbar">
        <span className="sl-graph-toolbar-title">RELATIONSHIP GRAPH</span>

        {/* Import panel toggle */}
        <button
          className={`sl-sweep-btn${showImportPanel ? ' sl-sweep-btn-active' : ''}`}
          onClick={() => {
            setShowImportPanel(!showImportPanel);
            setImportCaseId(activeCaseId);
            setImportJobIds(new Set());
            setImportMsg('');
          }}
        >
          ⊕ IMPORT RESULTS ▾
        </button>

        {/* Add entity dropdown */}
        <div className="sl-graph-add-wrap">
          <button className="sl-sweep-btn" onClick={() => setShowAddMenu(!showAddMenu)}>
            + ADD ENTITY ▾
          </button>
          {showAddMenu && (
            <div className="sl-graph-add-menu">
              {ENTITY_TYPES.map((et) => (
                <button
                  key={et.id}
                  className="sl-graph-add-item"
                  style={{ color: et.color }}
                  onClick={() => addNode(et.id)}
                >
                  <span className="sl-graph-add-icon">{et.icon}</span>
                  {et.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected node actions */}
        {selected && (
          <>
            <button
              className={`sl-sweep-btn${connecting === selected ? ' sl-sweep-btn-active' : ''}`}
              onClick={() => setConnecting(selected)}
            >
              {connecting === selected ? '● CONNECTING…' : '⟵ CONNECT'}
            </button>
            <button
              className="sl-sweep-btn sl-sweep-btn-danger"
              onClick={() => {
                if (activeCaseId) {
                  store.removeGraphNode(activeCaseId, selected);
                  setSelected(null);
                }
              }}
            >
              ✕ DELETE
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <span className="sl-graph-counts">
          {nodes.length} NODES · {edges.length} EDGES
        </span>

        <button
          className="sl-sweep-btn"
          onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
          title="Reset pan/zoom"
        >
          ⊙ RESET
        </button>

        <span className="sl-graph-zoom-pct">{Math.round(transform.scale * 100)}%</span>
      </div>

      {/* ── Cross-case import panel ── */}
      {showImportPanel && (() => {
        const importCase = store.cases.find((c) => c.id === importCaseId);
        return (
          <div className="sl-graph-import-panel">
            <div className="sl-graph-import-row">

              {/* Case selector */}
              <div>
                <div className="sl-graph-import-label">SOURCE CASE</div>
                <select
                  className="sl-graph-import-select"
                  value={importCaseId}
                  onChange={(e) => {
                    setImportCaseId(e.target.value);
                    setImportJobIds(new Set());
                  }}
                >
                  <option value="">— select a case —</option>
                  {store.cases.map((c) => {
                    const totalFound = c.searches.flatMap((j) => j.results)
                      .filter((r) => r.status === 'found').length;
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.id === activeCaseId ? ' (current)' : ''} — {totalFound} found
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Sweep selector */}
              {importCase && importCase.searches.length > 0 && (
                <div>
                  <div className="sl-graph-import-label">
                    SWEEPS <span style={{ opacity: 0.5 }}>(all by default)</span>
                  </div>
                  <div className="sl-graph-sweep-chips">
                    {importCase.searches.map((j) => {
                      const isSel = importJobIds.has(j.id);
                      const found = j.results.filter((r) => r.status === 'found').length;
                      return (
                        <button
                          key={j.id}
                          className={`sl-graph-sweep-chip${isSel ? ' sl-graph-sweep-chip-active' : ''}`}
                          onClick={() => {
                            setImportJobIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(j.id)) next.delete(j.id); else next.add(j.id);
                              return next;
                            });
                          }}
                        >
                          {j.username}
                          <span className="sl-graph-chip-count">{found}/{j.results.length}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Controls + count */}
              <div className="sl-graph-import-controls">
                <label className="sl-sweep-check-label">
                  <input
                    type="checkbox"
                    checked={importFoundOnly}
                    onChange={(e) => setImportFoundOnly(e.target.checked)}
                  />
                  FOUND ONLY
                </label>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="sl-sweep-btn sl-sweep-btn-primary"
                    onClick={handleImportFromPanel}
                    disabled={!importCaseId}
                  >
                    ⊕ ADD TO GRAPH
                  </button>
                  <button
                    className="sl-sweep-btn"
                    onClick={() => { setShowImportPanel(false); setImportMsg(''); }}
                  >
                    ✕
                  </button>
                </div>

                {importMsg && (
                  <div className={`sl-graph-import-msg${importMsg.startsWith('Added') ? ' sl-graph-import-msg-ok' : ' sl-graph-import-msg-warn'}`}>
                    {importMsg}
                  </div>
                )}
              </div>

              {/* Preview count */}
              {importCase && (() => {
                const jobs = importJobIds.size > 0
                  ? importCase.searches.filter((j) => importJobIds.has(j.id))
                  : importCase.searches;
                let results = jobs.flatMap((j) => j.results);
                if (importFoundOnly) results = results.filter((r) => r.status === 'found');
                return (
                  <div className="sl-graph-import-count-box">
                    <div className="sl-graph-import-count-num">{results.length}</div>
                    <div className="sl-graph-import-count-label">RESULTS TO IMPORT</div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* ── Canvas + properties ── */}
      <div className="sl-graph-content">

        {/* SVG canvas */}
        <div
          ref={containerRef}
          className="sl-graph-canvas"
          style={{ cursor: isPanning ? 'grabbing' : 'default' }}
          onMouseDown={handleBgMouseDown}
          onMouseMove={handleBgMouseMove}
          onMouseUp={() => setIsPanning(false)}
          onMouseLeave={() => setIsPanning(false)}
        >
          <svg ref={svgRef} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <pattern
                id="sl-grid"
                width={40 * transform.scale}
                height={40 * transform.scale}
                patternUnits="userSpaceOnUse"
                x={transform.x % (40 * transform.scale)}
                y={transform.y % (40 * transform.scale)}
              >
                <path
                  d={`M ${40 * transform.scale} 0 L 0 0 0 ${40 * transform.scale}`}
                  fill="none"
                  stroke="rgba(100,60,180,0.07)"
                  strokeWidth="1"
                />
              </pattern>
              <marker id="sl-arrowhead" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(26,111,255,0.5)" />
              </marker>
            </defs>

            <rect className="sl-bg-rect" width="100%" height="100%" fill="url(#sl-grid)" />

            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>

              {/* Edges */}
              {edges.map((edge) => {
                const src = nodes.find((n) => n.id === edge.source);
                const tgt = nodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;
                const mx = (src.x + tgt.x) / 2;
                const my = (src.y + tgt.y) / 2;
                return (
                  <g key={edge.id}>
                    <line
                      x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                      stroke="rgba(26,111,255,0.25)" strokeWidth="1.5" strokeDasharray="4 3"
                      markerEnd="url(#sl-arrowhead)"
                    />
                    {/* Mid-point delete button */}
                    <circle
                      cx={mx} cy={my} r={7}
                      fill="rgba(5,5,20,0.95)"
                      stroke="rgba(26,111,255,0.25)"
                      strokeWidth="1"
                      style={{ cursor: 'pointer' }}
                      onClick={() => { if (activeCaseId) store.removeGraphEdge(activeCaseId, edge.id); }}
                    />
                    <text
                      x={mx} y={my + 4}
                      textAnchor="middle"
                      style={{ fontSize: '9px', fill: 'rgba(26,111,255,0.6)', fontFamily: 'monospace', pointerEvents: 'none' }}
                    >
                      ×
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const et = resolveEntityType(node);
                const color = node.color ?? et.color;
                const isSel = selected === node.id;
                const isConn = connecting === node.id;
                const isRect = et.shape === 'rect';
                const nodeData = (node.data as Record<string, number> | undefined) ?? {};
                const noteW = nodeData.noteWidth ?? 180;
                const noteH = nodeData.noteHeight ?? 80;
                const avatar = avatarCache[node.id] ?? '';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => handleNodeClick(e, node.id)}
                    onMouseDown={(e) => {
                      const target = e.target as Element;
                      if (target.classList.contains('sl-resize-handle')) {
                        handleNoteResize(node.id, e);
                      } else {
                        handleNodeDrag(node.id, e);
                      }
                    }}
                    onDoubleClick={() => { if (isRect) setEditingNote(node.id); }}
                  >
                    {renderNodeShape(node, et, isSel, isConn)}

                    {/* Note text / textarea */}
                    {isRect && (
                      editingNote === node.id ? (
                        <foreignObject x={-noteW / 2 + 6} y={-noteH / 2 + 6} width={noteW - 12} height={noteH - 12}>
                          <textarea
                            style={{
                              width: '100%', height: '100%',
                              background: 'transparent', border: 'none', outline: 'none',
                              color, fontFamily: 'Share Tech Mono', fontSize: '11px',
                              resize: 'none', lineHeight: '1.5',
                            }}
                            value={node.notes ?? node.label}
                            onChange={(e) => {
                              if (activeCaseId) {
                                store.updateGraphNode(activeCaseId, node.id, {
                                  notes: e.target.value,
                                  label: e.target.value,
                                });
                              }
                            }}
                            onBlur={() => setEditingNote(null)}
                            autoFocus
                          />
                        </foreignObject>
                      ) : (
                        <text
                          x={-noteW / 2 + 8} y={-noteH / 2 + 18}
                          style={{ fontSize: '11px', fill: color, fontFamily: 'Share Tech Mono', pointerEvents: 'none' }}
                        >
                          {(node.notes ?? node.label).slice(0, 24)}
                        </text>
                      )
                    )}

                    {/* Icon for non-rect nodes (favicon preferred for result nodes, else letter avatar, else icon char) */}
                    {!isRect && et.shape === 'circle' && (graphFavicons[node.label] || avatar) ? (
                      <image
                        href={graphFavicons[node.label] ?? avatar}
                        x={-11} y={-11} width={22} height={22}
                        preserveAspectRatio="xMidYMid meet"
                        style={{ imageRendering: 'crisp-edges', pointerEvents: 'none' }}
                      />
                    ) : !isRect ? (
                      <text
                        y={5} textAnchor="middle"
                        style={{ fontSize: '14px', fill: color, fontFamily: 'monospace', pointerEvents: 'none' }}
                      >
                        {et.icon}
                      </text>
                    ) : null}

                    {/* Label */}
                    <text
                      y={isRect ? noteH / 2 + 14 : 36}
                      textAnchor="middle"
                      style={{ fontSize: '10px', fill: isSel ? color : 'rgba(200,220,255,0.8)', fontFamily: 'Share Tech Mono', pointerEvents: 'none' }}
                    >
                      {node.label.length > 18 ? node.label.slice(0, 18) + '…' : node.label}
                    </text>

                    {/* Status code badge */}
                    {node.statusCode != null && (
                      <text
                        y={8} textAnchor="middle"
                        style={{ fontSize: '9px', fill: color, fontFamily: 'Share Tech Mono', fontWeight: 700, pointerEvents: 'none' }}
                      >
                        {node.statusCode}
                      </text>
                    )}

                    {/* Delete X when selected */}
                    {isSel && (
                      <g
                        transform={`translate(${isRect ? noteW / 2 - 4 : 20},${isRect ? -noteH / 2 + 4 : -22})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeCaseId) {
                            store.removeGraphNode(activeCaseId, node.id);
                            setSelected(null);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle r={8} fill="rgba(255,50,50,0.3)" stroke="rgba(255,50,50,0.8)" strokeWidth="1" />
                        <text textAnchor="middle" y={4} style={{ fontSize: '10px', fill: '#ff3344', pointerEvents: 'none' }}>×</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Empty canvas hint */}
          {nodes.length === 0 && (
            <div className="sl-graph-canvas-hint">
              <div style={{ fontSize: 48, opacity: 0.1 }}>⬡</div>
              <div className="sl-graph-canvas-hint-text">
                CLICK "IMPORT RESULTS" TO POPULATE<br />
                <span style={{ fontSize: '9px' }}>OR USE "+ ADD ENTITY" TO BUILD MANUALLY</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Properties panel ── */}
        {selectedNode && (
          <div className="sl-graph-props">
            <div className="sl-graph-props-title">NODE PROPERTIES</div>

            {/* Type badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, color: selectedNode.color ?? resolveEntityType(selectedNode).color }}>
                {resolveEntityType(selectedNode).icon}
              </span>
              <span className="sl-graph-props-type-label">
                {resolveEntityType(selectedNode).label}
              </span>
            </div>

            {/* Label */}
            <div>
              <div className="sl-graph-props-field-label">LABEL</div>
              <input
                className="sl-sweep-input"
                style={{ fontSize: '12px', padding: '6px 10px', width: '100%', boxSizing: 'border-box' }}
                value={selectedNode.label}
                onChange={(e) => {
                  if (activeCaseId) store.updateGraphNode(activeCaseId, selectedNode.id, { label: e.target.value });
                }}
              />
            </div>

            {/* Notes */}
            <div>
              <div className="sl-graph-props-field-label">NOTES</div>
              <textarea
                className="sl-sweep-input"
                style={{ fontSize: '11px', padding: '6px 10px', resize: 'vertical', minHeight: 60, width: '100%', boxSizing: 'border-box' }}
                value={selectedNode.notes ?? ''}
                onChange={(e) => {
                  if (activeCaseId) store.updateGraphNode(activeCaseId, selectedNode.id, { notes: e.target.value });
                }}
                placeholder="Add notes..."
              />
            </div>

            {/* Status */}
            {selectedNode.statusCode != null && (
              <div>
                <div className="sl-graph-props-field-label">STATUS</div>
                <span style={{ fontFamily: 'Share Tech Mono', fontSize: '14px', color: statusColor(selectedNode.statusCode) }}>
                  {selectedNode.statusCode}
                </span>
              </div>
            )}

            {/* URL */}
            {selectedNode.url && (
              <div>
                <div className="sl-graph-props-field-label">URL</div>
                <a
                  href="#"
                  className="sl-url-link"
                  style={{ fontSize: '9px', color: '#1a6fff', wordBreak: 'break-all', display: 'block' }}
                  onClick={(e) => {
                    e.preventDefault();
                    if (selectedNode.url) void window.api.system.openExternal(selectedNode.url);
                  }}
                >
                  {selectedNode.url}
                </a>
              </div>
            )}

            {/* Color picker */}
            <div>
              <div className="sl-graph-props-field-label">COLOR</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {['#00b4ff', '#00ff88', '#ffcc00', '#ff8800', '#7b2fff', '#ff3344', '#00e5ff', '#ff3377', '#ffffff'].map((c) => (
                  <button
                    key={c}
                    onClick={() => { if (activeCaseId) store.updateGraphNode(activeCaseId, selectedNode.id, { color: c }); }}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', background: c,
                      border: selectedNode.color === c ? '2px solid white' : '2px solid transparent',
                      cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Change type */}
            <div>
              <div className="sl-graph-props-field-label">CHANGE TYPE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {ENTITY_TYPES.map((et) => {
                  const currentEt = resolveEntityType(selectedNode);
                  const isActive = currentEt.id === et.id;
                  return (
                    <button
                      key={et.id}
                      onClick={() => {
                        if (activeCaseId) {
                          const nodeData = (selectedNode.data as Record<string, unknown> | undefined) ?? {};
                          store.updateGraphNode(activeCaseId, selectedNode.id, {
                            type: et.storeType,
                            color: et.color,
                            data: et.storeType === 'custom'
                              ? { ...nodeData, entityType: et.id }
                              : { ...nodeData, entityType: undefined },
                          });
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 8px',
                        background: isActive ? 'rgba(26,111,255,0.1)' : 'transparent',
                        border: `1px solid ${isActive ? 'rgba(26,111,255,0.4)' : 'transparent'}`,
                        borderRadius: 3,
                        color: et.color,
                        fontFamily: 'Share Tech Mono', fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      <span>{et.icon}</span>{et.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
