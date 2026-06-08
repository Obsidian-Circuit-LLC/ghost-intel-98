/**
 * Desktop Clock — a Win98-style clock widget pinned to the desktop (like the Sticky Notes layer).
 *
 * Two faces: DIGITAL (12h or 24h) and ANALOG (clock face with numbers + hour/minute/second hands).
 * Draggable anywhere on the desktop; HIDE collapses it to a small 🕐 pill, click to reveal — so the
 * time can be hidden or revealed at will. Position + face + 12/24h + hidden state persist in
 * localStorage: a pure, non-sensitive UI preference, so (like the sticky-notes controls position) it
 * never crosses the encrypted store / IPC boundary. Off by default — enabled from the Access menu.
 */
import { useEffect, useRef, useState } from 'react';

type Face = 'digital' | 'analog';
interface ClockPrefs { x: number; y: number; face: Face; hour12: boolean; hidden: boolean }

const KEY = 'ga98.clock.prefs';
const W = 168, H = 168, PILL = 30, TASKBAR_H = 32;
export const CLOCK_ENABLED_KEY = 'ga98.clock.enabled';

function clamp(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - w);
  const maxY = Math.max(0, window.innerHeight - TASKBAR_H - h);
  return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}

function load(): ClockPrefs {
  const def: ClockPrefs = { ...clamp(window.innerWidth - W - 16, 16, W, H), face: 'analog', hour12: true, hidden: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ClockPrefs>;
      const face: Face = p.face === 'digital' ? 'digital' : 'analog';
      const pos = clamp(typeof p.x === 'number' ? p.x : def.x, typeof p.y === 'number' ? p.y : def.y, W, H);
      return { ...pos, face, hour12: p.hour12 !== false, hidden: p.hidden === true };
    }
  } catch { /* malformed preference — fall through to default */ }
  return def;
}

function Hand({ angle, len, width, color }: { angle: number; len: number; width: number; color: string }): JSX.Element {
  const rad = (angle - 90) * (Math.PI / 180);
  return <line x1={50} y1={50} x2={50 + len * Math.cos(rad)} y2={50 + len * Math.sin(rad)} stroke={color} strokeWidth={width} strokeLinecap="round" />;
}

function AnalogFace({ now }: { now: Date }): JSX.Element {
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  const nums = [];
  for (let i = 1; i <= 12; i += 1) {
    const a = i * 30 * (Math.PI / 180);
    nums.push(
      <text key={i} x={50 + 38 * Math.sin(a)} y={50 - 38 * Math.cos(a)} textAnchor="middle" dominantBaseline="central" fontSize={9} fontFamily="'MS Sans Serif', Tahoma, sans-serif" fill="#000">{i}</text>
    );
  }
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: 'block' }}>
      <circle cx={50} cy={50} r={47} fill="#fff" stroke="#808080" strokeWidth={2} />
      <circle cx={50} cy={50} r={47} fill="none" stroke="#000" strokeWidth={0.5} />
      {nums}
      <Hand angle={(h + m / 60) * 30} len={24} width={2.4} color="#000" />
      <Hand angle={(m + s / 60) * 6} len={34} width={1.6} color="#000" />
      <Hand angle={s * 6} len={36} width={0.8} color="#c00000" />
      <circle cx={50} cy={50} r={2} fill="#000" />
    </svg>
  );
}

export function ClockWidget(): JSX.Element | null {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(CLOCK_ENABLED_KEY) === '1'; } catch { return false; }
  });
  const [prefs, setPrefs] = useState<ClockPrefs>(load);
  const [now, setNow] = useState<Date>(() => new Date());
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  const dragCleanup = useRef<(() => void) | null>(null);
  const draggedRef = useRef(false); // distinguishes a drag from a click (so the pill only reveals on a click)

  // Toggle from the Access menu via a window event (no store coupling needed for a UI widget).
  useEffect(() => {
    const onToggle = (): void => {
      setEnabled((e) => { const n = !e; try { localStorage.setItem(CLOCK_ENABLED_KEY, n ? '1' : '0'); } catch { /* */ } return n; });
    };
    window.addEventListener('ga98:toggle-clock', onToggle);
    return () => window.removeEventListener('ga98:toggle-clock', onToggle);
  }, []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onResize = (): void => setPrefs((p) => ({ ...p, ...clamp(p.x, p.y, p.hidden ? PILL : W, p.hidden ? PILL : H) }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => () => { dragCleanup.current?.(); }, []);

  function persist(p: ClockPrefs): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage off */ } }
  function update(patch: Partial<ClockPrefs>): void { setPrefs((p) => { const n = { ...p, ...patch }; persist(n); return n; }); }

  function startDrag(e: React.PointerEvent): void {
    e.preventDefault();
    draggedRef.current = false;
    const startX = e.clientX, startY = e.clientY;
    const origX = prefsRef.current.x, origY = prefsRef.current.y;
    const box = prefsRef.current.hidden ? PILL : W, boxH = prefsRef.current.hidden ? PILL : H;
    function onMove(ev: PointerEvent): void {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) draggedRef.current = true;
      setPrefs((p) => ({ ...p, ...clamp(origX + (ev.clientX - startX), origY + (ev.clientY - startY), box, boxH) }));
    }
    const teardown = (): void => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); dragCleanup.current = null; };
    function onUp(): void { teardown(); persist(prefsRef.current); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanup.current = teardown;
  }

  if (!enabled) return null;

  // Hidden: a small draggable 🕐 pill; click (without dragging) reveals the clock.
  if (prefs.hidden) {
    return (
      <button
        className="ga98-clock-pill"
        style={{ left: prefs.x, top: prefs.y }}
        title="Show the clock"
        onPointerDown={startDrag}
        onClick={() => { if (!draggedRef.current) update({ hidden: false }); }}
      >🕐</button>
    );
  }

  const digital = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: prefs.hour12 });

  return (
    <div className="ga98-clock" style={{ left: prefs.x, top: prefs.y, width: W }}>
      <div className="ga98-clock-bar" onPointerDown={startDrag}>
        <span className="ga98-clock-title">Clock</span>
        <span style={{ flex: 1 }} />
        <button className="ga98-clock-btn" title={prefs.face === 'analog' ? 'Switch to digital' : 'Switch to analog'} onClick={() => update({ face: prefs.face === 'analog' ? 'digital' : 'analog' })}>{prefs.face === 'analog' ? '🔢' : '🕓'}</button>
        <button className="ga98-clock-btn" title="Hide the clock" onClick={() => update({ hidden: true })}>—</button>
      </div>
      <div className="ga98-clock-body">
        {prefs.face === 'analog'
          ? <div className="ga98-clock-analog"><AnalogFace now={now} /></div>
          : (
            <div className="ga98-clock-digital">
              <div className="ga98-clock-time">{digital}</div>
              <button className="ga98-clock-fmt" title="Toggle 12 / 24 hour" onClick={() => update({ hour12: !prefs.hour12 })}>{prefs.hour12 ? '12h' : '24h'}</button>
            </div>
          )}
      </div>
    </div>
  );
}
