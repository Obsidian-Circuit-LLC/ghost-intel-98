/**
 * Sticky Notes — a Win95-style desktop note layer.
 *
 * Draggable notes you pin to the desktop: type text, pick an icon and a color. The layer is a
 * full-screen overlay with pointer-events:none, so clicks on empty desktop fall through to the
 * windows beneath; each note re-enables pointer events, so notes float on top and stay usable.
 * A global Hide button clears the desktop without deleting anything.
 *
 * Fired reminders surface here as notes (icon 🔔) — pressing OK acknowledges/completes them.
 * Everything persists via the sticky-notes store (encrypted at rest when login is on); nothing
 * here ever leaves the machine.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StickyNote, StickyNotesState } from '@shared/post-mvp-types';
import { toast } from '../state/toasts';

const ICONS = ['📌', '📝', '⭐', '❗', '✅', '💡', '🔔', '🔥', '🧠', '⏰', '📎', '❤️'];
const COLORS = ['yellow', 'pink', 'blue', 'green', 'white'] as const;

function uid(): string { return crypto.randomUUID(); }

const EMPTY: StickyNotesState = { notes: [], hidden: false };

// Position of the draggable New note / Hide notes bundle. Pure UI preference (non-sensitive),
// so it persists in localStorage rather than crossing the encrypted store / IPC boundary.
const CONTROLS_POS_KEY = 'ga98.stickyControls.pos';
const CONTROLS_W = 172; // approximate bundle width, for clamping into the viewport
const CONTROLS_H = 26;
const TASKBAR_H = 32;

function clampControls(p: { x: number; y: number }): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - CONTROLS_W);
  const maxY = Math.max(0, window.innerHeight - TASKBAR_H - CONTROLS_H);
  return { x: Math.min(Math.max(0, p.x), maxX), y: Math.min(Math.max(0, p.y), maxY) };
}

function loadControlsPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(CONTROLS_POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof p.x === 'number' && typeof p.y === 'number') return clampControls({ x: p.x, y: p.y });
    }
  } catch { /* ignore a malformed preference */ }
  // Default: bottom-centre, above the taskbar — clear of the window min/close buttons (top-right),
  // the desktop icon column (left edge), and Shred (bottom-right corner).
  return clampControls({
    x: Math.round(window.innerWidth / 2 - CONTROLS_W / 2),
    y: window.innerHeight - TASKBAR_H - CONTROLS_H - 8
  });
}

export function StickyNotes(): JSX.Element | null {
  const [state, setState] = useState<StickyNotesState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Teardown for an in-flight drag's window listeners, so an unmount mid-drag (e.g. vault lock)
  // doesn't leak global pointer handlers.
  const dragCleanup = useRef<(() => void) | null>(null);
  // Latest state for callbacks that must not re-bind (the reminder subscription).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Draggable position of the New note / Hide notes bundle.
  const [controlsPos, setControlsPos] = useState(loadControlsPos);
  const controlsPosRef = useRef(controlsPos);
  useEffect(() => { controlsPosRef.current = controlsPos; }, [controlsPos]);
  const controlsDrag = useRef<(() => void) | null>(null);
  // Keep the bundle on-screen if the window is resized.
  useEffect(() => {
    const onResize = (): void => setControlsPos((p) => clampControls(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // On unmount (the whole shell unmounts on vault lock): flush any pending debounced text edit
  // so the last keystrokes aren't dropped, and tear down any active drag listeners. The flush
  // is best-effort + silent — if the vault just locked the write will reject, and there's no
  // way to persist while sealed anyway; we don't want a spurious error toast on lock.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void window.api.stickyNotes.save(stateRef.current).catch(() => {});
      }
      dragCleanup.current?.();
      dragCleanup.current = null;
      controlsDrag.current?.();
      controlsDrag.current = null;
    };
  }, []);

  useEffect(() => {
    void window.api.stickyNotes.get().then((s) => { setState(s ?? EMPTY); setLoaded(true); });
  }, []);

  const save = useCallback((next: StickyNotesState) => {
    void window.api.stickyNotes.save(next).catch((err) => toast.error(`Sticky notes save failed: ${(err as Error).message}`));
  }, []);

  // Structural changes persist immediately; text edits debounce (each save re-encrypts the file).
  const commit = useCallback((next: StickyNotesState, debounce = false) => {
    setState(next);
    if (debounce) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 700);
    } else {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      save(next);
    }
  }, [save]);

  const updateNote = useCallback((id: string, patch: Partial<StickyNote>, debounce = false) => {
    const cur = stateRef.current;
    commit({ ...cur, notes: cur.notes.map((n) => n.id === id ? { ...n, ...patch } : n) }, debounce);
  }, [commit]);

  const removeNote = useCallback((id: string) => {
    const cur = stateRef.current;
    commit({ ...cur, notes: cur.notes.filter((n) => n.id !== id) });
  }, [commit]);

  const addNote = useCallback((seed?: Partial<StickyNote>) => {
    const cur = stateRef.current;
    // Cascade new notes so they don't stack exactly on top of each other.
    const offset = (cur.notes.length % 8) * 26;
    const note: StickyNote = {
      id: seed?.id ?? uid(),
      text: seed?.text ?? '',
      icon: seed?.icon ?? '📌',
      color: seed?.color ?? 'yellow',
      x: seed?.x ?? 80 + offset,
      y: seed?.y ?? 90 + offset,
      ...(seed?.reminderId ? { reminderId: seed.reminderId } : {})
    };
    commit({ ...cur, notes: [...cur.notes, note], hidden: false });
  }, [commit]);

  // Fired reminders become desktop notes. De-dupe by reminderId so a re-delivered event
  // (or both this layer and another listener) can't spawn twins.
  useEffect(() => {
    if (!loaded) return;
    const off = window.api.system.onReminderFired(({ reminder }) => {
      const cur = stateRef.current;
      if (cur.notes.some((n) => n.reminderId === reminder.id)) return;
      addNote({ text: reminder.title, icon: '🔔', color: 'pink', reminderId: reminder.id });
    });
    return () => off();
  }, [loaded, addNote]);

  // OK on a reminder note: drop the note and, for a global reminder, delete it so it doesn't
  // linger in lists. Case reminders are already marked fired in main, so this just dismisses.
  const completeReminder = useCallback((note: StickyNote) => {
    if (note.reminderId) void window.api.reminders.deleteGlobal(note.reminderId).catch(() => { /* case reminder / already gone */ });
    removeNote(note.id);
  }, [removeNote]);

  // --- drag (self-contained: listeners live only for the duration of one drag) ---
  function startDrag(e: React.PointerEvent, note: StickyNote): void {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY, origX = note.x, origY = note.y, id = note.id;
    function onMove(ev: PointerEvent): void {
      const x = Math.max(0, origX + (ev.clientX - startX));
      const y = Math.max(0, origY + (ev.clientY - startY));
      setState((s) => ({ ...s, notes: s.notes.map((n) => n.id === id ? { ...n, x, y } : n) }));
    }
    const teardown = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragCleanup.current = null;
    };
    function onUp(): void {
      teardown();
      save(stateRef.current); // persist the final position once
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanup.current = teardown; // so unmount can remove these if the drag is interrupted
  }

  // --- drag the controls bundle (grip handle only, so the buttons stay clickable) ---
  function startControlsDrag(e: React.PointerEvent): void {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = controlsPosRef.current.x, origY = controlsPosRef.current.y;
    function onMove(ev: PointerEvent): void {
      setControlsPos(clampControls({ x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) }));
    }
    const teardown = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      controlsDrag.current = null;
    };
    function onUp(): void {
      teardown();
      try { localStorage.setItem(CONTROLS_POS_KEY, JSON.stringify(controlsPosRef.current)); } catch { /* storage full / disabled */ }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    controlsDrag.current = teardown;
  }

  if (!loaded) return null;

  const count = state.notes.length;

  return (
    <div className="ga98-sticky-layer">
      <div className="ga98-sticky-controls" style={{ left: controlsPos.x, top: controlsPos.y }}>
        <span className="ga98-sticky-grip" title="Drag to move these buttons" onPointerDown={startControlsDrag}>⠿</span>
        <button onClick={() => addNote()} title="Add a sticky note to the desktop">📌 New note</button>
        {count > 0 && (
          <button
            onClick={() => commit({ ...state, hidden: !state.hidden })}
            title={state.hidden ? 'Show all sticky notes' : 'Hide all sticky notes (nothing is deleted)'}
          >
            {state.hidden ? `🙉 Show notes (${count})` : '🙈 Hide notes'}
          </button>
        )}
      </div>

      {!state.hidden && state.notes.map((n) => (
        <div key={n.id} className="ga98-sticky" data-color={n.color} style={{ left: n.x, top: n.y }}>
          <div className="ga98-sticky-bar" onPointerDown={(e) => startDrag(e, n)}>
            <button
              className="ga98-sticky-icon"
              title="Click to change the icon"
              onClick={() => updateNote(n.id, { icon: ICONS[(ICONS.indexOf(n.icon) + 1) % ICONS.length] })}
            >{n.icon}</button>
            <span style={{ flex: 1 }} />
            {n.reminderId && (
              <button className="ga98-sticky-ok" title="Mark this reminder complete" onClick={() => completeReminder(n)}>OK</button>
            )}
            <button className="ga98-sticky-x" title="Delete this note" onClick={() => removeNote(n.id)}>×</button>
          </div>
          <textarea
            className="ga98-sticky-text"
            value={n.text}
            placeholder="Type a note…"
            onChange={(e) => updateNote(n.id, { text: e.target.value }, true)}
            onBlur={() => save(stateRef.current)}
          />
          <div className="ga98-sticky-colors">
            {COLORS.map((c) => (
              <button
                key={c}
                className="ga98-sticky-swatch"
                data-color={c}
                data-active={c === n.color}
                title={c}
                onClick={() => updateNote(n.id, { color: c })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
