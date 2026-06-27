/**
 * X-6: Renderer status-display logic tests.
 *
 * Tests the pure xStatusDisplay() function that maps XCollectorStatus values
 * to display descriptors (label, variant, isComplete, isWarning).
 *
 * FAIL-LOUD invariants under test (spec §4):
 *   - 'partial' and 'breakage-detected' MUST NOT be isComplete.
 *   - 'done' is the ONLY status that may be isComplete.
 *   - 'partial' and 'breakage-detected' MUST be isWarning (UI must show banner).
 *   - Every defined status maps to a non-empty label and a defined variant.
 *
 * This test file is pure-logic (no DOM, no React, no Electron) and runs in the
 * default vitest node environment without any JSDOM setup.
 */

import { describe, it, expect } from 'vitest';
import {
  xStatusDisplay,
  ALL_X_STATUSES,
  type XStatusDisplay,
} from '../src/renderer/modules/x/status-display';
import type { XCollectorStatus } from '../src/shared/ipc-contracts';

// ---------------------------------------------------------------------------
// Exhaustiveness — every status value must map to a defined XStatusDisplay
// ---------------------------------------------------------------------------

describe('xStatusDisplay: exhaustiveness', () => {
  it('returns a defined XStatusDisplay for every XCollectorStatus value', () => {
    for (const status of ALL_X_STATUSES) {
      const d = xStatusDisplay(status as XCollectorStatus);
      expect(d).toBeDefined();
      expect(typeof d.label).toBe('string');
      expect(d.label.length).toBeGreaterThan(0);
      expect(typeof d.variant).toBe('string');
      expect(typeof d.isComplete).toBe('boolean');
      expect(typeof d.isWarning).toBe('boolean');
    }
  });

  it('ALL_X_STATUSES contains all known XCollectorStatus values', () => {
    const expected: XCollectorStatus[] = [
      'idle',
      'running',
      'done',
      'partial',
      'error',
      'sidecar-missing',
      'breakage-detected',
    ];
    expect([...ALL_X_STATUSES].sort()).toEqual([...expected].sort());
  });
});

// ---------------------------------------------------------------------------
// FAIL-LOUD: isComplete — 'done' is the ONLY complete status (spec §4.2)
// ---------------------------------------------------------------------------

describe('xStatusDisplay: isComplete', () => {
  it("'done' is the only status where isComplete is true", () => {
    for (const status of ALL_X_STATUSES) {
      const d = xStatusDisplay(status as XCollectorStatus);
      if (status === 'done') {
        expect(d.isComplete).toBe(true);
      } else {
        expect(d.isComplete).toBe(false);
      }
    }
  });

  it("'partial' is NOT isComplete — must never be treated as evidence of absence", () => {
    expect(xStatusDisplay('partial').isComplete).toBe(false);
  });

  it("'breakage-detected' is NOT isComplete — result set is indeterminate", () => {
    expect(xStatusDisplay('breakage-detected').isComplete).toBe(false);
  });

  it("'error' is NOT isComplete", () => {
    expect(xStatusDisplay('error').isComplete).toBe(false);
  });

  it("'sidecar-missing' is NOT isComplete — binary absent, no collection ran", () => {
    expect(xStatusDisplay('sidecar-missing').isComplete).toBe(false);
  });

  it("'idle' is NOT isComplete", () => {
    expect(xStatusDisplay('idle').isComplete).toBe(false);
  });

  it("'running' is NOT isComplete", () => {
    expect(xStatusDisplay('running').isComplete).toBe(false);
  });

  it("'done' has variant 'complete' (drives status-badge CSS class)", () => {
    expect(xStatusDisplay('done').variant).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// FAIL-LOUD: isWarning — banners must be shown for indeterminate statuses
// ---------------------------------------------------------------------------

describe('xStatusDisplay: isWarning', () => {
  it("'partial' is isWarning — truncation/partial banner must be displayed", () => {
    expect(xStatusDisplay('partial').isWarning).toBe(true);
  });

  it("'breakage-detected' is isWarning — persistent breakage banner must be displayed", () => {
    expect(xStatusDisplay('breakage-detected').isWarning).toBe(true);
  });

  it("'error' is isWarning", () => {
    expect(xStatusDisplay('error').isWarning).toBe(true);
  });

  it("'done' is NOT isWarning — only truly complete result, no warning needed", () => {
    expect(xStatusDisplay('done').isWarning).toBe(false);
  });

  it("'idle' is NOT isWarning", () => {
    expect(xStatusDisplay('idle').isWarning).toBe(false);
  });

  it("'running' is NOT isWarning", () => {
    expect(xStatusDisplay('running').isWarning).toBe(false);
  });

  it("'sidecar-missing' is NOT isWarning — not a data-integrity concern, just not installed", () => {
    expect(xStatusDisplay('sidecar-missing').isWarning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Variant values — drive CSS class names on the status badge
// ---------------------------------------------------------------------------

describe('xStatusDisplay: variant', () => {
  it("'idle' has variant 'idle'", () => {
    expect(xStatusDisplay('idle').variant).toBe('idle');
  });

  it("'running' has variant 'running'", () => {
    expect(xStatusDisplay('running').variant).toBe('running');
  });

  it("'done' has variant 'complete'", () => {
    expect(xStatusDisplay('done').variant).toBe('complete');
  });

  it("'partial' has variant 'partial'", () => {
    expect(xStatusDisplay('partial').variant).toBe('partial');
  });

  it("'error' has variant 'error'", () => {
    expect(xStatusDisplay('error').variant).toBe('error');
  });

  it("'sidecar-missing' has variant 'missing'", () => {
    expect(xStatusDisplay('sidecar-missing').variant).toBe('missing');
  });

  it("'breakage-detected' has variant 'breakage'", () => {
    expect(xStatusDisplay('breakage-detected').variant).toBe('breakage');
  });

  it("no status with isComplete=false has variant 'complete'", () => {
    const nonComplete: XCollectorStatus[] = ALL_X_STATUSES.filter((s) => s !== 'done');
    for (const status of nonComplete) {
      const d = xStatusDisplay(status as XCollectorStatus);
      expect(d.variant).not.toBe('complete');
    }
  });
});

// ---------------------------------------------------------------------------
// Label content — non-empty, human-readable strings
// ---------------------------------------------------------------------------

describe('xStatusDisplay: label', () => {
  it('every status maps to a non-empty label string', () => {
    for (const status of ALL_X_STATUSES) {
      expect(xStatusDisplay(status as XCollectorStatus).label.trim().length).toBeGreaterThan(0);
    }
  });

  it("'sidecar-missing' label contains 'not installed'", () => {
    expect(xStatusDisplay('sidecar-missing').label.toLowerCase()).toContain('not installed');
  });

  it("'breakage-detected' label contains 'breakage'", () => {
    expect(xStatusDisplay('breakage-detected').label.toLowerCase()).toContain('breakage');
  });

  it("'partial' label contains 'partial'", () => {
    expect(xStatusDisplay('partial').label.toLowerCase()).toContain('partial');
  });

  it("'done' label contains 'done'", () => {
    expect(xStatusDisplay('done').label.toLowerCase()).toContain('done');
  });
});

// ---------------------------------------------------------------------------
// isComplete XOR isWarning guard (structural sanity)
// ---------------------------------------------------------------------------

describe('xStatusDisplay: isComplete and isWarning structural constraints', () => {
  it('no status is simultaneously isComplete and isWarning (mutually exclusive)', () => {
    for (const status of ALL_X_STATUSES) {
      const d: XStatusDisplay = xStatusDisplay(status as XCollectorStatus);
      // isComplete=true implies isWarning=false; if both were true, the UI would
      // show a "done" badge AND a warning banner — a contradictory state.
      expect(d.isComplete && d.isWarning).toBe(false);
    }
  });
});
