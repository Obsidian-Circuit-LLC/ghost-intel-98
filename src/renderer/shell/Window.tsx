/**
 * Draggable, resizable Window with 98-style title bar and min/max/close buttons.
 * The drag math is intentionally simple — pointer events, no external lib.
 */

import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { WindowSpec } from '../state/store';

interface WindowProps {
  spec: WindowSpec;
  focused: boolean;
  onFocus(): void;
  onClose(): void;
  onMinimize(): void;
  onToggleMaximize(): void;
  onMove(x: number, y: number): void;
  onResize(w: number, h: number): void;
}

interface DragState {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

export function Window({ spec, focused, onFocus, onClose, onMinimize, onToggleMaximize, onMove: onMoveProp, onResize: onResizeProp, children }: PropsWithChildren<WindowProps>): JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const startMove = useCallback((e: React.MouseEvent) => {
    if (spec.maximized) return;
    e.preventDefault();
    onFocus();
    setDrag({
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origX: spec.x ?? 60,
      origY: spec.y ?? 60,
      origW: spec.width ?? 760,
      origH: spec.height ?? 520
    });
  }, [spec, onFocus]);

  const startResize = useCallback((e: React.MouseEvent) => {
    if (spec.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    setDrag({
      kind: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      origX: spec.x ?? 60,
      origY: spec.y ?? 60,
      origW: spec.width ?? 760,
      origH: spec.height ?? 520
    });
  }, [spec, onFocus]);

  useEffect(() => {
    if (!drag) return;
    function handleMove(ev: MouseEvent): void {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (drag.kind === 'move') {
        const x = Math.max(0, drag.origX + dx);
        const y = Math.max(0, drag.origY + dy);
        (shellRef.current as HTMLDivElement).style.left = `${x}px`;
        (shellRef.current as HTMLDivElement).style.top = `${y}px`;
      } else {
        const w = Math.max(320, drag.origW + dx);
        const h = Math.max(220, drag.origH + dy);
        (shellRef.current as HTMLDivElement).style.width = `${w}px`;
        (shellRef.current as HTMLDivElement).style.height = `${h}px`;
      }
    }
    function handleUp(ev: MouseEvent): void {
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (drag.kind === 'move') {
        onMoveProp(Math.max(0, drag.origX + dx), Math.max(0, drag.origY + dy));
      } else {
        onResizeProp(Math.max(320, drag.origW + dx), Math.max(220, drag.origH + dy));
      }
      setDrag(null);
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [drag, onMoveProp, onResizeProp]);

  // Minimized windows stay mounted (so their live state — audio, conversations, unsaved
  // text — survives) but are hidden. display:none halts paint + pointer events but NOT
  // media playback or timers, which is exactly what we want for the Jukebox.
  const positionStyle = spec.minimized
    ? { display: 'none' as const }
    : spec.maximized
      ? { left: 0, top: 0, right: 0, bottom: 'var(--ga98-taskbar-height)' as string, width: 'auto', height: 'auto' }
      : { left: spec.x, top: spec.y, width: spec.width, height: spec.height };

  return (
    <div
      ref={shellRef}
      className="ga98-window-shell"
      style={positionStyle}
      data-focused={focused}
      onMouseDown={onFocus}
    >
      <div className="window">
        <div className="title-bar" onMouseDown={startMove} onDoubleClick={onToggleMaximize}>
          <div className="title-bar-text">{spec.title}</div>
          <div className="title-bar-controls ga98-titlebar-buttons">
            <button aria-label="Minimize" onClick={(e) => { e.stopPropagation(); onMinimize(); }} />
            <button aria-label={spec.maximized ? 'Restore' : 'Maximize'} onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }} />
            <button aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }} />
          </div>
        </div>
        <div className="window-body">{children}</div>
        {!spec.maximized && (
          <div
            onMouseDown={startResize}
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              width: 16,
              height: 16,
              cursor: 'nwse-resize'
            }}
          />
        )}
      </div>
    </div>
  );
}
