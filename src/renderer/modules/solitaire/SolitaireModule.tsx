/**
 * Klondike Solitaire — Win98 green-felt card game. Self-contained renderer module: no IPC, no
 * storage, no network. Drag a card (and the ordered run below it) between columns, build
 * foundations A→K by suit, draw from the stock (1 or 3), double-click a card to send it to a
 * foundation, and win the iconic bouncing-card cascade.
 *
 * Rules live in ./engine (pure + unit-tested). This file owns the board state, drag-drop, and
 * the win animation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deal, canStackTableau, canFoundation, foundationIndex, isWon,
  SUIT_SYMBOL, RANK_LABEL, isRed, type GameState, type Card
} from './engine';
import { runWinCascade } from './winAnimation';

const CARD_H = 88;
const FACE_UP_DY = 24;
const FACE_DOWN_DY = 10;

/** Which pile a drag came from / is dropping onto. */
type Pile =
  | { kind: 'tableau'; col: number }
  | { kind: 'waste' }
  | { kind: 'foundation'; idx: number };

function columnTop(col: Card[]): Card | undefined { return col[col.length - 1]; }

export function SolitaireModule(): JSX.Element {
  const [game, setGame] = useState<GameState>(() => deal());
  const [drawCount, setDrawCount] = useState<1 | 3>(1);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [won, setWon] = useState(false);

  // Drag: the lifted group (rendered in a floating layer) + which ids are hidden in the board.
  const [floating, setFloating] = useState<Card[] | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const dragRef = useRef<{ source: Pile; grabDX: number; grabDY: number } | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Timer ticks while a game is in progress.
  useEffect(() => {
    if (won) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [won]);

  // Win → run the cascade from the foundation positions.
  useEffect(() => {
    if (!won || !canvasRef.current || !boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const sprites: { card: Card; x: number; y: number }[] = [];
    for (let i = 0; i < 4; i += 1) {
      const slot = boardRef.current.querySelector<HTMLElement>(`[data-found="${i}"]`);
      if (!slot) continue;
      const r = slot.getBoundingClientRect();
      for (const card of game.foundations[i]) sprites.push({ card, x: r.left - boardRect.left, y: r.top - boardRect.top });
    }
    const stop = runWinCascade(canvasRef.current, sprites);
    return stop;
  }, [won, game.foundations]);

  const newGame = useCallback(() => {
    setGame(deal());
    setMoves(0); setSeconds(0); setWon(false);
    setFloating(null); setHiddenIds(new Set()); dragRef.current = null;
  }, []);

  /** Apply a validated move of `group` from `source` onto `target`, flipping any newly-exposed
   *  tableau card. Returns the next state (and detects a win). */
  const applyMove = useCallback((group: Card[], source: Pile, target: Pile) => {
    setGame((g) => {
      const next: GameState = {
        tableau: g.tableau.map((c) => c.slice()),
        stock: g.stock.slice(),
        waste: g.waste.slice(),
        foundations: g.foundations.map((c) => c.slice())
      };
      // Remove from source.
      if (source.kind === 'tableau') next.tableau[source.col].splice(next.tableau[source.col].length - group.length);
      else if (source.kind === 'waste') next.waste.pop();
      else next.foundations[source.idx].pop();
      // Add to target.
      if (target.kind === 'tableau') next.tableau[target.col].push(...group);
      else if (target.kind === 'foundation') next.foundations[target.idx].push(...group);
      // Auto-flip the now-top source tableau card.
      if (source.kind === 'tableau') {
        const col = next.tableau[source.col];
        const top = col[col.length - 1];
        if (top && !top.faceUp) top.faceUp = true;
      }
      if (isWon(next.foundations)) setWon(true);
      return next;
    });
    setMoves((m) => m + 1);
  }, []);

  // ---- stock ----
  const onStock = useCallback(() => {
    if (won) return;
    setGame((g) => {
      if (g.stock.length === 0) {
        // Recycle the waste back into the stock, face down, original order.
        const stock = g.waste.slice().reverse().map((c) => ({ ...c, faceUp: false }));
        return { ...g, stock, waste: [] };
      }
      const n = Math.min(drawCount, g.stock.length);
      const drawn = g.stock.slice(g.stock.length - n).reverse().map((c) => ({ ...c, faceUp: true }));
      return { ...g, stock: g.stock.slice(0, g.stock.length - n), waste: [...g.waste, ...drawn] };
    });
    setMoves((m) => m + 1);
  }, [drawCount, won]);

  // ---- double-click → send a top card to a foundation if legal ----
  const autoToFoundation = useCallback((card: Card, source: Pile) => {
    if (won) return;
    const idx = foundationIndex(card.suit);
    if (canFoundation(card, game.foundations[idx])) applyMove([card], source, { kind: 'foundation', idx });
  }, [game.foundations, applyMove, won]);

  // ---- drag ----
  const startDrag = useCallback((e: React.PointerEvent, group: Card[], source: Pile, cardEl: HTMLElement) => {
    if (won || group.length === 0) return;
    e.preventDefault();
    const r = cardEl.getBoundingClientRect();
    dragRef.current = { source, grabDX: e.clientX - r.left, grabDY: e.clientY - r.top };
    setFloating(group);
    setHiddenIds(new Set(group.map((c) => c.id)));

    const move = (ev: PointerEvent): void => {
      const el = layerRef.current;
      const d = dragRef.current;
      if (!el || !d) return;
      el.style.left = `${ev.clientX - d.grabDX}px`;
      el.style.top = `${ev.clientY - d.grabDY}px`;
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      setFloating(null);
      setHiddenIds(new Set());
      if (!d) return;
      // Hit-test the drop target under the pointer (the floating layer is pointer-events:none).
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop]') as HTMLElement | null;
      if (!hit) return;
      const kind = hit.dataset['drop'];
      const head = group[0];
      if (kind === 'tableau') {
        const col = Number(hit.dataset['col']);
        if (canStackTableau(head, columnTop(game.tableau[col]))) {
          if (!(d.source.kind === 'tableau' && d.source.col === col)) applyMove(group, d.source, { kind: 'tableau', col });
        }
      } else if (kind === 'foundation') {
        const fi = Number(hit.dataset['idx']);
        if (group.length === 1 && canFoundation(head, game.foundations[fi])) applyMove(group, d.source, { kind: 'foundation', idx: fi });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // Seed the layer position immediately.
    requestAnimationFrame(() => {
      if (layerRef.current) {
        layerRef.current.style.left = `${e.clientX - (dragRef.current?.grabDX ?? 0)}px`;
        layerRef.current.style.top = `${e.clientY - (dragRef.current?.grabDY ?? 0)}px`;
      }
    });
  }, [won, game.tableau, game.foundations, applyMove]);

  const wasteTop = game.waste[game.waste.length - 1];
  const wasteShown = game.waste.slice(Math.max(0, game.waste.length - 3)); // fan up to 3

  return (
    <div className="ga98-sol" ref={boardRef}>
      <div className="ga98-sol-bar">
        <button onClick={newGame}>New game</button>
        <button onClick={() => setDrawCount((d) => (d === 1 ? 3 : 1))} title="Toggle how many cards the stock draws">Draw {drawCount}</button>
        <span style={{ flex: 1 }} />
        <span>Moves: {moves}</span>
        <span>Time: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
      </div>

      <div className="ga98-sol-top">
        {/* Stock */}
        <div className="ga98-sol-slot" onClick={onStock} title={game.stock.length ? 'Draw' : 'Recycle'}>
          {game.stock.length > 0
            ? <div className="ga98-card ga98-card-back" />
            : <div className="ga98-card ga98-card-empty">↻</div>}
        </div>
        {/* Waste */}
        <div className="ga98-sol-slot">
          {wasteShown.length === 0 && <div className="ga98-card ga98-card-empty" />}
          {wasteShown.map((c, i) => (
            <CardFace
              key={c.id}
              card={c}
              style={{ position: 'absolute', left: i * 14, top: 0 }}
              hidden={hiddenIds.has(c.id)}
              draggable={c.id === wasteTop?.id}
              onPointerDown={(e, el) => { if (c.id === wasteTop?.id) startDrag(e, [c], { kind: 'waste' }, el); }}
              onDoubleClick={() => { if (c.id === wasteTop?.id) autoToFoundation(c, { kind: 'waste' }); }}
            />
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {/* Foundations */}
        {game.foundations.map((pile, i) => {
          const top = pile[pile.length - 1];
          return (
            <div key={i} className="ga98-sol-slot" data-drop="foundation" data-idx={i} data-found={i}>
              {top
                ? <CardFace
                    card={top}
                    hidden={hiddenIds.has(top.id)}
                    draggable
                    onPointerDown={(e, el) => startDrag(e, [top], { kind: 'foundation', idx: i }, el)}
                  />
                : <div className="ga98-card ga98-card-empty">{['♠', '♥', '♦', '♣'][i]}</div>}
            </div>
          );
        })}
      </div>

      {/* Tableau */}
      <div className="ga98-sol-tableau">
        {game.tableau.map((col, c) => (
          <div key={c} className="ga98-sol-col" data-drop="tableau" data-col={c} style={{ minHeight: CARD_H }}>
            {col.length === 0 && <div className="ga98-card ga98-card-empty" />}
            {col.map((card, i) => {
              const top = offsetForRow(col, i);
              const group = card.faceUp ? col.slice(i) : [];
              return (
                <CardFace
                  key={card.id}
                  card={card}
                  style={{ position: 'absolute', top, left: 0 }}
                  hidden={hiddenIds.has(card.id)}
                  draggable={card.faceUp}
                  onPointerDown={(e, el) => { if (card.faceUp) startDrag(e, group, { kind: 'tableau', col: c }, el); }}
                  onDoubleClick={() => { if (card.faceUp && i === col.length - 1) autoToFoundation(card, { kind: 'tableau', col: c }); }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Floating dragged group */}
      {floating && (
        <div ref={layerRef} className="ga98-sol-drag">
          {floating.map((card, i) => (
            <CardFace key={card.id} card={card} style={{ position: 'absolute', top: i * FACE_UP_DY, left: 0 }} />
          ))}
        </div>
      )}

      {won && (
        <>
          <canvas ref={canvasRef} className="ga98-sol-canvas" />
          <div className="ga98-sol-win">
            <div className="window" style={{ width: 260 }}>
              <div className="title-bar"><div className="title-bar-text">You win!</div></div>
              <div className="window-body" style={{ textAlign: 'center' }}>
                <p>Solved in {moves} moves · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</p>
                <button onClick={newGame}>Deal again</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Cumulative vertical offset of the card at row `i` (face-down cards are tighter). */
function offsetForRow(col: Card[], i: number): number {
  let y = 0;
  for (let k = 0; k < i; k += 1) y += col[k].faceUp ? FACE_UP_DY : FACE_DOWN_DY;
  return y;
}

interface CardFaceProps {
  card: Card;
  style?: React.CSSProperties;
  hidden?: boolean;
  draggable?: boolean;
  onPointerDown?: (e: React.PointerEvent, el: HTMLElement) => void;
  onDoubleClick?: () => void;
}

function CardFace({ card, style, hidden, draggable, onPointerDown, onDoubleClick }: CardFaceProps): JSX.Element {
  if (!card.faceUp) {
    return <div className="ga98-card ga98-card-back" style={{ ...style, visibility: hidden ? 'hidden' : undefined }} />;
  }
  const red = isRed(card.suit);
  return (
    <div
      className="ga98-card ga98-card-face"
      data-red={red}
      style={{ ...style, visibility: hidden ? 'hidden' : undefined, cursor: draggable ? 'grab' : 'default' }}
      onPointerDown={(e) => onPointerDown?.(e, e.currentTarget)}
      onDoubleClick={onDoubleClick}
    >
      <span className="ga98-card-corner">{RANK_LABEL[card.rank]}{SUIT_SYMBOL[card.suit]}</span>
      <span className="ga98-card-pip">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
