/**
 * Pure status-to-display mapping for the X/Twitter collector (X-6).
 *
 * No DOM or React dependencies — importable in vitest under the default node
 * environment without JSDOM or any special setup.
 *
 * FAIL-LOUD contract (spec §4): 'done' is the ONLY status whose result set may
 * be treated as complete. 'partial' and 'breakage-detected' MUST NEVER be
 * presented as evidence of absence.
 */

import type { XCollectorStatus } from '@shared/ipc-contracts';

export type XStatusVariant =
  | 'idle'
  | 'running'
  | 'complete'
  | 'partial'
  | 'error'
  | 'missing'
  | 'breakage';

export interface XStatusDisplay {
  label: string;
  variant: XStatusVariant;
  /**
   * true ONLY for 'done'.
   * The UI may treat the result set as complete only when this is true.
   * All other statuses — including 'partial' and 'breakage-detected' — must
   * display a warning and never suggest the absence of results is meaningful.
   */
  isComplete: boolean;
  /**
   * true when the result set may be absent, partial, or inconclusive.
   * The UI must show a FAIL-LOUD warning banner for any isWarning status.
   */
  isWarning: boolean;
}

/**
 * Map an XCollectorStatus to a display descriptor.
 *
 * The switch covers every arm of XCollectorStatus. TypeScript's
 * noFallthroughCasesInSwitch + exhaustiveness check ensure that adding a new
 * status value to the union requires a matching arm here.
 */
export function xStatusDisplay(status: XCollectorStatus): XStatusDisplay {
  switch (status) {
    case 'idle':
      return {
        label: 'Idle',
        variant: 'idle',
        isComplete: false,
        isWarning: false,
      };
    case 'running':
      return {
        label: 'Running…',
        variant: 'running',
        isComplete: false,
        isWarning: false,
      };
    case 'done':
      return {
        label: 'Done',
        variant: 'complete',
        isComplete: true,
        isWarning: false,
      };
    case 'partial':
      return {
        label: 'Partial — stopped short',
        variant: 'partial',
        isComplete: false,
        isWarning: true,
      };
    case 'error':
      return {
        label: 'Error',
        variant: 'error',
        isComplete: false,
        isWarning: true,
      };
    case 'sidecar-missing':
      return {
        label: 'Sidecar not installed',
        variant: 'missing',
        isComplete: false,
        isWarning: false,
      };
    case 'breakage-detected':
      return {
        label: 'Breakage detected — X API changed',
        variant: 'breakage',
        isComplete: false,
        isWarning: true,
      };
  }
}

/** All defined XCollectorStatus values — used in exhaustive tests. */
export const ALL_X_STATUSES: XCollectorStatus[] = [
  'idle',
  'running',
  'done',
  'partial',
  'error',
  'sidecar-missing',
  'breakage-detected',
];
