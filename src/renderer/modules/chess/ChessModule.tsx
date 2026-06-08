/**
 * Chess — a self-contained 2-player (hot-seat) game: no IPC, no storage, no network, no AI. Full
 * legal-move rules: per-piece movement, you may not leave your own king in check, castling, en
 * passant, and pawn promotion (auto-queen). Detects check, checkmate, and stalemate. r=0 is the top
 * (black home rank); white is at the bottom and moves first.
 */
import { useMemo, useState } from 'react';

type Color = 'w' | 'b';
type PT = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
interface Piece { c: Color; t: PT }
type Sq = Piece | null;
type Board = Sq[]; // 64, index = r*8 + c

interface Castle { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean }
interface GameState { board: Board; turn: Color; castle: Castle; ep: number | null }
interface Move { to: number; flag?: 'double' | 'ep' | 'castleK' | 'castleQ' }

const GLYPH: Record<Color, Record<PT, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};
const RC = (i: number): [number, number] => [Math.floor(i / 8), i % 8];
const IDX = (r: number, c: number): number => r * 8 + c;
const ok = (r: number, c: number): boolean => r >= 0 && r < 8 && c >= 0 && c < 8;
const enemy = (a: Color): Color => (a === 'w' ? 'b' : 'w');

function initialBoard(): Board {
  const back: PT[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  const b: Board = Array(64).fill(null);
  for (let c = 0; c < 8; c += 1) {
    b[IDX(0, c)] = { c: 'b', t: back[c] };
    b[IDX(1, c)] = { c: 'b', t: 'p' };
    b[IDX(6, c)] = { c: 'w', t: 'p' };
    b[IDX(7, c)] = { c: 'w', t: back[c] };
  }
  return b;
}

const SLIDE: Record<'r' | 'b' | 'q', number[][]> = {
  r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  q: [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
};
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Is square `idx` attacked by color `by` on `board`? (ignores en passant / castling — not needed.) */
function attacked(board: Board, idx: number, by: Color): boolean {
  const [r, c] = RC(idx);
  // pawns (attack "forward" toward the enemy home rank)
  const pdir = by === 'w' ? 1 : -1; // a white pawn on r+1 attacks upward to r → so it sits at r+1
  for (const dc of [-1, 1]) {
    const rr = r + pdir, cc = c + dc;
    if (ok(rr, cc)) { const p = board[IDX(rr, cc)]; if (p && p.c === by && p.t === 'p') return true; }
  }
  for (const [dr, dc] of KNIGHT) { const rr = r + dr, cc = c + dc; if (ok(rr, cc)) { const p = board[IDX(rr, cc)]; if (p && p.c === by && p.t === 'n') return true; } }
  for (const [dr, dc] of KING) { const rr = r + dr, cc = c + dc; if (ok(rr, cc)) { const p = board[IDX(rr, cc)]; if (p && p.c === by && p.t === 'k') return true; } }
  for (const [dr, dc] of SLIDE.r) { let rr = r + dr, cc = c + dc; while (ok(rr, cc)) { const p = board[IDX(rr, cc)]; if (p) { if (p.c === by && (p.t === 'r' || p.t === 'q')) return true; break; } rr += dr; cc += dc; } }
  for (const [dr, dc] of SLIDE.b) { let rr = r + dr, cc = c + dc; while (ok(rr, cc)) { const p = board[IDX(rr, cc)]; if (p) { if (p.c === by && (p.t === 'b' || p.t === 'q')) return true; break; } rr += dr; cc += dc; } }
  return false;
}

function kingIdx(board: Board, color: Color): number {
  for (let i = 0; i < 64; i += 1) { const p = board[i]; if (p && p.c === color && p.t === 'k') return i; }
  return -1;
}

/** Pseudo-legal moves for the piece at `from` (does not yet filter self-check). */
function pseudo(s: GameState, from: number): Move[] {
  const p = s.board[from];
  if (!p) return [];
  const [r, c] = RC(from);
  const out: Move[] = [];
  const add = (to: number, flag?: Move['flag']): void => { out.push({ to, flag }); };
  const own = (to: number): boolean => { const q = s.board[to]; return !!q && q.c === p.c; };
  if (p.t === 'p') {
    const dir = p.c === 'w' ? -1 : 1;
    const startRow = p.c === 'w' ? 6 : 1;
    const one = IDX(r + dir, c);
    if (ok(r + dir, c) && !s.board[one]) {
      add(one);
      const two = IDX(r + 2 * dir, c);
      if (r === startRow && !s.board[two]) add(two, 'double');
    }
    for (const dc of [-1, 1]) {
      const rr = r + dir, cc = c + dc;
      if (!ok(rr, cc)) continue;
      const t = IDX(rr, cc);
      if (s.board[t] && s.board[t]!.c !== p.c) add(t);
      else if (s.ep === t) add(t, 'ep');
    }
  } else if (p.t === 'n') {
    for (const [dr, dc] of KNIGHT) { const rr = r + dr, cc = c + dc; if (ok(rr, cc) && !own(IDX(rr, cc))) add(IDX(rr, cc)); }
  } else if (p.t === 'k') {
    for (const [dr, dc] of KING) { const rr = r + dr, cc = c + dc; if (ok(rr, cc) && !own(IDX(rr, cc))) add(IDX(rr, cc)); }
    // castling
    const homeRow = p.c === 'w' ? 7 : 0;
    if (r === homeRow && c === 4 && !attacked(s.board, from, enemy(p.c))) {
      const kRight = p.c === 'w' ? s.castle.wK : s.castle.bK;
      const qRight = p.c === 'w' ? s.castle.wQ : s.castle.bQ;
      if (kRight && !s.board[IDX(homeRow, 5)] && !s.board[IDX(homeRow, 6)]
        && !attacked(s.board, IDX(homeRow, 5), enemy(p.c)) && !attacked(s.board, IDX(homeRow, 6), enemy(p.c))
        && s.board[IDX(homeRow, 7)]?.t === 'r') add(IDX(homeRow, 6), 'castleK');
      if (qRight && !s.board[IDX(homeRow, 3)] && !s.board[IDX(homeRow, 2)] && !s.board[IDX(homeRow, 1)]
        && !attacked(s.board, IDX(homeRow, 3), enemy(p.c)) && !attacked(s.board, IDX(homeRow, 2), enemy(p.c))
        && s.board[IDX(homeRow, 0)]?.t === 'r') add(IDX(homeRow, 2), 'castleQ');
    }
  } else {
    for (const [dr, dc] of SLIDE[p.t as 'r' | 'b' | 'q']) {
      let rr = r + dr, cc = c + dc;
      while (ok(rr, cc)) { const t = IDX(rr, cc); if (own(t)) break; add(t); if (s.board[t]) break; rr += dr; cc += dc; }
    }
  }
  return out;
}

/** Apply a move, returning the next state (handles ep capture, castling rook hop, auto-queen, rights). */
function apply(s: GameState, from: number, m: Move): GameState {
  const board = s.board.slice();
  const p = board[from]!;
  const [, fc] = RC(from);
  const [tr, tc] = RC(m.to);
  board[m.to] = p;
  board[from] = null;
  if (m.flag === 'ep') board[IDX(RC(from)[0], tc)] = null; // captured pawn is on the mover's rank
  if (p.t === 'p' && (tr === 0 || tr === 7)) board[m.to] = { c: p.c, t: 'q' }; // auto-queen
  if (m.flag === 'castleK') { board[IDX(tr, 5)] = board[IDX(tr, 7)]; board[IDX(tr, 7)] = null; }
  if (m.flag === 'castleQ') { board[IDX(tr, 3)] = board[IDX(tr, 0)]; board[IDX(tr, 0)] = null; }
  const castle = { ...s.castle };
  if (p.t === 'k') { if (p.c === 'w') { castle.wK = false; castle.wQ = false; } else { castle.bK = false; castle.bQ = false; } }
  if (p.t === 'r') {
    if (from === IDX(7, 0)) castle.wQ = false; if (from === IDX(7, 7)) castle.wK = false;
    if (from === IDX(0, 0)) castle.bQ = false; if (from === IDX(0, 7)) castle.bK = false;
  }
  if (m.to === IDX(7, 0)) castle.wQ = false; if (m.to === IDX(7, 7)) castle.wK = false;
  if (m.to === IDX(0, 0)) castle.bQ = false; if (m.to === IDX(0, 7)) castle.bK = false;
  const ep = (p.t === 'p' && m.flag === 'double') ? IDX((RC(from)[0] + tr) / 2, fc) : null;
  return { board, turn: enemy(s.turn), castle, ep };
}

/** Legal moves: pseudo-legal filtered so the mover's king isn't left in check. */
function legal(s: GameState, from: number): Move[] {
  const p = s.board[from];
  if (!p || p.c !== s.turn) return [];
  return pseudo(s, from).filter((m) => {
    const next = apply(s, from, m);
    return !attacked(next.board, kingIdx(next.board, p.c), enemy(p.c));
  });
}

function allLegal(s: GameState): number {
  let n = 0;
  for (let i = 0; i < 64; i += 1) { const p = s.board[i]; if (p && p.c === s.turn) n += legal(s, i).length; }
  return n;
}

export function ChessModule(): JSX.Element {
  const [state, setState] = useState<GameState>(() => ({ board: initialBoard(), turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null }));
  const [sel, setSel] = useState<number | null>(null);

  const selMoves = useMemo<Move[]>(() => (sel === null ? [] : legal(state, sel)), [sel, state]);
  const targets = useMemo(() => new Set(selMoves.map((m) => m.to)), [selMoves]);
  const inCheck = useMemo(() => attacked(state.board, kingIdx(state.board, state.turn), enemy(state.turn)), [state]);
  const moveCount = useMemo(() => allLegal(state), [state]);
  const over = moveCount === 0;
  const status = over
    ? (inCheck ? `Checkmate — ${state.turn === 'w' ? 'Black' : 'White'} wins` : 'Stalemate — draw')
    : `${state.turn === 'w' ? 'White' : 'Black'} to move${inCheck ? ' — check!' : ''}`;

  function clickSquare(i: number): void {
    if (over) return;
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

  function reset(): void {
    setState({ board: initialBoard(), turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null });
    setSel(null);
  }

  const kingInCheckIdx = inCheck ? kingIdx(state.board, state.turn) : -1;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, background: '#c0c0c0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <strong>{status}</strong>
        <button onClick={reset}>New game</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 52px)', gridTemplateRows: 'repeat(8, 52px)', border: '3px solid #5d4037', userSelect: 'none' }}>
        {state.board.map((p, i) => {
          const [r, c] = RC(i);
          const dark = (r + c) % 2 === 1;
          const isSel = sel === i;
          const isTarget = targets.has(i);
          const bg = isSel ? '#7fc97f' : i === kingInCheckIdx ? '#e57373' : dark ? '#b58863' : '#f0d9b5';
          return (
            <div key={i} onClick={() => clickSquare(i)}
              style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: bg, cursor: over ? 'default' : 'pointer', fontSize: 38, lineHeight: 1 }}>
              {p ? <span style={{ color: p.c === 'w' ? '#fff' : '#000', textShadow: p.c === 'w' ? '0 0 2px #000, 0 0 1px #000' : 'none' }}>{GLYPH[p.c][p.t]}</span> : null}
              {isTarget && <span style={{ position: 'absolute', width: p ? 46 : 16, height: p ? 46 : 16, borderRadius: '50%', background: p ? 'transparent' : 'rgba(0,0,0,0.28)', border: p ? '3px solid rgba(0,128,0,0.7)' : 'none', pointerEvents: 'none' }} />}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>Two players, hot-seat. Click a piece, then a highlighted square. Pawns auto-promote to a queen.</div>
    </div>
  );
}
