// test/socmint-start-monitor-block.test.ts
import { describe, it, expect } from 'vitest';
import { describeStartMonitorBlock } from '../src/renderer/modules/socmint/start-monitor-block';

const base = {
  networkEnabled: true, caseId: 'c1', burnerId: 'tg-burner-1',
  channelCount: 1, hasPendingChannelInput: false, isWhatsApp: false,
};

describe('describeStartMonitorBlock', () => {
  it('returns empty when everything is satisfied', () => {
    expect(describeStartMonitorBlock(base)).toBe('');
  });
  it('flags disabled network first', () => {
    expect(describeStartMonitorBlock({ ...base, networkEnabled: false }))
      .toMatch(/network is off/i);
  });
  it('flags a missing case', () => {
    expect(describeStartMonitorBlock({ ...base, caseId: '' })).toMatch(/select a case/i);
  });
  it('gives the specific hint when a channel was typed but not added', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: true }))
      .toMatch(/click .*add channel/i);
  });
  it('asks for a channel when none exist and nothing is pending', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: false }))
      .toMatch(/add at least one channel/i);
  });
  it('uses "group" wording for WhatsApp', () => {
    expect(describeStartMonitorBlock({ ...base, channelCount: 0, hasPendingChannelInput: false, isWhatsApp: true }))
      .toMatch(/add at least one group/i);
  });
  it('flags a missing burner id last', () => {
    expect(describeStartMonitorBlock({ ...base, burnerId: '  ' })).toMatch(/burner id/i);
  });
});
