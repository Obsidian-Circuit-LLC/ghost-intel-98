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
  fmt,
} from './standard';
import { memoryOp, pushHistory, type MemOp } from './calc-shell';
import { StandardKeypad } from './StandardKeypad';
import { sci, type Angle, type SciFn } from './scientific';
import { ScientificKeypad } from './ScientificKeypad';
import { toBase, fromBase, bitOp, type Base, type BitOpKind } from './programmer';
import { ProgrammerKeypad } from './ProgrammerKeypad';
import { convert, CATEGORIES, type Category } from './converter';
import { ConverterKeypad } from './ConverterKeypad';
import { stats } from './statistics';
import { StatisticsKeypad } from './StatisticsKeypad';
import { daysBetween, addDays } from './date-calc';
import { DateCalcKeypad } from './DateCalcKeypad';
import { unitConvert, UNIT_CATEGORIES, type UnitCategory } from './unit-calc';
import { UnitCalcKeypad } from './UnitCalcKeypad';

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

  // The memory register (MC/MR/MS/M+/M-) is a single decimal scalar backed by the standard/
  // scientific display. The other five modes have no unambiguous scalar to store or recall —
  // Programmer is base-native, Converter/Unit show a compound `in = out`, Statistics/Date operate
  // on a set — so memory is scoped to the arithmetic modes rather than silently capturing the
  // stale standard display. Buttons are disabled outside those modes.
  const memActive = mode === 'standard' || mode === 'scientific';

  const onMemory = useCallback(
    (op: MemOp) => {
      if (!memActive) return;
      if (op === 'MR') {
        setStd((prev) => ({ ...prev, display: String(memory), fresh: true }));
        return;
      }
      const current = Number(std.display) || 0;
      setMemory((reg) => memoryOp(reg, op, current));
    },
    [memActive, memory, std.display],
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
        const display = fmt(r);
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
        const display = fmt(r);
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
  const convDisplay = fmt(convResult);

  // Statistics mode accumulates a dataset (array of committed numbers) plus
  // an in-progress entry string; `stats()` (pure, statistics.ts) is derived
  // fresh from the dataset on every render, same pattern as convResult above.
  const [statsDataset, setStatsDataset] = useState<number[]>([]);
  const [statsEntry, setStatsEntry] = useState<string>('0');
  const [statsFresh, setStatsFresh] = useState<boolean>(true);

  const onStatsDigit = useCallback((d: string) => {
    setStatsEntry((prev) => (statsFresh || prev === '0' ? d : prev + d));
    setStatsFresh(false);
  }, [statsFresh]);

  const onStatsDot = useCallback(() => {
    setStatsEntry((prev) => {
      if (statsFresh) return '0.';
      return prev.includes('.') ? prev : prev + '.';
    });
    setStatsFresh(false);
  }, [statsFresh]);

  const onStatsBackspace = useCallback(() => {
    setStatsEntry((prev) => {
      if (statsFresh) return prev;
      const d = prev.length > 1 ? prev.slice(0, -1) : '0';
      return d === '' ? '0' : d;
    });
  }, [statsFresh]);

  const onStatsClearEntry = useCallback(() => {
    setStatsEntry('0');
    setStatsFresh(true);
  }, []);

  const onStatsClearDataset = useCallback(() => {
    setStatsDataset([]);
    setStatsEntry('0');
    setStatsFresh(true);
  }, []);

  const onStatsAddValue = useCallback(() => {
    const v = Number(statsEntry);
    if (!Number.isFinite(v)) return;
    setStatsDataset((ds) => {
      const next = [...ds, v];
      setHistory((h) => pushHistory(h, `+ ${v} (n=${next.length})`));
      return next;
    });
    setStatsEntry('0');
    setStatsFresh(true);
  }, [statsEntry]);

  const statsResult = stats(statsDataset);

  // Date Calc mode holds two date-picker strings for daysBetween() plus a
  // base date + in-progress day-count entry for addDays()/subtractDays();
  // both results are derived fresh from current inputs on every render, same
  // pattern as convResult/statsResult above — no Date.now() anywhere here.
  const [dateStart, setDateStart] = useState<string>('2026-01-01');
  const [dateEnd, setDateEnd] = useState<string>('2026-01-01');
  const [dateBase, setDateBase] = useState<string>('2026-01-01');
  const [dateDaysEntry, setDateDaysEntry] = useState<string>('0');
  const [dateFresh, setDateFresh] = useState<boolean>(true);
  const [dateAddResult, setDateAddResult] = useState<string>('—');

  const onDateDigit = useCallback((d: string) => {
    setDateDaysEntry((prev) => (dateFresh || prev === '0' ? d : prev + d));
    setDateFresh(false);
  }, [dateFresh]);

  const onDateBackspace = useCallback(() => {
    setDateDaysEntry((prev) => {
      if (dateFresh) return prev;
      const d = prev.length > 1 ? prev.slice(0, -1) : '0';
      return d === '' ? '0' : d;
    });
  }, [dateFresh]);

  const onDateClearEntry = useCallback(() => {
    setDateDaysEntry('0');
    setDateFresh(true);
  }, []);

  const onDateAddDays = useCallback(() => {
    const n = Number(dateDaysEntry) || 0;
    const result = addDays(dateBase, n);
    setDateAddResult(result);
    setHistory((h) => pushHistory(h, `${dateBase} + ${n} day(s) = ${result}`));
    setLastResult(result);
  }, [dateBase, dateDaysEntry]);

  const onDateSubtractDays = useCallback(() => {
    const n = Number(dateDaysEntry) || 0;
    const result = addDays(dateBase, -n);
    setDateAddResult(result);
    setHistory((h) => pushHistory(h, `${dateBase} - ${n} day(s) = ${result}`));
    setLastResult(result);
  }, [dateBase, dateDaysEntry]);

  const dateBetweenResult = daysBetween(dateStart, dateEnd);

  // Unit Calc mode mirrors Converter mode's derive-on-render pattern:
  // unitConvert() (pure, unit-calc.ts) is called fresh with the current
  // category/units/value on every render — area/volume use factor tables,
  // temperature uses the affine C/F/K formulas internally.
  const [unitCategory, setUnitCategory] = useState<UnitCategory>('area');
  const [unitFrom, setUnitFrom] = useState<string>('m2');
  const [unitTo, setUnitTo] = useState<string>('ft2');
  const [unitInput, setUnitInput] = useState<string>('0');
  const [unitFresh, setUnitFresh] = useState<boolean>(true);

  const unitsFor = useCallback((cat: UnitCategory): string[] => {
    return cat === 'temperature' ? [...UNIT_CATEGORIES.temperature] : Object.keys(UNIT_CATEGORIES[cat]);
  }, []);

  const onUnitCategoryChange = useCallback(
    (cat: UnitCategory) => {
      setUnitCategory(cat);
      const units = unitsFor(cat);
      setUnitFrom(units[0]);
      setUnitTo(units[1] ?? units[0]);
      setUnitInput('0');
      setUnitFresh(true);
    },
    [unitsFor],
  );

  const onUnitSwap = useCallback(() => {
    setUnitFrom(unitTo);
    setUnitTo(unitFrom);
  }, [unitFrom, unitTo]);

  const onUnitDigit = useCallback((d: string) => {
    setUnitInput((prev) => (unitFresh || prev === '0' ? d : prev + d));
    setUnitFresh(false);
  }, [unitFresh]);

  const onUnitDot = useCallback(() => {
    setUnitInput((prev) => {
      if (unitFresh) return '0.';
      return prev.includes('.') ? prev : prev + '.';
    });
    setUnitFresh(false);
  }, [unitFresh]);

  const onUnitClear = useCallback(() => {
    setUnitInput('0');
    setUnitFresh(true);
  }, []);

  const onUnitBackspace = useCallback(() => {
    setUnitInput((prev) => {
      if (unitFresh) return prev;
      const d = prev.length > 1 ? prev.slice(0, -1) : '0';
      return d === '' ? '0' : d;
    });
  }, [unitFresh]);

  const unitResultRaw = unitConvert(Number(unitInput) || 0, unitFrom, unitTo, unitCategory);
  const unitDisplay = fmt(unitResultRaw);

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
                : mode === 'statistics'
                  ? statsEntry
                  : mode === 'date'
                    ? `${dateBetweenResult} day(s)`
                    : mode === 'unit'
                      ? `${unitInput} ${unitFrom} = ${unitDisplay} ${unitTo}`
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
        ) : mode === 'statistics' ? (
          <StatisticsKeypad
            entry={statsEntry}
            dataset={statsDataset}
            result={statsResult}
            onDigit={onStatsDigit}
            onDot={onStatsDot}
            onBackspace={onStatsBackspace}
            onAddValue={onStatsAddValue}
            onClearEntry={onStatsClearEntry}
            onClearDataset={onStatsClearDataset}
          />
        ) : mode === 'date' ? (
          <DateCalcKeypad
            startDate={dateStart}
            endDate={dateEnd}
            onStartDateChange={setDateStart}
            onEndDateChange={setDateEnd}
            daysBetweenResult={dateBetweenResult}
            baseDate={dateBase}
            onBaseDateChange={setDateBase}
            daysEntry={dateDaysEntry}
            onDigit={onDateDigit}
            onBackspace={onDateBackspace}
            onClearEntry={onDateClearEntry}
            onAddDays={onDateAddDays}
            onSubtractDays={onDateSubtractDays}
            addResult={dateAddResult}
          />
        ) : mode === 'unit' ? (
          <UnitCalcKeypad
            category={unitCategory}
            onCategoryChange={onUnitCategoryChange}
            fromUnit={unitFrom}
            toUnit={unitTo}
            onFromChange={setUnitFrom}
            onToChange={setUnitTo}
            onSwap={onUnitSwap}
            onDigit={onUnitDigit}
            onDot={onUnitDot}
            onClear={onUnitClear}
            onClearEntry={onUnitClear}
            onBackspace={onUnitBackspace}
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
              <button
                key={op}
                type="button"
                className="ga98-calc-key ga98-calc-mem"
                disabled={!memActive}
                title={memActive ? undefined : 'Memory is available in Standard and Scientific modes'}
                onClick={() => onMemory(op)}
              >
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
