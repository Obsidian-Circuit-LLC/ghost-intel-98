/**
 * Pure Start-Monitor request logic for the SOCMINT UI (v3.24.2 fix).
 *
 * No DOM, no React, no Electron — importable in the vitest node environment.
 * SocmintModule imports these so the test-verified payload shape and result
 * mapping are exactly what the component executes.
 *
 * WHY THIS EXISTS (regression guard):
 *   The component previously called startMonitor({ caseId }) with no burnerId,
 *   no channelIds, and no platform. handleStartMonitor REQUIRES burnerId and
 *   fails closed on empty channelIds (src/main/socmint/ipc.ts:303,372), and the
 *   renderer swallowed the thrown error — so Start Monitor was a dead button.
 *   buildStartMonitorRequest now sends the full payload; describeMonitorResult
 *   makes every backend outcome visible instead of silently dropped.
 */

import type { MonitoredChannel, SocmintPlatform } from '@shared/socmint/types';

/** Inputs for building one startMonitor request. */
export interface StartMonitorBuildParams {
  caseId: string;
  burnerId: string;
  channels: Pick<MonitoredChannel, 'channelId'>[];
  platform: SocmintPlatform;
}

/** The IPC request object sent to window.api.socmint.startMonitor. */
export interface StartMonitorRequest {
  caseId: string;
  burnerId: string;
  platform: SocmintPlatform;
  channelIds: string[];
}

/**
 * Build the full startMonitor payload. channelIds are derived from the monitored
 * channels for the case; burnerId is trimmed; platform is carried explicitly so
 * the backend does not silently default it to 'telegram'.
 */
export function buildStartMonitorRequest(p: StartMonitorBuildParams): StartMonitorRequest {
  return {
    caseId: p.caseId,
    burnerId: p.burnerId.trim(),
    platform: p.platform,
    channelIds: p.channels.map((c) => c.channelId),
  };
}

/** Inputs for the start-enabled guard. */
export interface CanStartMonitorParams {
  networkEnabled: boolean;
  monitoring: boolean;
  caseId: string;
  burnerId: string;
  channelCount: number;
}

/**
 * Whether the Start Monitor button may fire. Requires the network gate open,
 * not already starting, a case id, a BURNER ID (the field the dead button never
 * sent), and at least one monitored channel (the backend fails closed otherwise).
 */
export function canStartMonitor(p: CanStartMonitorParams): boolean {
  return (
    p.networkEnabled &&
    !p.monitoring &&
    !!p.caseId.trim() &&
    !!p.burnerId.trim() &&
    p.channelCount > 0
  );
}

/** The union returned by handleStartMonitor across its outcomes. */
export type StartMonitorResult =
  | { started: true; jobId: string }
  | { noChannels: true }
  | { disabled: true };

export type MonitorOutcomeKind = 'started' | 'noChannels' | 'disabled' | 'error';

export interface MonitorOutcome {
  kind: MonitorOutcomeKind;
  /** Present only when kind === 'started'. */
  jobId?: string;
  /** A plain-language sentence for the operator (empty for a clean start). */
  message: string;
}

/**
 * Map a backend startMonitor result to a user-visible outcome.
 *
 * Every shape — including an unexpected one — yields a message so the UI never
 * silently drops a failure (the original bug). For a clean start the message is
 * empty and the jobId is carried.
 */
export function describeMonitorResult(result: StartMonitorResult): MonitorOutcome {
  if (result && 'jobId' in result && typeof result.jobId === 'string') {
    return { kind: 'started', jobId: result.jobId, message: '' };
  }
  if (result && 'noChannels' in result) {
    return {
      kind: 'noChannels',
      message: 'Monitoring did not start — none of the monitored channels could be joined. Check the channel IDs / that the burner has access.',
    };
  }
  if (result && 'disabled' in result) {
    return {
      kind: 'disabled',
      message: 'Monitoring did not start — SOCMINT network is disabled. Enable it in Settings › SOCMINT.',
    };
  }
  return {
    kind: 'error',
    message: 'Monitoring did not start — an unexpected response was returned.',
  };
}
