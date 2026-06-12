import { useEffect, useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { Viewer } from './Viewer';

/** Fixed 3×3 video wall. `slots` are CameraStream ids or null; `byId` resolves them. */
export function Wall({ slots, byId, activeSlot, onActivate, onClearSlot, onAddNew, onExpand }: {
  slots: (string | null)[];
  byId: Map<string, CameraStream>;
  activeSlot: number | null;
  onActivate: (i: number) => void;
  onClearSlot: (i: number) => void;
  onAddNew: () => void;
  onExpand: (s: CameraStream) => void;
}): JSX.Element {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = (): void => setNow(new Date().toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 4, padding: 4, height: '100%', background: '#1a1a1a' }}>
      {slots.map((id, i) => {
        const stream = id ? byId.get(id) : undefined;
        const active = activeSlot === i;
        const border = active ? '2px solid #2a7' : '1px solid #333';
        if (!stream) {
          const firstEmpty = slots.findIndex((s) => s == null || !byId.has(s)) === i;
          return (
            <div key={i} onClick={() => { onActivate(i); if (firstEmpty) onAddNew(); }}
              style={{ border, background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#777', cursor: 'pointer' }}>
              {firstEmpty ? <><div style={{ fontSize: 28 }}>＋</div><div style={{ fontSize: 11 }}>Add new feed</div></> : <span style={{ fontSize: 10 }}>empty</span>}
            </div>
          );
        }
        return (
          <div key={i} onClick={() => onActivate(i)} style={{ border, position: 'relative', background: '#000', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.55)', color: '#cde', fontSize: 10, padding: '1px 4px', zIndex: 1 }}>
              <span>as of {now}</span>
              <button title="Clear this square" onClick={(e) => { e.stopPropagation(); onClearSlot(i); }} style={{ padding: '0 4px', lineHeight: '12px' }}>×</button>
            </div>
            <div onDoubleClick={() => onExpand(stream)} style={{ height: '100%' }}><Viewer stream={stream} /></div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '1px 4px' }}>{stream.label}</div>
          </div>
        );
      })}
    </div>
  );
}
