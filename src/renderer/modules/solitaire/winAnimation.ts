/**
 * The classic Solitaire win cascade: the foundation cards bounce off the bottom and fall across
 * the screen, painting trails (the canvas is never cleared). Pure canvas + requestAnimationFrame.
 * Returns a stop() to cancel (New Game / unmount). Randomness here is cosmetic launch velocity.
 */

import type { Card } from './engine';
import { SUIT_SYMBOL, RANK_LABEL, isRed } from './engine';

const CARD_W = 64;
const CARD_H = 88;

interface Sprite { x: number; y: number; vx: number; vy: number; card: Card }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function runWinCascade(canvas: HTMLCanvasElement, cards: { card: Card; x: number; y: number }[]): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;
  const floor = H - CARD_H;

  // Launch order: reverse so Kings (drawn last) cascade on top. One sprite enters every few frames.
  const queue: Sprite[] = cards
    .slice()
    .reverse()
    .map(({ card, x, y }) => ({
      card,
      x,
      y,
      vx: (Math.random() * 2 - 1) * 6,
      vy: -Math.random() * 4 - 2
    }));
  const active: Sprite[] = [];
  const gravity = 0.35;
  const restitution = 0.82;
  let frame = 0;
  let raf = 0;
  let stopped = false;

  function drawCard(s: Sprite): void {
    const c = s.card;
    ctx!.fillStyle = '#fff';
    ctx!.strokeStyle = '#444';
    ctx!.lineWidth = 1;
    roundRect(ctx!, s.x, s.y, CARD_W, CARD_H, 6);
    ctx!.fill();
    ctx!.stroke();
    ctx!.fillStyle = isRed(c.suit) ? '#c00000' : '#101010';
    ctx!.font = 'bold 14px "MS Sans Serif", Arial, sans-serif';
    ctx!.fillText(`${RANK_LABEL[c.rank]}${SUIT_SYMBOL[c.suit]}`, s.x + 5, s.y + 18);
    ctx!.font = '26px Arial';
    ctx!.fillText(SUIT_SYMBOL[c.suit], s.x + CARD_W / 2 - 9, s.y + CARD_H / 2 + 9);
  }

  function tick(): void {
    if (stopped) return;
    frame += 1;
    if (frame % 3 === 0 && queue.length) active.push(queue.shift() as Sprite);
    for (const s of active) {
      s.vy += gravity;
      s.x += s.vx;
      s.y += s.vy;
      if (s.y > floor) { s.y = floor; s.vy = -s.vy * restitution; }
      drawCard(s); // no clear → cumulative trails (the signature effect)
    }
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const s = active[i];
      if (s.x < -CARD_W * 2 || s.x > W + CARD_W * 2) active.splice(i, 1);
    }
    if (queue.length === 0 && active.length === 0) return; // done — leave the trails painted
    raf = requestAnimationFrame(tick);
  }

  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
