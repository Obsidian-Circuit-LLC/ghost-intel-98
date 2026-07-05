/**
 * Per-case run store for the investigation cockpit (SP-6 run harness UI).
 *
 * Zustand slice mirroring src/renderer/state/store.ts. Keyed by `caseId` because the
 * run executes main-side — a tab-switch unmount must NOT lose the live feed or runId,
 * and two cases must never cross-contaminate. A store-level "last run" pointer not
 * scoped to the active case goes stale and blanks the panel (`[[searchlight-panel-unmount-state]]`).
 *
 * Pure reducers: no Date.now / Math.random; events fold through the deterministic
 * `formatRunEvent` / `appendCapped` from run-feed.ts.
 */

import { create } from 'zustand';
import type { RunEvent } from '@shared/investigation-agent';
import {
  formatRunEvent,
  appendCapped,
  type FeedLine,
} from '../modules/investigation-graph/run-feed';

export type RunStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'done';

export interface RunEntry {
  /** The active/last run's id, or null before any run began. */
  runId: string | null;
  status: RunStatus;
  feed: FeedLine[];
  /** The prompt text when the agent is waiting on the analyst, else null. */
  pendingAsk: string | null;
  /** `run.available()` probe result; null until probed. */
  available: boolean | null;
}

/** A fresh, idle entry. Exported so consumers can render a default before any action. */
export const emptyRunEntry = (): RunEntry => ({
  runId: null,
  status: 'idle',
  feed: [],
  pendingAsk: null,
  available: null,
});

export interface InvestigationRunState {
  /** Per-case run UI state. Never mutated in place — every action writes a fresh entry. */
  cases: Record<string, RunEntry>;
  setAvailable(caseId: string, available: boolean): void;
  beginRun(caseId: string, runId: string): void;
  applyEvent(caseId: string, event: RunEvent): void;
  reset(caseId: string): void;
}

export const useInvestigationRunStore = create<InvestigationRunState>((set) => ({
  cases: {},

  setAvailable(caseId, available) {
    set((s) => {
      const prev = s.cases[caseId] ?? emptyRunEntry();
      return { cases: { ...s.cases, [caseId]: { ...prev, available } } };
    });
  },

  beginRun(caseId, runId) {
    set((s) => {
      const prev = s.cases[caseId] ?? emptyRunEntry();
      return {
        cases: {
          ...s.cases,
          [caseId]: { ...prev, runId, status: 'running', feed: [], pendingAsk: null },
        },
      };
    });
  },

  applyEvent(caseId, event) {
    set((s) => {
      const prev = s.cases[caseId] ?? emptyRunEntry();
      const feed = appendCapped(prev.feed, formatRunEvent(event));
      let { status, pendingAsk } = prev;
      switch (event.kind) {
        case 'ask':
          pendingAsk = event.question;
          status = 'running';
          break;
        case 'action':
          // The agent is acting again — any parked question is resolved.
          pendingAsk = null;
          break;
        case 'paused':
          status = 'paused';
          break;
        case 'resumed':
          status = 'running';
          break;
        case 'stopped':
          status = 'stopped';
          break;
        case 'done':
          status = 'done';
          break;
        case 'observed':
        case 'thinking':
        case 'blocked':
          break;
      }
      return { cases: { ...s.cases, [caseId]: { ...prev, feed, status, pendingAsk } } };
    });
  },

  reset(caseId) {
    set((s) => {
      const prev = s.cases[caseId] ?? emptyRunEntry();
      // Keep the availability probe result — it's independent of any single run.
      return { cases: { ...s.cases, [caseId]: { ...emptyRunEntry(), available: prev.available } } };
    });
  },
}));
