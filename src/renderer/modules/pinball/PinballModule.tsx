/**
 * Pinball — a self-contained canvas game (no IPC, storage, or network) in the spirit of the Win98
 * "Space Cadet" table, for GhostExodus's son. Conservative physics: substepped integration (no
 * tunneling), closest-point ball-vs-segment collisions with restitution < 1, circle bumpers that add
 * score, two pivoting flippers, a plunger launch lane, drain detection, and 3 balls.
 *
 * Controls: ←/A flips the left flipper, →/L the right, Space (hold then release, or tap) launches the
 * ball from the lane. Math.random is fine — purely cosmetic game state.
 *
 * NOTE: physics games need real play-testing; this was written to be robust-by-construction but has
 * not been interactively tuned in a running app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const W = 360, H = 600;
const BALL_R = 8;
const GRAV = 0.18;
const REST = 0.72;          // wall restitution
const MAX_V = 9;            // velocity clamp (anti-tunnel safety)
const SUBSTEPS = 4;

interface V { x: number; y: number }
interface Seg { a: V; b: V }
interface Bumper { p: V; r: number; score: number }

// Table geometry (canvas coords; y down). Outer walls, angled lower funnels, launch-lane divider.
const WALLS: Seg[] = [
  { a: { x: 12, y: 20 }, b: { x: 12, y: 540 } },              // left wall
  { a: { x: 318, y: 20 }, b: { x: 318, y: 560 } },            // right wall (launch lane outer)
  { a: { x: 12, y: 20 }, b: { x: 318, y: 20 } },              // top
  { a: { x: 12, y: 540 }, b: { x: 120, y: 600 } },            // lower-left funnel toward flipper
  { a: { x: 318, y: 560 }, b: { x: 240, y: 600 } },           // lower-right funnel toward flipper
  { a: { x: 292, y: 70 }, b: { x: 292, y: 540 } },            // launch-lane divider
  { a: { x: 60, y: 90 }, b: { x: 110, y: 70 } },              // upper-left kicker
  { a: { x: 300, y: 90 }, b: { x: 250, y: 70 } }              // upper-right kicker
];
const BUMPERS: Bumper[] = [
  { p: { x: 110, y: 180 }, r: 22, score: 100 },
  { p: { x: 190, y: 140 }, r: 22, score: 100 },
  { p: { x: 160, y: 250 }, r: 18, score: 250 },
  { p: { x: 240, y: 210 }, r: 18, score: 250 }
];
// Flipper pivots + geometry. Left flips counter-clockwise up; right clockwise up.
const LEFT_PIVOT: V = { x: 120, y: 560 };
const RIGHT_PIVOT: V = { x: 232, y: 560 };
const FLIP_LEN = 56;
const REST_ANG_L = 0.5, UP_ANG_L = -0.5;     // radians from horizontal (left)
const REST_ANG_R = Math.PI - 0.5, UP_ANG_R = Math.PI + 0.5; // (right, mirrored)

function sub(a: V, b: V): V { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a: V, b: V): V { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: V, s: number): V { return { x: a.x * s, y: a.y * s }; }
function dot(a: V, b: V): number { return a.x * b.x + a.y * b.y; }
function len(a: V): number { return Math.hypot(a.x, a.y); }
function norm(a: V): V { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }
function clampV(v: V): V { const l = len(v); return l > MAX_V ? mul(v, MAX_V / l) : v; }

/** Closest point on segment ab to point p. */
function closest(p: V, a: V, b: V): V {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return add(a, mul(ab, t));
}

function flipperSeg(pivot: V, ang: number): Seg {
  return { a: pivot, b: { x: pivot.x + Math.cos(ang) * FLIP_LEN, y: pivot.y + Math.sin(ang) * FLIP_LEN } };
}

export function PinballModule(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [balls, setBalls] = useState(3);
  const [over, setOver] = useState(false);
  const [launched, setLaunched] = useState(false);

  // Mutable physics state (refs — not React state, to avoid re-render churn in the RAF loop).
  const ball = useRef<V>({ x: 305, y: 520 });
  const vel = useRef<V>({ x: 0, y: 0 });
  const onPlunger = useRef(true);
  const angL = useRef(REST_ANG_L);
  const angR = useRef(REST_ANG_R);
  const keyL = useRef(false);
  const keyR = useRef(false);
  const scoreRef = useRef(0);
  const ballsRef = useRef(3);
  const overRef = useRef(false);
  const raf = useRef<number | null>(null);

  const resetBall = useCallback(() => {
    ball.current = { x: 305, y: 520 };
    vel.current = { x: 0, y: 0 };
    onPlunger.current = true;
    setLaunched(false);
  }, []);

  const newGame = useCallback(() => {
    scoreRef.current = 0; ballsRef.current = 3; overRef.current = false;
    setScore(0); setBalls(3); setOver(false);
    resetBall();
  }, [resetBall]);

  const launch = useCallback(() => {
    if (!onPlunger.current || overRef.current) return;
    onPlunger.current = false;
    vel.current = { x: -1.5 - Math.random() * 0.6, y: -8.4 };
    setLaunched(true);
  }, []);

  // collide ball against a segment with a given surface velocity (flipper push) at the contact.
  function collideSeg(seg: Seg, restitution: number, surfaceV: V): void {
    const c = closest(ball.current, seg.a, seg.b);
    const d = sub(ball.current, c);
    const dist = len(d);
    if (dist < BALL_R && dist > 0.0001) {
      const n = norm(d);
      // push out
      ball.current = add(ball.current, mul(n, BALL_R - dist));
      // reflect relative velocity about the normal
      const rel = sub(vel.current, surfaceV);
      const vn = dot(rel, n);
      if (vn < 0) {
        const reflected = sub(rel, mul(n, (1 + restitution) * vn));
        vel.current = clampV(add(reflected, surfaceV));
      }
    }
  }

  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyL.current = true;
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') keyR.current = true;
      if (e.key === ' ') { e.preventDefault(); launch(); }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyL.current = false;
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') keyR.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [launch]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const step = (): void => {
      // flipper angles ease toward target
      const tgtL = keyL.current ? UP_ANG_L : REST_ANG_L;
      const tgtR = keyR.current ? UP_ANG_R : REST_ANG_R;
      const prevL = angL.current, prevR = angR.current;
      angL.current += (tgtL - angL.current) * 0.4;
      angR.current += (tgtR - angR.current) * 0.4;
      const segL = flipperSeg(LEFT_PIVOT, angL.current);
      const segR = flipperSeg(RIGHT_PIVOT, angR.current);

      if (!overRef.current && !onPlunger.current) {
        for (let s = 0; s < SUBSTEPS; s += 1) {
          vel.current.y += GRAV / SUBSTEPS;
          vel.current = clampV(vel.current);
          ball.current = add(ball.current, mul(vel.current, 1 / SUBSTEPS));

          for (const w of WALLS) collideSeg(w, REST, { x: 0, y: 0 });
          // flipper tip speed → surface velocity (approx) so an active flip launches the ball
          const tipVL = mul(sub(flipperSeg(LEFT_PIVOT, angL.current).b, flipperSeg(LEFT_PIVOT, prevL).b), SUBSTEPS);
          const tipVR = mul(sub(flipperSeg(RIGHT_PIVOT, angR.current).b, flipperSeg(RIGHT_PIVOT, prevR).b), SUBSTEPS);
          collideSeg(segL, 0.55, tipVL);
          collideSeg(segR, 0.55, tipVR);
          for (const b of BUMPERS) {
            const d = sub(ball.current, b.p);
            const dist = len(d);
            if (dist < BALL_R + b.r && dist > 0.0001) {
              const n = norm(d);
              ball.current = add(b.p, mul(n, BALL_R + b.r));
              const vn = dot(vel.current, n);
              if (vn < 0) vel.current = clampV(add(sub(vel.current, mul(n, 2 * vn)), mul(n, 1.4))); // bounce + kick
              scoreRef.current += b.score;
              setScore(scoreRef.current);
            }
          }
        }
        // drain
        if (ball.current.y > H + 20) {
          ballsRef.current -= 1;
          setBalls(ballsRef.current);
          if (ballsRef.current <= 0) { overRef.current = true; setOver(true); } else resetBall();
        }
      } else if (onPlunger.current) {
        ball.current = { x: 305, y: 520 };
      }

      // ---- render ----
      ctx.fillStyle = '#101830'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#4a6'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (const w of WALLS) { ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke(); }
      for (const b of BUMPERS) {
        ctx.beginPath(); ctx.arc(b.p.x, b.p.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = '#e0457b'; ctx.fill(); ctx.strokeStyle = '#ffd1e3'; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 7;
      for (const f of [segL, segR]) { ctx.beginPath(); ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(ball.current.x, ball.current.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = '#e8e8f0'; ctx.fill(); ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.stroke();

      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [resetBall]);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#202830', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 10, color: '#e8e8f0' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontFamily: 'monospace' }}>
        <span>SCORE <b style={{ color: '#ffd54f' }}>{score}</b></span>
        <span>BALLS <b style={{ color: '#7fc97f' }}>{balls}</b></span>
        <button onClick={newGame}>New game</button>
      </div>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} width={W} height={H} style={{ border: '3px solid #5d4037', background: '#101830', display: 'block' }} />
        {!launched && !over && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 40, pointerEvents: 'none' }}>
            <span style={{ background: 'rgba(0,0,0,0.6)', padding: '6px 10px', borderRadius: 4, fontSize: 12 }}>Press <b>Space</b> to launch</span>
          </div>
        )}
        {over && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>GAME OVER</div>
            <div>Score: {score}</div>
            <button onClick={newGame}>Play again</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>←/A · →/L flippers · Space launches · keep it off the drain</div>
    </div>
  );
}
