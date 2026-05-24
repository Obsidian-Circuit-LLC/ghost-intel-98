/**
 * Toast store. Small in-app notification queue, surfaced above the taskbar.
 */

import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  ttlMs: number;
}

interface ToastState {
  items: Toast[];
  push(kind: ToastKind, message: string, ttlMs?: number): string;
  dismiss(id: string): void;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `t-${Date.now()}-${seq}`;
}

const DEFAULT_TTL: Record<ToastKind, number> = {
  info: 4500,
  success: 4500,
  warn: 7000,
  error: 10_000
};

export const useToasts = create<ToastState>((set) => ({
  items: [],
  push(kind, message, ttlMs) {
    const id = newId();
    const ttl = ttlMs ?? DEFAULT_TTL[kind];
    const toast: Toast = { id, kind, message, createdAt: Date.now(), ttlMs: ttl };
    set((s) => ({ items: [...s.items, toast] }));
    setTimeout(() => useToasts.getState().dismiss(id), ttl);
    return id;
  },
  dismiss(id) {
    set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
  }
}));

/** Convenience wrappers. */
export const toast = {
  info: (msg: string) => useToasts.getState().push('info', msg),
  success: (msg: string) => useToasts.getState().push('success', msg),
  warn: (msg: string) => useToasts.getState().push('warn', msg),
  error: (msg: string) => useToasts.getState().push('error', msg)
};
