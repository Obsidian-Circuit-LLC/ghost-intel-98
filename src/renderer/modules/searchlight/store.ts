/**
 * Searchlight renderer store — in-memory zustand slice; NO localStorage/persist middleware.
 * Persistence is IPC-backed: saveCase (debounced ~500ms) on mutating actions; hydrated via
 * listCases/loadCase called from SearchlightModule on mount.
 *
 * Slice coverage in this task (Task 9):
 *   - cases / activeCaseId / CRUD (shape only; full hydrate wiring shared with Tasks 10-12)
 *   - sweep job slice: addSearchJob / updateSearchJob / appendSweepResult / finishSweepJob
 *   - saveCase debounce utility (used by sweep actions; graph/whiteboard slices use it too)
 *
 * Graph and whiteboard action bodies are stubbed here to carry the full store shape for Tasks
 * 10-12, which will flesh them out.
 */

import { create } from 'zustand';
import type {
  SearchlightCase,
  SearchlightCaseSummary,
  SearchJob,
  SweepResult,
  GraphNode,
  GraphEdge,
  WhiteboardFile,
  WhiteboardNote,
} from '@shared/searchlight/types';

// ─── Debounced saveCase ───────────────────────────────────────────────────────

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(c: SearchlightCase): void {
  if (_saveTimer !== null) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    void window.api.searchlight.saveCase(c);
  }, 500);
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface SearchlightState {
  // Cases
  cases: SearchlightCase[];
  activeCaseId: string | null;

  // Hydration (called once on mount from SearchlightModule)
  hydrate(): Promise<void>;

  // Case CRUD
  setActiveCaseId(id: string | null): void;
  getActiveCase(): SearchlightCase | null;
  createCase(name: string, description?: string): SearchlightCase;
  updateCase(id: string, updates: Partial<SearchlightCase>): void;
  deleteCase(id: string): Promise<void>;
  renameCase(id: string, name: string): void;
  importCase(c: SearchlightCase): void;

  // Sweep jobs
  addSearchJob(caseId: string, job: SearchJob): void;
  updateSearchJob(caseId: string, jobId: string, updates: Partial<SearchJob>): void;
  appendSweepResult(caseId: string, jobId: string, result: SweepResult): void;
  finishSweepJob(caseId: string, jobId: string, status: 'completed' | 'cancelled'): void;

  // Graph (stubs — implemented in Task 10)
  addGraphNode(caseId: string, node: GraphNode): void;
  updateGraphNode(caseId: string, nodeId: string, updates: Partial<GraphNode>): void;
  removeGraphNode(caseId: string, nodeId: string): void;
  addGraphEdge(caseId: string, edge: GraphEdge): void;
  removeGraphEdge(caseId: string, edgeId: string): void;

  // Whiteboard (stubs — implemented in Task 11)
  addWhiteboardFile(caseId: string, file: WhiteboardFile): void;
  updateWhiteboardFile(caseId: string, fileId: string, updates: Partial<WhiteboardFile>): void;
  removeWhiteboardFile(caseId: string, fileId: string): void;
  addWhiteboardNote(caseId: string, note: WhiteboardNote): void;
  updateWhiteboardNote(caseId: string, noteId: string, updates: Partial<WhiteboardNote>): void;
  removeWhiteboardNote(caseId: string, noteId: string): void;
}

// ─── Helper: mutate a case in-place and schedule a save ──────────────────────

function mutateCaseAndSave(
  cases: SearchlightCase[],
  id: string,
  fn: (c: SearchlightCase) => SearchlightCase
): SearchlightCase[] {
  let saved: SearchlightCase | null = null;
  const next = cases.map((c) => {
    if (c.id !== id) return c;
    const updated = fn(c);
    saved = updated;
    return updated;
  });
  if (saved !== null) scheduleSave(saved);
  return next;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSearchlightStore = create<SearchlightState>((set, get) => ({
  cases: [],
  activeCaseId: null,

  // ── Hydration ──────────────────────────────────────────────────────────────

  async hydrate() {
    const summaries: SearchlightCaseSummary[] = await window.api.searchlight.listCases();
    const loaded: SearchlightCase[] = await Promise.all(
      summaries.map((s) =>
        (window.api.searchlight.loadCase(s.id) as Promise<SearchlightCase | null>).then(
          (c) =>
            c ?? {
              id: s.id,
              name: s.name,
              description: '',
              createdAt: s.updatedAt,
              updatedAt: s.updatedAt,
              searches: [],
              graphNodes: [],
              graphEdges: [],
              whiteboardFiles: [],
              whiteboardNotes: [],
              notes: '',
              tags: [],
            }
        )
      )
    );
    set((s) => ({
      cases: loaded,
      // Keep activeCaseId if it still exists, otherwise default to first case
      activeCaseId:
        s.activeCaseId && loaded.some((c) => c.id === s.activeCaseId)
          ? s.activeCaseId
          : (loaded[0]?.id ?? null),
    }));
  },

  // ── Cases ──────────────────────────────────────────────────────────────────

  setActiveCaseId: (id) => set({ activeCaseId: id }),

  getActiveCase: () => {
    const { cases, activeCaseId } = get();
    return cases.find((c) => c.id === activeCaseId) ?? null;
  },

  createCase: (name, description = '') => {
    const newCase: SearchlightCase = {
      id: crypto.randomUUID(),
      name,
      description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      searches: [],
      graphNodes: [],
      graphEdges: [],
      whiteboardFiles: [],
      whiteboardNotes: [],
      notes: '',
      tags: [],
    };
    set((s) => ({ cases: [...s.cases, newCase], activeCaseId: newCase.id }));
    scheduleSave(newCase);
    return newCase;
  },

  updateCase: (id, updates) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, id, (c) => ({
        ...c,
        ...updates,
        updatedAt: Date.now(),
      })),
    }));
  },

  deleteCase: async (id) => {
    await window.api.searchlight.deleteCase(id);
    set((s) => ({
      cases: s.cases.filter((c) => c.id !== id),
      activeCaseId:
        s.activeCaseId === id
          ? (s.cases.find((c) => c.id !== id)?.id ?? null)
          : s.activeCaseId,
    }));
  },

  renameCase: (id, name) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, id, (c) => ({
        ...c,
        name,
        updatedAt: Date.now(),
      })),
    }));
  },

  importCase: (c) => {
    const imported: SearchlightCase = { ...c, id: crypto.randomUUID() };
    set((s) => ({
      cases: [...s.cases.filter((x) => x.id !== c.id), imported],
    }));
    scheduleSave(imported);
  },

  // ── Sweep jobs ─────────────────────────────────────────────────────────────

  addSearchJob: (caseId, job) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        searches: [...c.searches, job],
        updatedAt: Date.now(),
      })),
    }));
  },

  updateSearchJob: (caseId, jobId, updates) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        searches: c.searches.map((j) => (j.id === jobId ? { ...j, ...updates } : j)),
        updatedAt: Date.now(),
      })),
    }));
  },

  appendSweepResult: (caseId, jobId, result) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        searches: c.searches.map((j) =>
          j.id === jobId
            ? { ...j, results: [...j.results, result], checkedSites: j.checkedSites + 1 }
            : j
        ),
        updatedAt: Date.now(),
      })),
    }));
  },

  finishSweepJob: (caseId, jobId, status) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        searches: c.searches.map((j) =>
          j.id === jobId ? { ...j, status, completedAt: Date.now() } : j
        ),
        updatedAt: Date.now(),
      })),
    }));
  },

  // ── Graph stubs (Task 10) ──────────────────────────────────────────────────

  addGraphNode: (caseId, node) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        graphNodes: [...c.graphNodes, node],
        updatedAt: Date.now(),
      })),
    }));
  },

  updateGraphNode: (caseId, nodeId, updates) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        graphNodes: c.graphNodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
        updatedAt: Date.now(),
      })),
    }));
  },

  removeGraphNode: (caseId, nodeId) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        graphNodes: c.graphNodes.filter((n) => n.id !== nodeId),
        graphEdges: c.graphEdges.filter((e) => e.source !== nodeId && e.target !== nodeId),
        updatedAt: Date.now(),
      })),
    }));
  },

  addGraphEdge: (caseId, edge) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        graphEdges: [...c.graphEdges, edge],
        updatedAt: Date.now(),
      })),
    }));
  },

  removeGraphEdge: (caseId, edgeId) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        graphEdges: c.graphEdges.filter((e) => e.id !== edgeId),
        updatedAt: Date.now(),
      })),
    }));
  },

  // ── Whiteboard stubs (Task 11) ─────────────────────────────────────────────

  addWhiteboardFile: (caseId, file) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardFiles: [...c.whiteboardFiles, file],
        updatedAt: Date.now(),
      })),
    }));
  },

  updateWhiteboardFile: (caseId, fileId, updates) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardFiles: c.whiteboardFiles.map((f) =>
          f.id === fileId ? { ...f, ...updates } : f
        ),
        updatedAt: Date.now(),
      })),
    }));
  },

  removeWhiteboardFile: (caseId, fileId) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardFiles: c.whiteboardFiles.filter((f) => f.id !== fileId),
        updatedAt: Date.now(),
      })),
    }));
  },

  addWhiteboardNote: (caseId, note) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardNotes: [...c.whiteboardNotes, note],
        updatedAt: Date.now(),
      })),
    }));
  },

  updateWhiteboardNote: (caseId, noteId, updates) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardNotes: c.whiteboardNotes.map((n) =>
          n.id === noteId ? { ...n, ...updates } : n
        ),
        updatedAt: Date.now(),
      })),
    }));
  },

  removeWhiteboardNote: (caseId, noteId) => {
    set((s) => ({
      cases: mutateCaseAndSave(s.cases, caseId, (c) => ({
        ...c,
        whiteboardNotes: c.whiteboardNotes.filter((n) => n.id !== noteId),
        updatedAt: Date.now(),
      })),
    }));
  },
}));
