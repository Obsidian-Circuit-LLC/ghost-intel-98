/**
 * SOCMINT — Start Monitor request builder + result mapping (regression for the
 * "Start Monitor is a dead button" bug, v3.24.2).
 *
 * Bug: SocmintModule called window.api.socmint.startMonitor({ caseId }) with NO
 * burnerId, NO channelIds, and NO platform. handleStartMonitor REQUIRES burnerId
 * (src/main/socmint/ipc.ts:303 throws 'requires burnerId') and fails closed with
 * { noChannels: true } when channelIds is empty (ipc.ts:372). The renderer swallowed
 * the thrown error with a console.warn, so clicking Start Monitor did nothing visible.
 *
 * These tests lock the payload shape (all four fields present, channelIds derived
 * from the monitored channels, platform carried) and the result→message mapping so
 * the UI surfaces noChannels/disabled/error instead of silently dropping them.
 *
 * Pure-logic file: no DOM/React/Electron — runs in the default vitest node env.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStartMonitorRequest,
  canStartMonitor,
  describeMonitorResult,
} from '../src/renderer/modules/socmint/start-monitor-request';

const CASE = '22222222-2222-2222-2222-222222222222';
const channels = [
  { channelId: '-100123', label: 'a', keywords: [] },
  { channelId: '@target', label: 'b', keywords: ['kw'] },
];

describe('buildStartMonitorRequest: full payload (the bug)', () => {
  it('carries caseId, burnerId, platform, and channelIds derived from channels', () => {
    const req = buildStartMonitorRequest({ caseId: CASE, burnerId: 'burner-1', channels, platform: 'telegram' });
    expect(req).toEqual({
      caseId: CASE,
      burnerId: 'burner-1',
      platform: 'telegram',
      channelIds: ['-100123', '@target'],
    });
  });

  it('trims the burnerId', () => {
    const req = buildStartMonitorRequest({ caseId: CASE, burnerId: '  burner-1 ', channels, platform: 'whatsapp' });
    expect(req.burnerId).toBe('burner-1');
  });

  it('carries the selected platform verbatim (not defaulted server-side to telegram)', () => {
    const req = buildStartMonitorRequest({ caseId: CASE, burnerId: 'b', channels, platform: 'whatsapp' });
    expect(req.platform).toBe('whatsapp');
  });

  it('produces an empty channelIds array when no channels are monitored', () => {
    const req = buildStartMonitorRequest({ caseId: CASE, burnerId: 'b', channels: [], platform: 'telegram' });
    expect(req.channelIds).toEqual([]);
  });
});

describe('canStartMonitor: guards', () => {
  const base = {
    networkEnabled: true,
    monitoring: false,
    caseId: CASE,
    burnerId: 'burner-1',
    channelCount: 2,
  };

  it('allows start when network is on, a case + burner + channels exist', () => {
    expect(canStartMonitor(base)).toBe(true);
  });

  it('blocks start without a burnerId (the field the dead button never sent)', () => {
    expect(canStartMonitor({ ...base, burnerId: '   ' })).toBe(false);
  });

  it('blocks start with no channels', () => {
    expect(canStartMonitor({ ...base, channelCount: 0 })).toBe(false);
  });

  it('blocks start when the network gate is off', () => {
    expect(canStartMonitor({ ...base, networkEnabled: false })).toBe(false);
  });

  it('blocks start while already starting', () => {
    expect(canStartMonitor({ ...base, monitoring: true })).toBe(false);
  });

  it('blocks start with no case id', () => {
    expect(canStartMonitor({ ...base, caseId: '' })).toBe(false);
  });
});

describe('describeMonitorResult: surface every backend outcome', () => {
  it('started → carries the jobId and reports active', () => {
    const d = describeMonitorResult({ started: true, jobId: 'job-9' });
    expect(d.jobId).toBe('job-9');
    expect(d.kind).toBe('started');
  });

  it('noChannels → a visible message, no jobId', () => {
    const d = describeMonitorResult({ noChannels: true });
    expect(d.jobId).toBeUndefined();
    expect(d.kind).toBe('noChannels');
    expect(d.message.length).toBeGreaterThan(0);
  });

  it('disabled → a visible "network off" message, no jobId', () => {
    const d = describeMonitorResult({ disabled: true });
    expect(d.jobId).toBeUndefined();
    expect(d.kind).toBe('disabled');
    expect(d.message.toLowerCase()).toContain('network');
  });

  it('unknown shape → treated as an error with a message (never silently dropped)', () => {
    const d = describeMonitorResult({} as never);
    expect(d.kind).toBe('error');
    expect(d.message.length).toBeGreaterThan(0);
  });
});
