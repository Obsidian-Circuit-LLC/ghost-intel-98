/**
 * Chess rules engine — pure, UI-free, importable + testable. Full legal-move rules: per-piece
 * movement, you may not leave your own king in check, castling, en passant, pawn promotion
 * (auto-queen). Detects check / checkmate / stalemate via allLegal. r=0 is the top (black home
 * rank); white is at the bottom and moves first. Extracted from ChessModule so the AI and tests
 * can share it.
 */

export type Color = 'w' | 'b';
export type PT = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece { c: Color; t: PT }
export type Sq = Piece | null;
export type Board = Sq[]; // 64, index = r*8 + c

export interface Castle { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean }
export interface GameState { board: Board; turn: Color; castle: Castle; ep: number | null }
export interface Move { to: number; flag?: 'double' | 'ep' | 'castleK' | 'castleQ' }

export const GLYPH: Record<Color, Record<PT, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};
export const RC = (i: number): [number, number] => [Math.floor(i / 8), i % 8];
export const IDX = (r: number, c: number): number => r * 8 + c;
export const ok = (r: number, c: number): boolean => r >= 0 && r < 8 && c >= 0 && c < 8;
export const enemy = (a: Color): Color => (a === 'w' ? 'b' : 'w');

export function initialBoard(): Board {
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

export function newGameState(): GameState {
  return { board: initialBoard(), turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: null };
}

const SLIDE: Record<'r' | 'b' | 'q', number[][]> = {
  r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  q: [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
};
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/** Is square `idx` attacked by color `by` on `board`? (ignores en passant / castling — not needed.) */
export function attacked(board: Board, idx: number, by: Color): boolean {
  const [r, c] = RC(idx);
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

export function kingIdx(board: Board, color: Color): number {
  for (let i = 0; i < 64; i += 1) { const p = board[i]; if (p && p.c === color && p.t === 'k') return i; }
  return -1;
}

/** Pseudo-legal moves for the piece at `from` (does not yet filter self-check). */
export function pseudo(s: GameState, from: number): Move[] {
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
export function apply(s: GameState, from: number, m: Move): GameState {
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
export function legal(s: GameState, from: number): Move[] {
  const p = s.board[from];
  if (!p || p.c !== s.turn) return [];
  return pseudo(s, from).filter((m) => {
    const next = apply(s, from, m);
    return !attacked(next.board, kingIdx(next.board, p.c), enemy(p.c));
  });
}

export function allLegal(s: GameState): number {
  let n = 0;
  for (let i = 0; i < 64; i += 1) { const p = s.board[i]; if (p && p.c === s.turn) n += legal(s, i).length; }
  return n;
}
