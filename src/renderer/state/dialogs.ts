/**
 * Themed-dialog store. Replaces the browser-native alert/confirm/prompt
 * with promise-returning calls that surface 98-style modals inside the app.
 */

import { create } from 'zustand';

export type DialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogSpec {
  id: string;
  kind: DialogKind;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Resolved by the dialog host. */
  resolve: (value: boolean | string | null) => void;
}

interface DialogState {
  queue: DialogSpec[];
  push(spec: Omit<DialogSpec, 'id' | 'resolve'>, resolve: DialogSpec['resolve']): void;
  resolveTop(value: boolean | string | null): void;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `dlg-${Date.now()}-${seq}`;
}

export const useDialogs = create<DialogState>((set, get) => ({
  queue: [],
  push(spec, resolve) {
    const id = newId();
    set((s) => ({ queue: [...s.queue, { ...spec, id, resolve }] }));
  },
  resolveTop(value) {
    const top = get().queue[0];
    if (!top) return;
    set((s) => ({ queue: s.queue.slice(1) }));
    top.resolve(value);
  }
}));

/** Themed alert. Returns when the user acknowledges. */
export function alertDialog(message: string, title = 'Ghost Intel 98'): Promise<void> {
  return new Promise<void>((resolve) => {
    useDialogs.getState().push({ kind: 'alert', title, message, okLabel: 'OK' }, () => resolve());
  });
}

/** Themed confirm. Returns true if the user clicked OK, false otherwise. */
export function confirmDialog(message: string, title = 'Confirm'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useDialogs.getState().push({ kind: 'confirm', title, message, okLabel: 'OK', cancelLabel: 'Cancel' }, (v) => resolve(!!v));
  });
}

/** Themed prompt. Returns the entered string, or null if cancelled. */
export function promptDialog(message: string, defaultValue = '', title = 'Input', placeholder?: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useDialogs.getState().push(
      { kind: 'prompt', title, message, defaultValue, placeholder, okLabel: 'OK', cancelLabel: 'Cancel' },
      (v) => resolve(typeof v === 'string' ? v : null)
    );
  });
}
