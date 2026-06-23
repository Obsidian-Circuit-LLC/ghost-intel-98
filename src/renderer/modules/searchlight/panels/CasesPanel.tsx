/**
 * CasesPanel — Task 12 port.
 *
 * Port transforms from .searchlight-source/src/renderer/components/Cases/CasesPanel.tsx:
 * 1. useAppStore → useSearchlightStore; Case → SearchlightCase.
 * 2. store.createCase / renameCase / deleteCase / setActiveCaseId / importCase — all present in
 *    the searchlight store. updateCase used for merge logic.
 * 3. Export: window.api.searchlight.exportCase(id) returns JSON text; blob-download as <name>.gic.
 *    No window.electronAPI.saveCaseExport, no window.api.files.*.
 * 4. Import: hidden <input type=file accept=".gic,application/json"> → file.text() →
 *    window.api.searchlight.importCase(text) → on success: the store's importCase action is
 *    called (the IPC importCase persists; the store action updates state).
 *    Simple merge: if the case name already exists, merge sweeps + nodes + edges into it via
 *    store.updateCase (store persists via scheduleSave). No confirm() — replaced with an
 *    inline merge-confirmation step to keep code test-friendly.
 * 5. useMemoryFile hook removed — persistence is IPC-backed via the store's scheduleSave.
 * 6. sfx removed.
 * 7. graphNodes / graphEdges from SearchlightCase shape.
 */

import { useState, useRef, useCallback } from 'react';
import type { SearchlightCase } from '@shared/searchlight/types';
import { sanitizeImportedCase } from '@shared/searchlight/import-sanitize';
import { useSearchlightStore } from '../store';

// ─── Blob download ────────────────────────────────────────────────────────────
function blobDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function CasesPanel(): JSX.Element {
  const cases         = useSearchlightStore((s) => s.cases);
  const activeCaseId  = useSearchlightStore((s) => s.activeCaseId);
  const setActiveCaseId = useSearchlightStore((s) => s.setActiveCaseId);
  const createCase    = useSearchlightStore((s) => s.createCase);
  const deleteCase    = useSearchlightStore((s) => s.deleteCase);
  const renameCase    = useSearchlightStore((s) => s.renameCase);
  const updateCase    = useSearchlightStore((s) => s.updateCase);
  const storeImport   = useSearchlightStore((s) => s.importCase);

  const [newCaseName,  setNewCaseName]  = useState('');
  const [newCaseDesc,  setNewCaseDesc]  = useState('');
  const [renamingId,   setRenamingId]   = useState<string | null>(null);
  const [renameValue,  setRenameValue]  = useState('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [pendingMerge, setPendingMerge] = useState<{
    incoming: SearchlightCase;
    existing: SearchlightCase;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 5000);
  };

  // ── Create ──────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!newCaseName.trim()) return;
    createCase(newCaseName.trim(), newCaseDesc.trim());
    setNewCaseName('');
    setNewCaseDesc('');
    setShowCreate(false);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete case "${name}"? This cannot be undone.`)) return;
    void deleteCase(id);
  };

  // ── Rename ──────────────────────────────────────────────────────────────────
  const handleRename = (id: string) => {
    if (!renameValue.trim()) return;
    renameCase(id, renameValue.trim());
    setRenamingId(null);
  };

  // ── Export (.gic) ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async (c: SearchlightCase) => {
    try {
      const json = await window.api.searchlight.exportCase(c.id);
      if (json == null) { flash('⚠ Export returned no data.'); return; }
      const filename = `${c.name.replace(/\s+/g, '_')}_${Date.now()}.gic`;
      blobDownload(json, filename, 'application/json');
    } catch (err) {
      flash(`⚠ Export failed: ${String(err)}`);
    }
  }, []);

  // ── Import (.gic) ──────────────────────────────────────────────────────────
  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so the same file can be re-imported
      e.target.value = '';

      let text: string;
      try {
        text = await file.text();
      } catch {
        flash('⚠ Could not read file.');
        return;
      }

      // Validate and sanitize JSON shape
      let incoming: SearchlightCase;
      try {
        const parsed: unknown = JSON.parse(text);
        const sanitized = sanitizeImportedCase(parsed);
        if (!sanitized) throw new Error('missing id/name');
        incoming = sanitized;
      } catch {
        flash('⚠ Invalid .gic file.');
        return;
      }

      // Check for existing case with same name
      const existing = cases.find((c) => c.name === incoming.name);
      if (existing) {
        setPendingMerge({ incoming, existing });
        return;
      }

      // Import as new case via IPC then update store (re-stringify the sanitized object)
      try {
        await window.api.searchlight.importCase(JSON.stringify(incoming));
        storeImport(incoming);
        flash(`✓ Imported "${incoming.name}" as a new case.`);
      } catch (err) {
        flash(`⚠ Import failed: ${String(err)}`);
      }
    },
    [cases, storeImport]
  );

  // ── Merge confirmation ──────────────────────────────────────────────────────
  const handleMergeConfirm = useCallback(async () => {
    if (!pendingMerge) return;
    const { incoming, existing } = pendingMerge;
    setPendingMerge(null);

    const existingJobIds  = new Set(existing.searches.map((j) => j.id));
    const existingNodeIds = new Set(existing.graphNodes.map((n) => n.id));
    const existingEdgeIds = new Set(existing.graphEdges.map((e) => e.id));

    const newJobs  = incoming.searches.filter((j) => !existingJobIds.has(j.id));
    const newNodes = incoming.graphNodes.filter((n) => !existingNodeIds.has(n.id));
    const newEdges = incoming.graphEdges.filter((e) => !existingEdgeIds.has(e.id));

    updateCase(existing.id, {
      searches:   [...existing.searches, ...newJobs],
      graphNodes: [...existing.graphNodes, ...newNodes],
      graphEdges: [...existing.graphEdges, ...newEdges],
    });
    flash(
      `✓ Merged ${newJobs.length} sweep(s) + ${newNodes.length} node(s) into "${existing.name}".`
    );
  }, [pendingMerge, updateCase]);

  const handleMergeAsNew = useCallback(async () => {
    if (!pendingMerge) return;
    const { incoming } = pendingMerge;
    setPendingMerge(null);
    try {
      // incoming was already sanitized at parse time; re-stringify the sanitized form
      await window.api.searchlight.importCase(JSON.stringify(incoming));
      storeImport(incoming);
      flash(`✓ Imported "${incoming.name}" as a new case.`);
    } catch (err) {
      flash(`⚠ Import failed: ${String(err)}`);
    }
  }, [pendingMerge, storeImport]);

  const sortedCases = [...cases].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="sl-cases-root">
      {/* Hidden file input for .gic import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".gic,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Header */}
      <div className="sl-cases-header">
        <div>
          <div className="sl-rp-header-eyebrow">// CASE MANAGEMENT</div>
          <div className="sl-rp-header-title">INVESTIGATIONS</div>
          <div className="sl-cases-persist-note">
            <span className="sl-cases-persist-dot" />
            <span className="sl-cases-persist-text">ENCRYPTED PERSISTENCE — IPC-BACKED</span>
          </div>
        </div>
        <div className="sl-cases-header-actions">
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="sl-sweep-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              ⊕ IMPORT / COLLABORATE
            </button>
            <button
              className="sl-sweep-btn sl-sweep-btn-primary"
              onClick={() => setShowCreate(true)}
            >
              + NEW CASE
            </button>
          </div>
          {statusMsg && (
            <div
              className={
                statusMsg.startsWith('✓')
                  ? 'sl-cases-msg sl-cases-msg-ok'
                  : 'sl-cases-msg sl-cases-msg-warn'
              }
            >
              {statusMsg}
            </div>
          )}
        </div>
      </div>

      {/* Merge confirmation dialog */}
      {pendingMerge && (
        <div className="sl-cases-merge-banner">
          <span className="sl-cases-merge-text">
            Case <strong>&ldquo;{pendingMerge.incoming.name}&rdquo;</strong> already exists. Merge results into it, or import as a new separate case?
          </span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="sl-sweep-btn sl-sweep-btn-primary" onClick={() => void handleMergeConfirm()}>
              MERGE
            </button>
            <button className="sl-sweep-btn" onClick={() => void handleMergeAsNew()}>
              IMPORT AS NEW
            </button>
            <button className="sl-sweep-btn sl-sweep-btn-danger" onClick={() => setPendingMerge(null)}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Collaboration info panel */}
      <div className="sl-cases-info-panel">
        <div className="sl-cases-info-icon">⊞</div>
        <div>
          <div className="sl-cases-info-title">COLLABORATION</div>
          <div className="sl-cases-info-body">
            Export any case as a <span className="sl-cases-info-em">.gic</span> file and share it
            with teammates. Use{' '}
            <span className="sl-cases-info-em">IMPORT / COLLABORATE</span> to bring in their
            findings — if the case name matches, results will be{' '}
            <span className="sl-cases-info-em2">merged automatically</span>.
          </div>
        </div>
        <div className="sl-cases-info-right">
          <div className="sl-cases-info-persist-label">PERSISTENCE</div>
          <div className="sl-cases-info-persist-body">
            Case data is encrypted at rest<br />
            and stored via IPC on every<br />
            mutating action.
          </div>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="sl-cases-create-panel">
          <div className="sl-cases-create-title">NEW INVESTIGATION</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <input
              className="sl-sweep-input"
              value={newCaseName}
              onChange={(e) => setNewCaseName(e.target.value)}
              placeholder="Case name (e.g. OPERATION BLACKOUT)"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={{ flex: 1 }}
            />
            <input
              className="sl-sweep-input"
              value={newCaseDesc}
              onChange={(e) => setNewCaseDesc(e.target.value)}
              placeholder="Description (optional)"
              style={{ flex: 0.6 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="sl-sweep-btn sl-sweep-btn-primary"
              onClick={handleCreate}
              disabled={!newCaseName.trim()}
            >
              ◈ CREATE CASE
            </button>
            <button className="sl-sweep-btn" onClick={() => setShowCreate(false)}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Cases grid */}
      {sortedCases.length === 0 ? (
        <div className="sl-graph-empty-root">
          <div className="sl-graph-empty-icon">◧</div>
          <div className="sl-graph-empty-text">NO CASES — CREATE YOUR FIRST INVESTIGATION</div>
        </div>
      ) : (
        <div className="sl-cases-grid">
          {sortedCases.map((c) => {
            const isActive = c.id === activeCaseId;
            const results  = c.searches.flatMap((s) => s.results);
            const foundCount = results.filter((r) => r.found).length;

            return (
              <div
                key={c.id}
                className={`sl-cases-card${isActive ? ' sl-cases-card-active' : ''}`}
                onClick={() => setActiveCaseId(c.id)}
              >
                {isActive && (
                  <div className="sl-cases-card-active-badge">ACTIVE</div>
                )}

                {renamingId === c.id ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginBottom: 12 }}
                  >
                    <input
                      className="sl-sweep-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(c.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      style={{ marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="sl-sweep-btn sl-sweep-btn-primary"
                        onClick={() => handleRename(c.id)}
                      >
                        SAVE
                      </button>
                      <button
                        className="sl-sweep-btn"
                        onClick={() => setRenamingId(null)}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="sl-cases-card-name">{c.name}</div>
                )}

                {c.description && (
                  <div className="sl-cases-card-desc">{c.description}</div>
                )}

                <div className="sl-cases-card-stats">
                  {[
                    { label: 'SWEEPS',  val: c.searches.length                            },
                    { label: 'FOUND',   val: foundCount,  green: foundCount > 0            },
                    { label: 'CHECKED', val: results.length                                },
                    { label: 'NODES',   val: c.graphNodes.length                           },
                  ].map(({ label, val, green }) => (
                    <div key={label}>
                      <div
                        className="sl-cases-stat-val"
                        style={{ color: green ? '#00ff88' : undefined }}
                      >
                        {val}
                      </div>
                      <div className="sl-cases-stat-lbl">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="sl-cases-card-dates">
                  CREATED: {new Date(c.createdAt).toLocaleDateString()} · UPDATED:{' '}
                  {new Date(c.updatedAt).toLocaleDateString()}
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                >
                  {!isActive && (
                    <button
                      className="sl-sweep-btn sl-sweep-btn-primary"
                      onClick={() => setActiveCaseId(c.id)}
                    >
                      OPEN
                    </button>
                  )}
                  <button
                    className="sl-sweep-btn"
                    onClick={() => {
                      setRenamingId(c.id);
                      setRenameValue(c.name);
                    }}
                  >
                    RENAME
                  </button>
                  <button
                    className="sl-sweep-btn"
                    onClick={() => void handleExport(c)}
                  >
                    EXPORT .GIC
                  </button>
                  <button
                    className="sl-sweep-btn sl-sweep-btn-danger"
                    onClick={() => handleDelete(c.id, c.name)}
                    style={{ marginLeft: 'auto' }}
                  >
                    DELETE
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
