/**
 * Number Muncher — a 7-mode calculator tucked into the Organizer menu.
 *
 * Architecture: each mode is a pure engine (no DOM/state) heavily unit-tested;
 * this shell owns the display, memory register, and history log, and hosts the
 * per-mode keypad. Standard mode ships here (T3); Scientific/Programmer/
 * Converter/Statistics/Date Calc/Unit Calc are wired in T4–T9.
 *
 * Zero network, zero persistence — a self-contained client-side tool.
 */

import { useCallback, useState } from 'react';
import {
  INIT,
  type CalcState,
  type Op,
  inputDigit,
  inputDot,
  setOp,
  equals as stdEquals,
  unary as stdUnary,
  clearAll as stdClearAll,
  clearEntry as stdClearEntry,
  backspace as stdBackspace,
} from './standard';
import { memoryOp, pushHistory, type MemOp } from './calc-shell';
import { StandardKeypad } from './StandardKeypad';

export type CalcMode = 'standard' | 'scientific' | 'programmer' | 'converter' | 'statistics' | 'date' | 'unit';

const MODES: { key: CalcMode; label: string }[] = [
  { key: 'standard', label: 'Standard' },
  { key: 'scientific', label: 'Scientific' },
  { key: 'programmer', label: 'Programmer' },
  { key: 'converter', label: 'Converter' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'date', label: 'Date Calc' },
  { key: 'unit', label: 'Unit Calc' },
];

const OP_GLYPH: Record<Op, string> = { '+': '+', '-': '-', '*': '×', '/': '÷' };

export function NumberMuncherModule(): JSX.Element {
  const [mode, setMode] = useState<CalcMode>('standard');
  const [std, setStd] = useState<CalcState>(INIT);
  const [memory, setMemory] = useState<number>(0);
  const [history, setHistory] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<string>('—');

  const onEquals = useCallback(() => {
    setStd((prev) => {
      const next = stdEquals(prev);
      if (prev.acc !== null && prev.op && !next.error && next !== prev) {
        const entry = `${prev.acc} ${OP_GLYPH[prev.op]} ${prev.display} = ${next.display}`;
        setHistory((h) => pushHistory(h, entry));
        setLastResult(next.display);
      } else if (next.error) {
        setLastResult('Error');
      }
      return next;
    });
  }, []);

  const onMemory = useCallback(
    (op: MemOp) => {
      if (op === 'MR') {
        setStd((prev) => ({ ...prev, display: String(memory), fresh: true }));
        return;
      }
      const current = Number(std.display) || 0;
      setMemory((reg) => memoryOp(reg, op, current));
    },
    [memory, std.display],
  );

  return (
    <div className="ga98-calc">
      <div className="ga98-calc-rail" role="tablist" aria-label="Calculator modes">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className="ga98-calc-mode"
            data-active={mode === m.key}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="ga98-calc-main">
        <div className="ga98-calc-display" data-error={std.error}>
          {mode === 'standard' ? std.display : '0'}
        </div>

        {mode === 'standard' ? (
          <StandardKeypad
            onDigit={(d) => setStd((s) => inputDigit(s, d))}
            onDot={() => setStd((s) => inputDot(s))}
            onOp={(op) => setStd((s) => setOp(s, op))}
            onEquals={onEquals}
            onUnary={(k) => setStd((s) => stdUnary(s, k))}
            onClear={() => setStd((s) => stdClearAll(s))}
            onClearEntry={() => setStd((s) => stdClearEntry(s))}
            onBackspace={() => setStd((s) => stdBackspace(s))}
          />
        ) : (
          <div className="ga98-calc-placeholder">
            {MODES.find((m) => m.key === mode)?.label} mode — coming soon.
          </div>
        )}
      </div>

      <div className="ga98-calc-side">
        <div className="ga98-calc-panel ga98-calc-memory">
          <div className="ga98-calc-panel-title">Memory</div>
          <div className="ga98-calc-mem-buttons">
            {(['MC', 'MR', 'MS', 'M+', 'M-'] as MemOp[]).map((op) => (
              <button key={op} type="button" className="ga98-calc-key ga98-calc-mem" onClick={() => onMemory(op)}>
                {op}
              </button>
            ))}
          </div>
          <div className="ga98-calc-mem-reg">M = {memory}</div>
        </div>

        <div className="ga98-calc-panel ga98-calc-history">
          <div className="ga98-calc-panel-title">
            History
            <button type="button" className="ga98-calc-hist-clear" onClick={() => setHistory([])}>
              Clear
            </button>
          </div>
          <ul className="ga98-calc-hist-list">
            {history.length === 0 ? (
              <li className="ga98-calc-hist-empty">No calculations yet.</li>
            ) : (
              history.map((h, i) => (
                <li key={history.length - i} className="ga98-calc-hist-item">
                  {h}
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="ga98-calc-panel ga98-calc-info">
          <div className="ga98-calc-panel-title">Info</div>
          <dl className="ga98-calc-info-grid">
            <dt>Mode</dt>
            <dd>{MODES.find((m) => m.key === mode)?.label}</dd>
            <dt>Precision</dt>
            <dd>64-bit</dd>
            <dt>Last Result</dt>
            <dd>{lastResult}</dd>
            <dt>Status</dt>
            <dd>{std.error ? 'Error' : 'Ready'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
