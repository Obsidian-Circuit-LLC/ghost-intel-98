/**
 * Grey 98 taskbar — Access button on the left, open-window pills in the middle, clock tray on the right.
 */

import { useEffect, useState } from 'react';
import { AccessMenu } from './AccessMenu';
import { useWindows } from '../state/store';

export function Taskbar(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [time, setTime] = useState(() => new Date());
  const windows = useWindows((s) => s.windows);
  const focusStack = useWindows((s) => s.focusStack);
  const focus = useWindows((s) => s.focus);
  const minimize = useWindows((s) => s.minimize);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onAway(e: MouseEvent): void {
      const target = e.target as HTMLElement;
      if (target.closest('.ga98-access-menu') || target.closest('.ga98-access-button')) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', onAway);
    return () => document.removeEventListener('mousedown', onAway);
  }, []);

  const activeId = focusStack[focusStack.length - 1];

  return (
    <>
      {menuOpen && <AccessMenu onClose={() => setMenuOpen(false)} />}
      <div className="ga98-taskbar">
        <button
          className="ga98-access-button"
          data-open={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <span aria-hidden="true">🛸</span>
          <span>Access</span>
        </button>
        <div className="ga98-taskbar-divider" />
        <div className="ga98-taskbar-items">
          {windows.map((w) => (
            <button
              key={w.id}
              className="ga98-taskbar-item"
              data-active={w.id === activeId && !w.minimized}
              onClick={() => {
                if (w.id === activeId && !w.minimized) minimize(w.id);
                else focus(w.id);
              }}
              title={w.title}
            >
              {w.title}
            </button>
          ))}
        </div>
        <div className="ga98-tray">
          <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </>
  );
}
