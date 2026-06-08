/**
 * Pinball — a self-contained canvas table (no IPC, storage, or network) in the spirit of the Win98
 * "3D Space Cadet" table. Raked top-down physics: substepped integration, closest-point collisions,
 * power plunger, fast tip-velocity flippers, energetic slingshots, pop bumpers, a drop-target bank,
 * rollover lanes that advance your rank, a ramp combo, a wormhole lock that arms MULTIBALL, end-of-
 * ball bonus, and 3 balls. SFX are synthesized with WebAudio (no bundled assets). Physics + table
 * geometry are pure modules (./physics, ./table) with unit tests; feel still needs an interactive pass.
 *
 * Controls: ←/A and →/L flip; hold SPACE in the lane to charge the plunger, release to launch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { V } from './physics';
import { add, clampLen, collideCircle, collideSegment, isDrained, len, mul, norm, plungerLaunch, sub } from './physics';
import {
  W, H, BALL_R, BOTTOM_DRAIN, LANE_X, LANE_BALL_Y, WALLS, BUMPERS, SLINGS, DROP_TARGETS, DROP_BANK_BONUS,
  LANES, RAMP, WORMHOLE, RANKS, LEFT_PIVOT, RIGHT_PIVOT, REST_ANG_L, UP_ANG_L, REST_ANG_R, UP_ANG_R,
  flipperSeg, makePlayfield, type PlayfieldState
} from './table';

const GRAV = 0.16;
const REST = 0.7;
const MAX_V = 17;
const SUBSTEPS = 4;

interface Ball { p: V; v: V; lane: boolean }

export function PinballModule(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [rank, setRank] = useState(0);
  const [over, setOver] = useState(false);
  const [multiball, setMultiball] = useState(false);
  const [inLane, setInLane] = useState(true);

  // Mutable game state (refs — keep the 60fps loop out of React re-renders).
  const balls = useRef<Ball[]>([{ p: { x: LANE_X, y: LANE_BALL_Y }, v: { x: 0, y: 0 }, lane: true }]);
  const pf = useRef<PlayfieldState>(makePlayfield());
  const angL = useRef(REST_ANG_L);
  const angR = useRef(REST_ANG_R);
  const keyL = useRef(false);
  const keyR = useRef(false);
  const charging = useRef(false);
  const charge = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const overRef = useRef(false);
  const multiRef = useRef(false);
  const raf = useRef<number | null>(null);
  const stars = useRef<{ x: number; y: number; s: number }[]>([]);
  if (stars.current.length === 0) {
    for (let i = 0; i < 90; i += 1) stars.current.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.6 + 0.3 });
  }

  // --- synthesized sound effects (no bundled assets) ---
  const audio = useRef<AudioContext | null>(null);
  const sfx = useCallback((freq: number, dur: number, type: OscillatorType = 'square', gain = 0.05) => {
    try {
      if (!audio.current) audio.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ac = audio.current;
      const o = ac.createOscillator(); const g = ac.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = gain;
      o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch { /* audio not available — silent */ }
  }, []);

  const addScore = useCallback((n: number) => { scoreRef.current += n; setScore(scoreRef.current); }, []);

  const spawnLaneBall = useCallback(() => {
    balls.current.push({ p: { x: LANE_X, y: LANE_BALL_Y }, v: { x: 0, y: 0 }, lane: true });
    setInLane(true);
  }, []);

  const newGame = useCallback(() => {
    scoreRef.current = 0; livesRef.current = 3; overRef.current = false; multiRef.current = false;
    charge.current = 0; charging.current = false;
    pf.current = makePlayfield();
    balls.current = [{ p: { x: LANE_X, y: LANE_BALL_Y }, v: { x: 0, y: 0 }, lane: true }];
    setScore(0); setLives(3); setRank(0); setOver(false); setMultiball(false); setInLane(true);
  }, []);

  // Keyboard: flippers + plunger charge/release.
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyL.current = true;
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') keyR.current = true;
      if (e.key === ' ') { e.preventDefault(); if (balls.current.some((b) => b.lane)) charging.current = true; }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keyL.current = false;
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') keyR.current = false;
      if (e.key === ' ') {
        const b = balls.current.find((x) => x.lane);
        if (b && charging.current) {
          b.v = plungerLaunch(charge.current, Math.random() * 0.6);
          b.lane = false; setInLane(false);
          sfx(180, 0.18, 'sawtooth', 0.08);
        }
        charging.current = false; charge.current = 0;
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [sfx]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const lightLane = (i: number): void => {
      if (pf.current.lanesLit[i]) return;
      pf.current.lanesLit[i] = true;
      addScore(LANES[i].score); sfx(660, 0.06, 'triangle');
      if (pf.current.lanesLit.every(Boolean)) {
        pf.current.lanesLit = LANES.map(() => false);
        pf.current.rank = Math.min(pf.current.rank + 1, RANKS.length - 1);
        setRank(pf.current.rank); addScore(10000); sfx(880, 0.25, 'sawtooth', 0.07);
      }
    };

    const step = (): void => {
      // flipper angles — fast snap toward target
      const tgtL = keyL.current ? UP_ANG_L : REST_ANG_L;
      const tgtR = keyR.current ? UP_ANG_R : REST_ANG_R;
      const prevL = angL.current, prevR = angR.current;
      angL.current += (tgtL - angL.current) * 0.85;
      angR.current += (tgtR - angR.current) * 0.85;
      const segL = flipperSeg(LEFT_PIVOT, angL.current);
      const segR = flipperSeg(RIGHT_PIVOT, angR.current);
      const tipVL = mul(sub(flipperSeg(LEFT_PIVOT, angL.current).b, flipperSeg(LEFT_PIVOT, prevL).b), SUBSTEPS);
      const tipVR = mul(sub(flipperSeg(RIGHT_PIVOT, angR.current).b, flipperSeg(RIGHT_PIVOT, prevR).b), SUBSTEPS);

      if (charging.current && charge.current < 1) charge.current = Math.min(1, charge.current + 0.025);

      if (!overRef.current) {
        for (const ball of balls.current) {
          if (ball.lane) { ball.p = { x: LANE_X, y: LANE_BALL_Y }; continue; }
          for (let s = 0; s < SUBSTEPS; s += 1) {
            ball.v.y += GRAV / SUBSTEPS;
            ball.v = clampLen(ball.v, MAX_V);
            ball.p = add(ball.p, mul(ball.v, 1 / SUBSTEPS));

            for (const w of WALLS) { const h = collideSegment(ball.p, ball.v, w, BALL_R, REST); if (h) { ball.p = h.pos; ball.v = h.vel; } }
            { const h = collideSegment(ball.p, ball.v, segL, BALL_R, 0.5, tipVL); if (h) { ball.p = h.pos; ball.v = clampLen(h.vel, MAX_V); } }
            { const h = collideSegment(ball.p, ball.v, segR, BALL_R, 0.5, tipVR); if (h) { ball.p = h.pos; ball.v = clampLen(h.vel, MAX_V); } }

            for (const sl of SLINGS) {
              const h = collideSegment(ball.p, ball.v, sl, BALL_R, 0.3);
              if (h) {
                ball.p = h.pos;
                const n = norm(sub(ball.p, { x: (sl.a.x + sl.b.x) / 2, y: (sl.a.y + sl.b.y) / 2 }));
                ball.v = clampLen(add(h.vel, mul(n, sl.kick)), MAX_V);
                addScore(sl.score); sfx(300, 0.05, 'square');
              }
            }
            DROP_TARGETS.forEach((dt, i) => {
              if (!pf.current.dropUp[i]) return;
              const h = collideSegment(ball.p, ball.v, dt.seg, BALL_R, 0.6);
              if (h) {
                ball.p = h.pos; ball.v = h.vel; pf.current.dropUp[i] = false;
                addScore(dt.score); sfx(420, 0.05, 'square');
                if (pf.current.dropUp.every((u) => !u)) { addScore(DROP_BANK_BONUS); pf.current.dropUp = DROP_TARGETS.map(() => true); sfx(740, 0.2, 'sawtooth', 0.07); }
              }
            });
            for (const bm of BUMPERS) {
              const h = collideCircle(ball.p, ball.v, bm.p, bm.r, BALL_R, REST, bm.kick);
              if (h) { ball.p = h.pos; ball.v = clampLen(h.vel, MAX_V); addScore(bm.score); sfx(520, 0.04, 'square'); }
            }
            LANES.forEach((ln, i) => { if (len(sub(ball.p, ln.p)) < ln.r + BALL_R) lightLane(i); });
            if (len(sub(ball.p, RAMP.p)) < RAMP.r + BALL_R && ball.v.y > -2) {
              ball.v = { x: -3.2, y: -12 }; addScore(RAMP.score); sfx(600, 0.08, 'triangle');
            }
          }
        }

        // wormhole lock / multiball (only when a single ball is in play)
        if (!multiRef.current && balls.current.length === 1) {
          const b = balls.current[0];
          if (!b.lane && len(sub(b.p, WORMHOLE.p)) < WORMHOLE.r + BALL_R) {
            pf.current.locked += 1; balls.current = []; sfx(240, 0.18, 'sine', 0.07);
            if (pf.current.locked >= 2) {
              pf.current.locked = 0; multiRef.current = true; setMultiball(true);
              for (let k = 0; k < 3; k += 1) balls.current.push({ p: { x: WORMHOLE.p.x + 20 + k * 6, y: WORMHOLE.p.y + 20 }, v: { x: 1 - k, y: 2 + k }, lane: false });
              addScore(20000); sfx(990, 0.3, 'sawtooth', 0.08);
            } else { spawnLaneBall(); addScore(5000); }
          }
        }

        // drains
        const survivors = balls.current.filter((b) => b.lane || !isDrained(b.p, BOTTOM_DRAIN));
        if (survivors.length !== balls.current.length) sfx(120, 0.25, 'sawtooth', 0.06);
        balls.current = survivors;
        if (balls.current.length === 0) {
          if (multiRef.current) { multiRef.current = false; setMultiball(false); }
          livesRef.current -= 1; setLives(livesRef.current);
          if (livesRef.current <= 0) { overRef.current = true; setOver(true); }
          else spawnLaneBall();
        }
      }

      // ---- render ----
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0a0e22'); g.addColorStop(1, '#161a3a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      for (const st of stars.current) { ctx.globalAlpha = 0.3 + st.s * 0.4; ctx.fillRect(st.x, st.y, st.s, st.s); }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = '#3df2ff'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.shadowColor = '#3df2ff'; ctx.shadowBlur = 6;
      for (const w of WALLS) { ctx.beginPath(); ctx.moveTo(w.a.x, w.a.y); ctx.lineTo(w.b.x, w.b.y); ctx.stroke(); }
      ctx.shadowBlur = 0;

      // lanes
      LANES.forEach((ln, i) => {
        ctx.beginPath(); ctx.arc(ln.p.x, ln.p.y, ln.r, 0, Math.PI * 2);
        ctx.fillStyle = pf.current.lanesLit[i] ? '#ffe14d' : '#2a2f55'; ctx.fill();
        ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.stroke();
      });
      // ramp + wormhole
      ctx.beginPath(); ctx.arc(RAMP.p.x, RAMP.p.y, RAMP.r, 0, Math.PI * 2); ctx.fillStyle = '#16406b'; ctx.fill(); ctx.strokeStyle = '#5ad1ff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#5ad1ff'; ctx.font = '13px monospace'; ctx.textAlign = 'center'; ctx.fillText('▲', RAMP.p.x, RAMP.p.y + 4);
      ctx.beginPath(); ctx.arc(WORMHOLE.p.x, WORMHOLE.p.y, WORMHOLE.r, 0, Math.PI * 2); ctx.fillStyle = '#1a0a2e'; ctx.fill(); ctx.strokeStyle = '#c06bff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#c06bff'; ctx.fillText('◉', WORMHOLE.p.x, WORMHOLE.p.y + 4);
      ctx.textAlign = 'start';

      // drop targets
      DROP_TARGETS.forEach((dt, i) => { if (!pf.current.dropUp[i]) return; ctx.strokeStyle = '#9dff6b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(dt.seg.a.x, dt.seg.a.y); ctx.lineTo(dt.seg.b.x, dt.seg.b.y); ctx.stroke(); });
      // slingshots
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 5; ctx.shadowColor = '#ff8a3d'; ctx.shadowBlur = 5;
      for (const sl of SLINGS) { ctx.beginPath(); ctx.moveTo(sl.a.x, sl.a.y); ctx.lineTo(sl.b.x, sl.b.y); ctx.stroke(); }
      ctx.shadowBlur = 0;
      // bumpers
      for (const bm of BUMPERS) {
        ctx.beginPath(); ctx.arc(bm.p.x, bm.p.y, bm.r, 0, Math.PI * 2);
        ctx.fillStyle = '#e0457b'; ctx.fill(); ctx.strokeStyle = '#ffd1e3'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(bm.p.x, bm.p.y, bm.r * 0.5, 0, Math.PI * 2); ctx.fillStyle = '#ffd1e3'; ctx.fill();
      }
      // flippers
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.shadowColor = '#ffd54f'; ctx.shadowBlur = 4;
      for (const f of [segL, segR]) { ctx.beginPath(); ctx.moveTo(f.a.x, f.a.y); ctx.lineTo(f.b.x, f.b.y); ctx.stroke(); }
      ctx.shadowBlur = 0;
      // balls
      for (const b of balls.current) {
        const rg = ctx.createRadialGradient(b.p.x - 2, b.p.y - 2, 1, b.p.x, b.p.y, BALL_R);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(1, '#9aa0b5');
        ctx.beginPath(); ctx.arc(b.p.x, b.p.y, BALL_R, 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
        ctx.strokeStyle = '#5a5f72'; ctx.lineWidth = 1; ctx.stroke();
      }
      // plunger power meter (in the lane)
      if (charging.current) {
        ctx.fillStyle = '#222'; ctx.fillRect(LANE_X - 6, LANE_BALL_Y + 16, 12, 56);
        ctx.fillStyle = '#9dff6b'; const ph = 56 * charge.current; ctx.fillRect(LANE_X - 6, LANE_BALL_Y + 16 + (56 - ph), 12, ph);
      }

      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [addScore, sfx, spawnLaneBall]);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#0a0c1c', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 10, color: '#e8e8f0' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontFamily: 'monospace', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span>SCORE <b style={{ color: '#ffd54f' }}>{score.toLocaleString()}</b></span>
        <span>BALL <b style={{ color: '#7fc97f' }}>{Math.max(1, 4 - lives)}/3</b></span>
        <span>RANK <b style={{ color: '#5ad1ff' }}>{RANKS[rank]}</b></span>
        {multiball && <span style={{ color: '#ff6bd0', fontWeight: 'bold' }}>★ MULTIBALL</span>}
        <button onClick={newGame}>New game</button>
      </div>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvasRef} width={W} height={H} style={{ border: '3px solid #5d4037', background: '#0a0e22', display: 'block' }} />
        {inLane && !over && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 50, pointerEvents: 'none' }}>
            <span style={{ background: 'rgba(0,0,0,0.6)', padding: '6px 10px', borderRadius: 4, fontSize: 12 }}>Hold <b>Space</b> to charge the plunger, release to launch</span>
          </div>
        )}
        {over && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(0,0,0,0.65)' }}>
            <div style={{ fontSize: 24, fontWeight: 'bold' }}>GAME OVER</div>
            <div>Score: {score.toLocaleString()}</div>
            <div>Rank reached: {RANKS[rank]}</div>
            <button onClick={newGame}>Play again</button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75, textAlign: 'center', maxWidth: W }}>
        ←/A · →/L flippers · hold Space to launch · light the top lanes to rank up · drop the targets · find the ◉ wormhole twice for MULTIBALL
      </div>
    </div>
  );
}
