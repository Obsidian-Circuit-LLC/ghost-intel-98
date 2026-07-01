// src/renderer/modules/socmint/start-monitor-block.ts
/**
 * Plain-language reason the Start Monitor button is blocked, for on-screen display.
 * Returns '' when nothing blocks. Order mirrors canStartMonitor's checks so the message
 * always names the next thing the operator must do (one clear next action).
 */
export interface StartMonitorBlockParams {
  networkEnabled: boolean;
  caseId: string;
  burnerId: string;
  channelCount: number;
  hasPendingChannelInput: boolean;
  isWhatsApp: boolean;
}

export function describeStartMonitorBlock(p: StartMonitorBlockParams): string {
  const noun = p.isWhatsApp ? 'group' : 'channel';
  if (!p.networkEnabled) return 'SOCMINT network is off — enable it in Settings › SOCMINT.';
  if (!p.caseId.trim()) return 'Select a case first.';
  if (p.channelCount === 0 && p.hasPendingChannelInput) {
    return `You've typed a ${noun} but haven't added it yet — click "Add ${p.isWhatsApp ? 'Group' : 'Channel'}" above first.`;
  }
  if (p.channelCount === 0) return `Add at least one ${noun} above before starting.`;
  if (!p.burnerId.trim()) {
    return `Enter the Burner ID you configured in ${p.isWhatsApp ? 'WA Setup' : 'Settings › SOCMINT'}.`;
  }
  return '';
}
