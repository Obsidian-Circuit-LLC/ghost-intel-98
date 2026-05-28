/**
 * Zustand store for renderer state — open windows, focus stack, settings cache.
 * Persistence lives in the main process; this is purely in-memory UI state.
 */

import { create } from 'zustand';
import type { AppSettings } from '@shared/types';

export type ModuleKey =
  | 'cases'
  | 'notepad'
  | 'calendar'
  | 'reminders'
  | 'alarm'
  | 'shred'
  | 'settings'
  | 'net-explorer'
  | 'mail'
  | 'dialterm'
  | 'eyespy'
  | 'ai-assistant'
  | 'doc-viewer'
  | 'help';

export interface WindowSpec {
  id: string;
  module: ModuleKey;
  title: string;
  /** Module-specific props (e.g. { caseId: '…' } for the case-detail variant). */
  props?: Record<string, unknown>;
  /** Position + size — undefined means default placement. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minimized?: boolean;
  maximized?: boolean;
}

interface WindowState {
  windows: WindowSpec[];
  focusStack: string[];
  open(spec: Omit<WindowSpec, 'id'> & { id?: string }): string;
  close(id: string): void;
  focus(id: string): void;
  minimize(id: string): void;
  toggleMaximize(id: string): void;
  update(id: string, patch: Partial<WindowSpec>): void;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `win-${Date.now()}-${seq}`;
}

export const useWindows = create<WindowState>((set) => ({
  windows: [],
  focusStack: [],
  open(spec) {
    const id = spec.id ?? nextId();
    set((s) => {
      const existing = s.windows.find((w) => w.id === id);
      if (existing) {
        return {
          windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
          focusStack: [...s.focusStack.filter((x) => x !== id), id]
        };
      }
      const placed: WindowSpec = {
        ...spec,
        id,
        x: spec.x ?? 60 + (s.windows.length % 6) * 30,
        y: spec.y ?? 60 + (s.windows.length % 6) * 30,
        width: spec.width ?? 760,
        height: spec.height ?? 520
      };
      return {
        windows: [...s.windows, placed],
        focusStack: [...s.focusStack, id]
      };
    });
    return id;
  },
  close(id) {
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
      focusStack: s.focusStack.filter((x) => x !== id)
    }));
  },
  focus(id) {
    set((s) => ({
      focusStack: [...s.focusStack.filter((x) => x !== id), id],
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: false } : w))
    }));
  },
  minimize(id) {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      focusStack: s.focusStack.filter((x) => x !== id)
    }));
  },
  toggleMaximize(id) {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w))
    }));
  },
  update(id, patch) {
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  }
}));

interface SettingsState {
  settings: AppSettings | null;
  load(): Promise<void>;
  patch(patch: Partial<AppSettings>): Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  async load() {
    const s = await window.api.settings.read();
    set({ settings: s });
  },
  async patch(patch) {
    const next = await window.api.settings.update(patch);
    set({ settings: next });
  }
}));
