/**
 * Chess AI opponent — pure search over the rules engine. Three strengths:
 *   easy   → a uniformly random legal move
 *   medium → alpha-beta to depth 2 (sees the opponent's immediate reply; won't hang pieces freely)
 *   hard   → alpha-beta to depth 3 with capture-first move ordering
 * The evaluation is material + light positional terms (centralization, pawn advance, minor-piece
 * development). Randomness is injected (seeded PRNG from the component) so games vary but unit tests
 * are deterministic, and Math.random stays out of the module per house style.
 */
import type { Board, GameState, Move } from './engine';
import { RC, apply, attacked, kingIdx, legal, enemy } from './engine';

export type AiLevel = 'easy' | 'medium' | 'hard';
export type Rng = () => number;

/** mulberry32 — small deterministic PRNG; reseed per new game for variety, stable within a game. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AiMove { from: number; move: Move }

const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 1_000_000;
const NODE_CAP = 250_000; // backstop so a pathological position can't freeze the UI

/** Enumerate every legal move for the side to move. */
export function allMoves(s: GameState): AiMove[] {
  const out: AiMove[] = [];
  for (let i = 0; i < 64; i += 1) {
    const p = s.board[i];
    if (p && p.c === s.turn) for (const move of legal(s, i)) out.push({ from: i, move });
  }
  return out;
}

/** Static evaluation, white-positive (material + centralization + pawn advance + development). */
export function evaluate(board: Board): number {
  let score = 0;
  for (let i = 0; i < 64; i += 1) {
    const p = board[i];
    if (!p) continue;
    const [r, c] = RC(i);
    let v = VAL[p.t];
    const centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
    if (p.t === 'n' || p.t === 'b') {
      v += (7 - centerDist) * 4;
      if (r === (p.c === 'w' ? 7 : 0)) v -= 12; // undeveloped minor on its home rank
    }
    if (p.t === 'p') {
      const adv = p.c === 'w' ? 6 - r : r - 1; // ranks advanced from the pawn's start
      v += adv * 6 + (7 - Math.abs(3.5 - c)) * 2; // advance + slight central preference
    }
    score += (p.c === 'w' ? 1 : -1) * v;
  }
  return score;
}

/** Score from the side-to-move's perspective (negamax convention). */
function scoreToMove(s: GameState): number {
  return (s.turn === 'w' ? 1 : -1) * evaluate(s.board);
}

/** Order captures (and promotions) first to make alpha-beta cutoffs effective. */
function ordered(s: GameState, moves: AiMove[]): AiMove[] {
  return [...moves].sort((a, b) => captureGain(s, b) - captureGain(s, a));
}
function captureGain(s: GameState, m: AiMove): number {
  const victim = s.board[m.move.to];
  const mover = s.board[m.from];
  let g = victim ? VAL[victim.t] : 0;
  if (mover && mover.t === 'p') { const [tr] = RC(m.move.to); if (tr === 0 || tr === 7) g += VAL.q - VAL.p; }
  return g;
}

interface SearchCtx { nodes: number }

function negamax(s: GameState, depth: number, alpha: number, beta: number, ply: number, ctx: SearchCtx): number {
  ctx.nodes += 1;
  const moves = allMoves(s);
  if (moves.length === 0) {
    const inCheck = attacked(s.board, kingIdx(s.board, s.turn), enemy(s.turn));
    return inCheck ? -(MATE - ply) : 0; // checkmate (prefer slower loss / faster mate) or stalemate
  }
  if (depth === 0 || ctx.nodes > NODE_CAP) return scoreToMove(s);
  let best = -Infinity;
  for (const mv of ordered(s, moves)) {
    const v = -negamax(apply(s, mv.from, mv.move), depth - 1, -beta, -alpha, ply + 1, ctx);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

/** Choose a move for the side to move at the given strength. Returns null if no legal move. */
export function chooseMove(s: GameState, level: AiLevel, rng: Rng): AiMove | null {
  const moves = allMoves(s);
  if (moves.length === 0) return null;
  if (level === 'easy') return moves[Math.floor(rng() * moves.length)];

  const depth = level === 'medium' ? 2 : 3;
  const ctx: SearchCtx = { nodes: 0 };
  let best = -Infinity;
  let bestMoves: AiMove[] = [];
  let alpha = -Infinity;
  for (const mv of ordered(s, moves)) {
    const v = -negamax(apply(s, mv.from, mv.move), depth - 1, -Infinity, -alpha, 1, ctx);
    if (v > best) { best = v; bestMoves = [mv]; } else if (v === best) { bestMoves.push(mv); }
    if (best > alpha) alpha = best;
  }
  // Tie-break among equally-best moves with the seeded PRNG for variety.
  return bestMoves[Math.floor(rng() * bestMoves.length)];
}
