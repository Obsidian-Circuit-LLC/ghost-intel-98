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
import { sci, type Angle, type SciFn } from './scientific';
import { ScientificKeypad } from './ScientificKeypad';
import { toBase, fromBase, bitOp, type Base, type BitOpKind } from './programmer';
import { ProgrammerKeypad } from './ProgrammerKeypad';
import { convert, CATEGORIES, type Category } from './converter';
import { ConverterKeypad } from './ConverterKeypad';

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

/** Format a scientific result the same way standard.ts's internal `fmt` does. */
const fmtSci = (n: number): string => {
  if (!Number.isFinite(n)) return 'Error';
  const r = Math.round(n * 1e12) / 1e12;
  return String(r);
};

export function NumberMuncherModule(): JSX.Element {
  const [mode, setMode] = useState<CalcMode>('standard');
  const [std, setStd] = useState<CalcState>(INIT);
  const [memory, setMemory] = useState<number>(0);
  const [history, setHistory] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<string>('—');
  const [angle, setAngle] = useState<Angle>('deg');
  const [sciAcc, setSciAcc] = useState<number | null>(null);
  const [sciFn, setSciFn] = useState<SciFn | null>(null);
  const [progBase, setProgBase] = useState<Base>('DEC');
  const [progDisplay, setProgDisplay] = useState<string>('0');
  const [progAcc, setProgAcc] = useState<bigint | null>(null);
  const [progOp, setProgOp] = useState<BitOpKind | null>(null);
  const [progFresh, setProgFresh] = useState<boolean>(true);

  // Converter mode holds its own numeric-entry string (convInput) plus the
  // active category/unit pair; the converted value is derived on every
  // render via the pure `convert()` engine rather than staged like an
  // accumulator, since there is no chained operator to resolve.
  const [convCategory, setConvCategory] = useState<Category>('length');
  const [convFrom, setConvFrom] = useState<string>('km');
  const [convTo, setConvTo] = useState<string>('m');
  const [convInput, setConvInput] = useState<string>('0');
  const [convFresh, setConvFresh] = useState<boolean>(true);

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

  // Scientific mode reuses standard.ts's CalcState for display/entry/basic
  // +-*/ chaining; `sci()` (pure, scientific.ts) supplies trig/log/pow/
  // factorial. `pow` is binary, so it stages an accumulator (sciAcc) the same
  // way setOp stages `std.acc`, and is resolved on the next `=` (onSciEquals).
  const onSci = useCallback(
    (fn: SciFn) => {
      if (fn === 'pow') {
        setSciAcc(Number(std.display));
        setSciFn('pow');
        setStd((s) => ({ ...s, fresh: true }));
        return;
      }
      setStd((prev) => {
        const x = Number(prev.display);
        const r = sci(fn, x, angle);
        const display = fmtSci(r);
        setHistory((h) => pushHistory(h, `${fn}(${prev.display}) = ${display}`));
        setLastResult(display);
        return { ...prev, display, fresh: true, error: !Number.isFinite(r) };
      });
    },
    [angle, std.display],
  );

  const onSciEquals = useCallback(() => {
    if (sciFn === 'pow' && sciAcc !== null) {
      setStd((prev) => {
        const y = Number(prev.display);
        const r = sci('pow', sciAcc, angle, y);
        const display = fmtSci(r);
        setHistory((h) => pushHistory(h, `${sciAcc} ^ ${y} = ${display}`));
        setLastResult(display);
        return { ...prev, display, fresh: true, error: !Number.isFinite(r), acc: null, op: null };
      });
      setSciAcc(null);
      setSciFn(null);
      return;
    }
    onEquals();
  }, [sciFn, sciAcc, angle, onEquals]);

  // Programmer mode operates on BigInt values rendered in the active base
  // (HEX/DEC/OCT/BIN) via the pure `toBase`/`fromBase`/`bitOp` engine. Digit
  // entry accumulates a base-native string (progDisplay); a binary op (AND/
  // OR/XOR/SHL/SHR/MOD) stages an accumulator the same way setOp stages
  // std.acc, resolved on `=`; NOT applies immediately (unary).
  const onProgDigit = useCallback(
    (d: string) => {
      setProgDisplay((prev) => (progFresh || prev === '0' ? d : prev + d));
      setProgFresh(false);
    },
    [progFresh],
  );

  const onProgBaseChange = useCallback(
    (newBase: Base) => {
      const val = fromBase(progDisplay, progBase);
      setProgBase(newBase);
      setProgDisplay(toBase(val, newBase));
      setProgFresh(true);
    },
    [progBase, progDisplay],
  );

  const onProgBitOp = useCallback(
    (op: BitOpKind) => {
      if (op === 'NOT') {
        const val = fromBase(progDisplay, progBase);
        const r = bitOp('NOT', val, 0n);
        const display = toBase(r, progBase);
        setHistory((h) => pushHistory(h, `NOT ${progDisplay} = ${display}`));
        setLastResult(display);
        setProgDisplay(display);
        setProgFresh(true);
        return;
      }
      const cur = fromBase(progDisplay, progBase);
      setProgAcc(cur);
      setProgOp(op);
      setProgFresh(true);
    },
    [progDisplay, progBase],
  );

  const onProgEquals = useCallback(() => {
    if (progAcc === null || progOp === null) return;
    const cur = fromBase(progDisplay, progBase);
    const r = bitOp(progOp, progAcc, cur);
    const display = toBase(r, progBase);
    setHistory((h) => pushHistory(h, `${toBase(progAcc, progBase)} ${progOp} ${progDisplay} = ${display}`));
    setLastResult(display);
    setProgDisplay(display);
    setProgAcc(null);
    setProgOp(null);
    setProgFresh(true);
  }, [progAcc, progOp, progDisplay, progBase]);

  const onProgClear = useCallback(() => {
    setProgDisplay('0');
    setProgAcc(null);
    setProgOp(null);
    setProgFresh(true);
  }, []);

  const onProgClearEntry = useCallback(() => {
    setProgDisplay('0');
    setProgFresh(true);
  }, []);

  const onProgBackspace = useCallback(() => {
    setProgDisplay((prev) => {
      if (progFresh) return prev;
      const d = prev.length > 1 ? prev.slice(0, -1) : '0';
      return d === '' ? '0' : d;
    });
  }, [progFresh]);

  const onConvCategoryChange = useCallback((cat: Category) => {
    setConvCategory(cat);
    const units = Object.keys(CATEGORIES[cat]);
    setConvFrom(units[0]);
    setConvTo(units[1] ?? units[0]);
    setConvInput('0');
    setConvFresh(true);
  }, []);

  const onConvSwap = useCallback(() => {
    setConvFrom(convTo);
    setConvTo(convFrom);
  }, [convFrom, convTo]);

  const onConvDigit = useCallback((d: string) => {
    setConvInput((prev) => (convFresh || prev === '0' ? d : prev + d));
    setConvFresh(false);
  }, [convFresh]);

  const onConvDot = useCallback(() => {
    setConvInput((prev) => {
      if (convFresh) return '0.';
      return prev.includes('.') ? prev : prev + '.';
    });
    setConvFresh(false);
  }, [convFresh]);

  const onConvClear = useCallback(() => {
    setConvInput('0');
    setConvFresh(true);
  }, []);

  const onConvBackspace = useCallback(() => {
    setConvInput((prev) => {
      if (convFresh) return prev;
      const d = prev.length > 1 ? prev.slice(0, -1) : '0';
      return d === '' ? '0' : d;
    });
  }, [convFresh]);

  const convResult = convert(Number(convInput) || 0, convFrom, convTo, convCategory);
  const convDisplay = Number.isFinite(convResult) ? String(Math.round(convResult * 1e12) / 1e12) : 'Error';

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
          {mode === 'standard' || mode === 'scientific'
            ? std.display
            : mode === 'programmer'
              ? progDisplay
              : mode === 'converter'
                ? `${convInput} ${convFrom} = ${convDisplay} ${convTo}`
                : '0'}
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
        ) : mode === 'scientific' ? (
          <ScientificKeypad
            angle={angle}
            onAngleChange={setAngle}
            onDigit={(d) => setStd((s) => inputDigit(s, d))}
            onDot={() => setStd((s) => inputDot(s))}
            onOp={(op) => setStd((s) => setOp(s, op))}
            onEquals={onSciEquals}
            onSci={onSci}
            onClear={() => {
              setSciAcc(null);
              setSciFn(null);
              setStd((s) => stdClearAll(s));
            }}
            onClearEntry={() => setStd((s) => stdClearEntry(s))}
            onBackspace={() => setStd((s) => stdBackspace(s))}
          />
        ) : mode === 'programmer' ? (
          <ProgrammerKeypad
            base={progBase}
            onBaseChange={onProgBaseChange}
            onDigit={onProgDigit}
            onBitOp={onProgBitOp}
            onEquals={onProgEquals}
            onClear={onProgClear}
            onClearEntry={onProgClearEntry}
            onBackspace={onProgBackspace}
          />
        ) : mode === 'converter' ? (
          <ConverterKeypad
            category={convCategory}
            onCategoryChange={onConvCategoryChange}
            fromUnit={convFrom}
            toUnit={convTo}
            onFromChange={setConvFrom}
            onToChange={setConvTo}
            onSwap={onConvSwap}
            onDigit={onConvDigit}
            onDot={onConvDot}
            onClear={onConvClear}
            onClearEntry={onConvClear}
            onBackspace={onConvBackspace}
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
