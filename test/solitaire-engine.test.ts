import { describe, it, expect } from 'vitest';
import {
  makeDeck, shuffle, deal, canStackTableau, canFoundation, isWon, type Card, type Suit
} from '../src/renderer/modules/solitaire/engine';

function card(suit: Suit, rank: number, faceUp = true): Card { return { suit, rank, faceUp, id: `${suit}${rank}` }; }

// Deterministic RNG for reproducible deals.
function seeded(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

describe('solitaire engine', () => {
  it('makes a 52-card deck of unique cards', () => {
    const d = makeDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map((c) => c.id)).size).toBe(52);
  });

  it('deals a valid Klondike layout', () => {
    const g = deal(seeded(42));
    expect(g.tableau).toHaveLength(7);
    g.tableau.forEach((col, i) => {
      expect(col).toHaveLength(i + 1);
      expect(col[col.length - 1].faceUp).toBe(true);          // top face up
      col.slice(0, -1).forEach((c) => expect(c.faceUp).toBe(false)); // rest face down
    });
    expect(g.stock).toHaveLength(24);
    expect(g.waste).toHaveLength(0);
    expect(g.foundations.flat()).toHaveLength(0);
    // All 52 cards accounted for, none duplicated.
    const all = [...g.tableau.flat(), ...g.stock];
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it('shuffle is deterministic for a given rng', () => {
    const a = shuffle(makeDeck(), seeded(7)).map((c) => c.id);
    const b = shuffle(makeDeck(), seeded(7)).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('tableau stacking: King onto empty, alternating-color descending only', () => {
    expect(canStackTableau(card('S', 13), undefined)).toBe(true);   // King on empty
    expect(canStackTableau(card('S', 5), undefined)).toBe(false);   // non-King on empty
    expect(canStackTableau(card('H', 6), card('S', 7))).toBe(true); // red 6 on black 7
    expect(canStackTableau(card('C', 6), card('S', 7))).toBe(false);// black on black
    expect(canStackTableau(card('H', 6), card('S', 8))).toBe(false);// wrong rank
    expect(canStackTableau(card('H', 6), card('S', 7, false))).toBe(false); // onto face-down
  });

  it('foundation: Ace onto empty, same-suit ascending only', () => {
    expect(canFoundation(card('D', 1), [])).toBe(true);                 // Ace
    expect(canFoundation(card('D', 5), [])).toBe(false);                // non-Ace on empty
    expect(canFoundation(card('D', 2), [card('D', 1)])).toBe(true);     // next up, same suit
    expect(canFoundation(card('S', 2), [card('D', 1)])).toBe(false);    // wrong suit
    expect(canFoundation(card('D', 3), [card('D', 1)])).toBe(false);    // gap
  });

  it('isWon only when all four foundations are full', () => {
    const full = (s: Suit): Card[] => Array.from({ length: 13 }, (_, i) => card(s, i + 1));
    expect(isWon([full('S'), full('H'), full('D'), full('C')])).toBe(true);
    expect(isWon([full('S'), full('H'), full('D'), full('C').slice(0, 12)])).toBe(false);
    expect(isWon([[], [], [], []])).toBe(false);
  });
});
