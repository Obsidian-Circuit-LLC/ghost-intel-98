/**
 * Minesweeper — a self-contained desktop game (no IPC, no storage, no network), in the spirit of the
 * Win98 original. Left-click reveals (first click is always safe), right-click flags; flood-fill on
 * empty cells; win when every non-mine cell is revealed. Math.random is fine here — purely cosmetic
 * game state, nothing correctness-critical.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Cell { mine: boolean; revealed: boolean; flagged: boolean; adj: number }
type Board = Cell[][];
interface Level { name: string; rows: number; cols: number; mines: number }

const LEVELS: Level[] = [
  { name: 'Beginner', rows: 9, cols: 9, mines: 10 },
  { name: 'Intermediate', rows: 16, cols: 16, mines: 40 },
  { name: 'Expert', rows: 16, cols: 30, mines: 99 }
];
const NUM_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];

function blank(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ mine: false, revealed: false, flagged: false, adj: 0 })));
}

/** Place mines after the first click, never on or adjacent to the clicked cell, then compute counts. */
function plant(board: Board, mines: number, safeR: number, safeC: number): Board {
  const rows = board.length, cols = board[0].length;
  const b = board.map((row) => row.map((c) => ({ ...c })));
  const forbidden = new Set<number>();
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
    const r = safeR + dr, c = safeC + dc;
    if (r >= 0 && r < rows && c >= 0 && c < cols) forbidden.add(r * cols + c);
  }
  let placed = 0;
  while (placed < mines && placed < rows * cols - forbidden.size) {
    const idx = Math.floor(Math.random() * rows * cols);
    if (forbidden.has(idx) || b[Math.floor(idx / cols)][idx % cols].mine) continue;
    b[Math.floor(idx / cols)][idx % cols].mine = true;
    placed += 1;
  }
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    if (b[r][c].mine) continue;
    let n = 0;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && b[rr][cc].mine) n += 1;
    }
    b[r][c].adj = n;
  }
  return b;
}

export function MinesweeperModule(): JSX.Element {
  const [level, setLevel] = useState<Level>(LEVELS[0]);
  const [board, setBoard] = useState<Board>(() => blank(LEVELS[0].rows, LEVELS[0].cols));
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback((lv: Level) => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setLevel(lv); setBoard(blank(lv.rows, lv.cols)); setStarted(false); setState('playing'); setSeconds(0);
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => {
    if (started && state === 'playing' && !timer.current) {
      timer.current = setInterval(() => setSeconds((s) => Math.min(999, s + 1)), 1000);
    }
    if ((state !== 'playing') && timer.current) { clearInterval(timer.current); timer.current = null; }
  }, [started, state]);

  const flags = useMemo(() => board.flat().filter((c) => c.flagged).length, [board]);

  function revealFlood(b: Board, r: number, c: number): void {
    const rows = b.length, cols = b[0].length;
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop() as [number, number];
      const cell = b[cr][cc];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      if (cell.adj === 0 && !cell.mine) {
        for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
          const rr = cr + dr, ccx = cc + dc;
          if (rr >= 0 && rr < rows && ccx >= 0 && ccx < cols && !b[rr][ccx].revealed) stack.push([rr, ccx]);
        }
      }
    }
  }

  function reveal(r: number, c: number): void {
    if (state !== 'playing') return;
    let b = board.map((row) => row.map((cell) => ({ ...cell })));
    if (!started) { b = plant(b, level.mines, r, c); setStarted(true); }
    if (b[r][c].flagged || b[r][c].revealed) return;
    if (b[r][c].mine) {
      b.forEach((row) => row.forEach((cell) => { if (cell.mine) cell.revealed = true; }));
      setBoard(b); setState('lost'); return;
    }
    revealFlood(b, r, c);
    const safeLeft = b.flat().filter((cell) => !cell.mine && !cell.revealed).length;
    setBoard(b);
    if (safeLeft === 0) { b.forEach((row) => row.forEach((cell) => { if (cell.mine) cell.flagged = true; })); setState('won'); }
  }

  function flag(e: React.MouseEvent, r: number, c: number): void {
    e.preventDefault();
    if (state !== 'playing' || board[r][c].revealed) return;
    setBoard((bb) => bb.map((row, ri) => row.map((cell, ci) => ri === r && ci === c ? { ...cell, flagged: !cell.flagged } : cell)));
  }

  const face = state === 'won' ? '😎' : state === 'lost' ? '😵' : '🙂';

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 10, background: '#c0c0c0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {LEVELS.map((lv) => (
          <button key={lv.name} onClick={() => reset(lv)} style={{ fontWeight: lv.name === level.name ? 'bold' : 'normal' }}>{lv.name}</button>
        ))}
      </div>
      <div className="window" style={{ padding: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontFamily: 'monospace' }}>
          <span style={{ background: '#000', color: '#f00', padding: '2px 6px', minWidth: 48, textAlign: 'center', fontWeight: 'bold' }}>{String(Math.max(0, level.mines - flags)).padStart(3, '0')}</span>
          <button onClick={() => reset(level)} title="New game" style={{ fontSize: 18, lineHeight: 1, minWidth: 36 }}>{face}</button>
          <span style={{ background: '#000', color: '#f00', padding: '2px 6px', minWidth: 48, textAlign: 'center', fontWeight: 'bold' }}>{String(seconds).padStart(3, '0')}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${level.cols}, 22px)`, gap: 0, userSelect: 'none' }}>
          {board.map((row, r) => row.map((cell, c) => {
            const open = cell.revealed;
            return (
              <div key={`${r}-${c}`}
                onClick={() => reveal(r, c)}
                onContextMenu={(e) => flag(e, r, c)}
                style={{
                  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 'bold', fontFamily: 'monospace', cursor: state === 'playing' ? 'pointer' : 'default',
                  boxSizing: 'border-box',
                  background: open && cell.mine ? '#ff0000' : open ? '#bdbdbd' : '#c0c0c0',
                  border: open ? '1px solid #9e9e9e' : '2px outset #f0f0f0',
                  color: cell.adj ? NUM_COLORS[cell.adj] : '#000'
                }}>
                {open
                  ? (cell.mine ? '💣' : cell.adj > 0 ? cell.adj : '')
                  : (cell.flagged ? '🚩' : '')}
              </div>
            );
          }))}
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        {state === 'won' ? '🎉 Cleared!' : state === 'lost' ? '💥 Boom — click the face to retry.' : 'Left-click reveal · right-click flag · first click is always safe'}
      </div>
    </div>
  );
}
