/**
 * Klondike Solitaire — pure game logic (no React, no DOM). Kept separate so the rules are
 * unit-testable with a deterministic RNG. The shuffle takes an injectable rng (defaults to
 * Math.random in the app; tests pass a seeded one). A card game's shuffle is the legitimate
 * home for randomness — it is not a correctness-critical/deterministic path.
 */

export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card { suit: Suit; rank: number; faceUp: boolean; id: string }

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANK_LABEL: Record<number, string> = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K'
};

export function isRed(s: Suit): boolean { return s === 'H' || s === 'D'; }

export interface GameState {
  tableau: Card[][];     // 7 columns, top card last
  stock: Card[];         // face-down draw pile (top last)
  waste: Card[];         // face-up discard (top last)
  foundations: Card[][]; // 4 piles indexed by SUITS order, built A→K
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank += 1) {
    deck.push({ suit, rank, faceUp: false, id: `${suit}${rank}` });
  }
  return deck;
}

/** Fisher-Yates with an injectable RNG (defaults to Math.random). Returns a new array. */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deal a fresh Klondike game: 7 columns (1..7 cards, top face up), rest to stock. */
export function deal(rng: () => number = Math.random): GameState {
  const deck = shuffle(makeDeck(), rng);
  const tableau: Card[][] = [[], [], [], [], [], [], []];
  let idx = 0;
  for (let col = 0; col < 7; col += 1) {
    for (let row = 0; row <= col; row += 1) {
      const card = { ...deck[idx], faceUp: row === col };
      tableau[col].push(card);
      idx += 1;
    }
  }
  const stock = deck.slice(idx).map((c) => ({ ...c, faceUp: false }));
  return { tableau, stock, waste: [], foundations: [[], [], [], []] };
}

export function foundationIndex(suit: Suit): number { return SUITS.indexOf(suit); }

/** Can `moving` be placed on a tableau column whose current top card is `onto`
 *  (undefined ⇒ empty column, which accepts only a King)? */
export function canStackTableau(moving: Card, onto: Card | undefined): boolean {
  if (!onto) return moving.rank === 13;
  return onto.faceUp && isRed(onto.suit) !== isRed(moving.suit) && onto.rank === moving.rank + 1;
}

/** Can `moving` go onto the given foundation pile (must be its own suit, next rank up)? */
export function canFoundation(moving: Card, pile: Card[]): boolean {
  const top = pile[pile.length - 1];
  if (!top) return moving.rank === 1;
  return top.suit === moving.suit && moving.rank === top.rank + 1;
}

export function isWon(foundations: Card[][]): boolean {
  return foundations.length === 4 && foundations.every((f) => f.length === 13);
}
