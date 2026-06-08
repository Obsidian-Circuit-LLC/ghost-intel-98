import { describe, it, expect } from 'vitest';
import {
  newGameState, initialBoard, apply, allLegal, attacked, kingIdx, enemy, IDX, type GameState, type Board
} from '../src/renderer/modules/chess/engine';
import { allMoves, chooseMove, evaluate, makeRng } from '../src/renderer/modules/chess/ai';

const empty = (): Board => Array(64).fill(null);
const noCastle = { wK: false, wQ: false, bK: false, bQ: false };
const rng = makeRng(12345);

describe('chess engine + AI', () => {
  it('has 20 legal moves from the initial position', () => {
    expect(allMoves(newGameState())).toHaveLength(20);
  });

  it('evaluate is 0 for the symmetric starting position', () => {
    expect(evaluate(initialBoard())).toBe(0);
  });

  it('never returns an illegal move (10-ply self-play, hard vs hard)', () => {
    let s = newGameState();
    for (let ply = 0; ply < 10; ply += 1) {
      const moves = allMoves(s);
      if (moves.length === 0) break;
      const choice = chooseMove(s, 'hard', rng)!;
      expect(moves.some((m) => m.from === choice.from && m.move.to === choice.move.to)).toBe(true);
      s = apply(s, choice.from, choice.move);
    }
  });

  it('hard finds a mate in 1 (back-rank rook mate)', () => {
    const b = empty();
    b[7] = { c: 'b', t: 'k' };      // black king h8
    b[13] = { c: 'b', t: 'p' };     // f7
    b[14] = { c: 'b', t: 'p' };     // g7
    b[15] = { c: 'b', t: 'p' };     // h7 (king is boxed in)
    b[60] = { c: 'w', t: 'k' };     // white king e1
    b[56] = { c: 'w', t: 'r' };     // white rook a1
    const s: GameState = { board: b, turn: 'w', castle: noCastle, ep: null };
    const choice = chooseMove(s, 'hard', rng)!;
    const next = apply(s, choice.from, choice.move);
    expect(allLegal(next)).toBe(0); // black has no reply…
    expect(attacked(next.board, kingIdx(next.board, 'b'), enemy('b'))).toBe(true); // …and is in check ⇒ mate
  });

  it('medium captures a hanging queen', () => {
    const b = empty();
    b[60] = { c: 'w', t: 'k' };           // white king e1
    b[4] = { c: 'b', t: 'k' };            // black king e8
    b[56] = { c: 'w', t: 'r' };           // white rook a1
    b[IDX(3, 0)] = { c: 'b', t: 'q' };    // undefended black queen a5
    const s: GameState = { board: b, turn: 'w', castle: noCastle, ep: null };
    const choice = chooseMove(s, 'medium', rng)!;
    expect(choice.move.to).toBe(IDX(3, 0)); // grabs the free queen
  });

  it('easy still returns a legal move', () => {
    const s = newGameState();
    const choice = chooseMove(s, 'easy', rng)!;
    expect(allMoves(s).some((m) => m.from === choice.from && m.move.to === choice.move.to)).toBe(true);
  });
});
