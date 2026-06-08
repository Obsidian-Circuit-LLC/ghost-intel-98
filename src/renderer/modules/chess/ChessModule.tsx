/**
 * Chess — hot-seat 2-player OR single-player vs the computer (Easy / Medium / Hard). No IPC, no
 * storage, no network. Full legal-move rules live in ./engine; the computer opponent lives in ./ai.
 * r=0 is the top (black home rank); white is at the bottom and moves first. When you play Black vs
 * the computer the board is flipped so your pieces are at the bottom.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiLevel } from './ai';
import { chooseMove, makeRng } from './ai';
import type { Color, GameState, Move } from './engine';
import {
  GLYPH, RC, apply, attacked, kingIdx, legal, allLegal, enemy, newGameState
} from './engine';

type Mode = '2p' | 'cpu';

export function ChessModule(): JSX.Element {
  const [state, setState] = useState<GameState>(() => newGameState());
  const [sel, setSel] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('2p');
  const [humanColor, setHumanColor] = useState<Color>('w');
  const [level, setLevel] = useState<AiLevel>('medium');
  const [thinking, setThinking] = useState(false);

  // Per-game seeded RNG (variety across games, deterministic within one). Game UI → non-critical.
  const seedRef = useRef<number>(Date.now() & 0xffffffff);
  const rngRef = useRef(makeRng(seedRef.current));

  const cpuColor = enemy(humanColor);
  const cpuMode = mode === 'cpu';
  const flip = cpuMode && humanColor === 'b';

  const selMoves = useMemo<Move[]>(() => (sel === null ? [] : legal(state, sel)), [sel, state]);
  const targets = useMemo(() => new Set(selMoves.map((m) => m.to)), [selMoves]);
  const inCheck = useMemo(() => attacked(state.board, kingIdx(state.board, state.turn), enemy(state.turn)), [state]);
  const moveCount = useMemo(() => allLegal(state), [state]);
  const over = moveCount === 0;
  const cpuToMove = cpuMode && !over && state.turn === cpuColor;

  const status = over
    ? (inCheck ? `Checkmate — ${state.turn === 'w' ? 'Black' : 'White'} wins` : 'Stalemate — draw')
    : thinking || cpuToMove
      ? 'Computer thinking…'
      : `${state.turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' — check!' : ''}`;

  // Computer opponent: when it's the CPU's turn, pick + apply a move after a short beat.
  useEffect(() => {
    if (!cpuToMove) return;
    let cancelled = false;
    setThinking(true);
    const id = setTimeout(() => {
      if (cancelled) return;
      const choice = chooseMove(state, level, rngRef.current);
      if (!cancelled && choice) setState((cur) => (cur === state ? apply(state, choice.from, choice.move) : cur));
      setThinking(false);
    }, 350);
    return () => { cancelled = true; clearTimeout(id); setThinking(false); };
  }, [cpuToMove, state, level]);

  function clickSquare(i: number): void {
    if (over || thinking || cpuToMove) return; // not the human's turn
    const p = state.board[i];
    if (sel !== null && targets.has(i)) {
      const m = selMoves.find((x) => x.to === i)!;
      setState(apply(state, sel, m));
      setSel(null);
      return;
    }
    if (p && p.c === state.turn) { setSel(i); return; }
    setSel(null);
  }

  function newGame(): void {
    seedRef.current = (seedRef.current + 0x9e3779b1) & 0xffffffff;
    rngRef.current = makeRng(seedRef.current);
    setState(newGameState());
    setSel(null);
    setThinking(false);
  }

  const kingInCheckIdx = inCheck ? kingIdx(state.board, state.turn) : -1;
  // Board indices in display (top-to-bottom) order; flipped when the human plays Black.
  const order = flip ? Array.from({ length: 64 }, (_, d) => 63 - d) : Array.from({ length: 64 }, (_, d) => d);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, background: '#c0c0c0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <label style={{ fontSize: 12 }}>Mode:&nbsp;
          <select className="ga98-text" value={mode} onChange={(e) => { setMode(e.target.value as Mode); newGame(); }}>
            <option value="2p">2 Player</option>
            <option value="cpu">vs Computer</option>
          </select>
        </label>
        {cpuMode && (
          <>
            <label style={{ fontSize: 12 }}>You play:&nbsp;
              <select className="ga98-text" value={humanColor} onChange={(e) => { setHumanColor(e.target.value as Color); newGame(); }}>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>Level:&nbsp;
              <select className="ga98-text" value={level} onChange={(e) => setLevel(e.target.value as AiLevel)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <strong>{status}</strong>
        <button onClick={newGame}>New game</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 52px)', gridTemplateRows: 'repeat(8, 52px)', border: '3px solid #5d4037', userSelect: 'none' }}>
        {order.map((i) => {
          const p = state.board[i];
          const [r, c] = RC(i);
          const dark = (r + c) % 2 === 1;
          const isSel = sel === i;
          const isTarget = targets.has(i);
          const bg = isSel ? '#7fc97f' : i === kingInCheckIdx ? '#e57373' : dark ? '#b58863' : '#f0d9b5';
          return (
            <div key={i} onClick={() => clickSquare(i)}
              style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: bg, cursor: over || thinking || cpuToMove ? 'default' : 'pointer', fontSize: 38, lineHeight: 1 }}>
              {p ? <span style={{ color: p.c === 'w' ? '#fff' : '#000', textShadow: p.c === 'w' ? '0 0 2px #000, 0 0 1px #000' : 'none' }}>{GLYPH[p.c][p.t]}</span> : null}
              {isTarget && <span style={{ position: 'absolute', width: p ? 46 : 16, height: p ? 46 : 16, borderRadius: '50%', background: p ? 'transparent' : 'rgba(0,0,0,0.28)', border: p ? '3px solid rgba(0,128,0,0.7)' : 'none', pointerEvents: 'none' }} />}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        {cpuMode
          ? `Playing ${humanColor === 'w' ? 'White' : 'Black'} vs the computer (${level}). Click a piece, then a highlighted square.`
          : 'Two players, hot-seat. Click a piece, then a highlighted square. Pawns auto-promote to a queen.'}
      </div>
    </div>
  );
}
