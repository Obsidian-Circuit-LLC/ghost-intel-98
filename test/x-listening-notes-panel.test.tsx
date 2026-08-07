// @vitest-environment jsdom
/**
 * X6 — analyst notes panel (renderer).
 *
 * Guards the explicit X6 interface requirement: the note editor uses `confirm()`, never
 * `prompt()` (window.prompt() returns null in Electron's renderer — a prompt-gated editor
 * is a silent no-op; operator memory note "Electron window.prompt no-op"). createRoot + act,
 * NO @testing-library (Global Constraint: no new dependency).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NotesPanel } from '../src/renderer/modules/x-listening/panels/NotesPanel';

type Note = { findingId: string; text: string; savedAt: string };

function stubApi(initial: Note[]) {
  const store = [...initial];
  const saveNote = vi.fn(async (req: { caseId: string; findingId: string; text: string }) => {
    const idx = store.findIndex((n) => n.findingId === req.findingId);
    const note: Note = { findingId: req.findingId, text: req.text, savedAt: '2026-08-06T12:00:00.000Z' };
    if (idx >= 0) store[idx] = note; else store.push(note);
    return { notes: [...store] };
  });
  const readNotes = vi.fn(async () => ({ notes: [...store] }));
  (globalThis as any).window.api = { xListening: { saveNote, readNotes } };
  return { saveNote, readNotes };
}

describe('NotesPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let promptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // prompt() is a no-op in Electron — assert the panel NEVER reaches for it.
    promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    promptSpy.mockRestore();
    delete (globalThis as any).window.api;
    vi.restoreAllMocks();
  });

  const typeInto = async (text: string) => {
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(ta, text);
    await act(async () => { ta.dispatchEvent(new Event('input', { bubbles: true })); });
    return ta;
  };
  const saveBtn = () =>
    Array.from(container.querySelectorAll('button')).find((b) => /save|update/i.test(b.textContent || ''))!;

  it('composes via a <textarea> and saves through the IPC surface — never prompt()', async () => {
    const { saveNote } = stubApi([]);
    await act(async () => { root.render(<NotesPanel caseId="case-a" findingId="f1" />); });

    await typeInto('first observation');
    await act(async () => { saveBtn().click(); });

    expect(saveNote).toHaveBeenCalledWith({ caseId: 'case-a', findingId: 'f1', text: 'first observation' });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('confirm()s before overwriting an existing note; a cancel blocks the save', async () => {
    const { saveNote } = stubApi([{ findingId: 'f1', text: 'original', savedAt: '2026-08-06T00:00:00.000Z' }]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    // Wait for the mounted panel to load the existing note.
    await act(async () => { root.render(<NotesPanel caseId="case-a" findingId="f1" findingLabel="@target post" />); });
    await act(async () => { await Promise.resolve(); });

    await typeInto('revised text');
    await act(async () => { saveBtn().click(); });

    expect(confirmSpy).toHaveBeenCalled();      // destructive overwrite gated by confirm()
    expect(promptSpy).not.toHaveBeenCalled();   // and never prompt()
    expect(saveNote).not.toHaveBeenCalled();    // cancel blocked the write
    confirmSpy.mockRestore();
  });

  it('confirm() accepted → the overwrite is persisted', async () => {
    const { saveNote } = stubApi([{ findingId: 'f1', text: 'original', savedAt: '2026-08-06T00:00:00.000Z' }]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => { root.render(<NotesPanel caseId="case-a" findingId="f1" />); });
    await act(async () => { await Promise.resolve(); });

    await typeInto('revised text');
    await act(async () => { saveBtn().click(); });

    expect(confirmSpy).toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledWith({ caseId: 'case-a', findingId: 'f1', text: 'revised text' });
    confirmSpy.mockRestore();
  });
});
