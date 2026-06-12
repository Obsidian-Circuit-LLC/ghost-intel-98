// src/renderer/modules/eyespy/CameraGrid.tsx
import { useEffect, useRef } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { Viewer } from './Viewer';
import { useLivePlayerBudget } from './useLivePlayerBudget';

export function CameraGrid({ streams, onExpand, onAdd, onDelete }: {
  streams: CameraStream[];
  onExpand: (s: CameraStream) => void;
  onAdd: () => void;
  onDelete: (s: CameraStream) => void;
}): JSX.Element {
  const { setVisible, isLive } = useLivePlayerBudget();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, padding: 6, overflow: 'auto', height: '100%', alignContent: 'start' }}>
      {streams.map((s) => (
        <Tile key={s.id} stream={s} live={isLive(s.id)} onVisible={setVisible} onExpand={() => onExpand(s)} onDelete={() => onDelete(s)} />
      ))}
      <button onClick={onAdd} title="Add a camera feed"
        style={{ aspectRatio: '16 / 9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#888' }}>
        ＋
      </button>
    </div>
  );
}

function Tile({ stream, live, onVisible, onExpand, onDelete }: {
  stream: CameraStream; live: boolean; onVisible: (id: string, v: boolean) => void; onExpand: () => void; onDelete: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => onVisible(stream.id, e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => { io.disconnect(); onVisible(stream.id, false); };
  }, [stream.id, onVisible]);
  return (
    <div ref={ref} onClick={onExpand} title={`${stream.label} — click to enlarge`}
      style={{ aspectRatio: '16 / 9', background: '#000', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
      <Viewer stream={stream} poster={!live} />
      <button title="Delete this stream" aria-label={`Delete ${stream.label}`}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, lineHeight: '14px', padding: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', cursor: 'pointer' }}>
        ×
      </button>
      <div style={{ position: 'absolute', left: 0, bottom: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '1px 4px' }}>
        {stream.label}
      </div>
    </div>
  );
}
