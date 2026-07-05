import { describe, it, expect } from 'vitest';
import {
  CLEARNET_DIALOG_TEXT,
  xNetworkToggleEnabled,
  xGateEffective,
  xGateToggleAction,
} from '../src/renderer/modules/x/x-settings-logic';

describe('x-settings-logic — preserved exports', () => {
  it('keeps CLEARNET_DIALOG_TEXT with the required disclosure content', () => {
    expect(CLEARNET_DIALOG_TEXT).toContain('over the public internet');
    expect(CLEARNET_DIALOG_TEXT).toContain('cannot be routed');
  });

  it('keeps xNetworkToggleEnabled gated on acknowledgement', () => {
    expect(xNetworkToggleEnabled(true)).toBe(true);
    expect(xNetworkToggleEnabled(false)).toBe(false);
  });
});

describe('xGateEffective — effective gate is BOTH flags', () => {
  it('is true only when networkEnabled AND clearnetAcknowledged', () => {
    expect(xGateEffective({ networkEnabled: true, clearnetAcknowledged: true })).toBe(true);
  });

  it('is false for the legacy inconsistent state (networkEnabled true, ack false)', () => {
    expect(xGateEffective({ networkEnabled: true, clearnetAcknowledged: false })).toBe(false);
  });

  it('is false when acknowledged but network disabled', () => {
    expect(xGateEffective({ networkEnabled: false, clearnetAcknowledged: true })).toBe(false);
  });

  it('is false when neither flag is set', () => {
    expect(xGateEffective({ networkEnabled: false, clearnetAcknowledged: false })).toBe(false);
  });
});

describe('xGateToggleAction — one-control decision', () => {
  it('unchecking always disables regardless of acknowledgement', () => {
    expect(
      xGateToggleAction({ networkEnabled: true, clearnetAcknowledged: true }, false),
    ).toEqual({ kind: 'disable' });
    expect(
      xGateToggleAction({ networkEnabled: true, clearnetAcknowledged: false }, false),
    ).toEqual({ kind: 'disable' });
  });

  it('checking when already acknowledged enables directly (no modal)', () => {
    expect(
      xGateToggleAction({ networkEnabled: false, clearnetAcknowledged: true }, true),
    ).toEqual({ kind: 'enable-direct' });
  });

  it('checking when not yet acknowledged needs the ack modal', () => {
    expect(
      xGateToggleAction({ networkEnabled: false, clearnetAcknowledged: false }, true),
    ).toEqual({ kind: 'needs-ack-modal' });
  });

  it('checking from the legacy state (network true, ack false) needs the ack modal', () => {
    expect(
      xGateToggleAction({ networkEnabled: true, clearnetAcknowledged: false }, true),
    ).toEqual({ kind: 'needs-ack-modal' });
  });
});
