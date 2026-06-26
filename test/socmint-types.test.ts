import { describe, it, expect } from 'vitest';
import { harvestedItemId } from '@main/socmint/utils';
import {
  mapWhatsAppMessage,
  type WaRawMessage,
  type WaMapperContext,
} from '@main/socmint/whatsapp-mapper';
import { defaultSettings } from '@shared/types';
import type { SocmintPlatform } from '@shared/socmint/types';

describe('harvestedItemId', () => {
  it('is stable across calls for the same inputs', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-100', '42');
    expect(a).toBe(b);
  });

  it('is a 64-character hex string (SHA-256)', () => {
    const id = harvestedItemId('telegram', '-100', '42');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different channelId', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-999', '42');
    expect(a).not.toBe(b);
  });

  it('differs for different messageId', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    const b = harvestedItemId('telegram', '-100', '99');
    expect(a).not.toBe(b);
  });

  it('differs for different platform', () => {
    const a = harvestedItemId('telegram', '-100', '42');
    // 'signal' is not in SocmintPlatform; cast to prove the hash changes when the prefix changes
    const b = harvestedItemId('signal' as any, '-100', '42');
    expect(a).not.toBe(b);
  });

  it('accepts whatsapp as a valid SocmintPlatform', () => {
    // Compile-time: 'whatsapp' is now in the SocmintPlatform union (no cast needed).
    const platform: SocmintPlatform = 'whatsapp';
    const id = harvestedItemId(platform, '1234567890@g.us', 'msg-001');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a distinct id for whatsapp vs telegram with the same channelId+messageId', () => {
    const wa = harvestedItemId('whatsapp', 'group@g.us', 'msg-001');
    const tg = harvestedItemId('telegram', 'group@g.us', 'msg-001');
    expect(wa).not.toBe(tg);
  });
});

describe('defaultSettings.socmint', () => {
  it('has socmint.networkEnabled === false by default', () => {
    expect(defaultSettings.socmint.networkEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WA-T1: mapWhatsAppMessage
// ---------------------------------------------------------------------------

function makeWaMsg(overrides: Partial<WaRawMessage> = {}): WaRawMessage {
  return {
    key: {
      id: 'msg-abc123',
      remoteJid: '120363000000001@g.us',
      participant: '15551234567@s.whatsapp.net',
      fromMe: false,
    },
    message: { conversation: 'Hello from WA group' },
    messageTimestamp: 1700000000, // seconds epoch
    ...overrides,
  };
}

function makeCtx(overrides: Partial<WaMapperContext> = {}): WaMapperContext {
  return {
    channelLabel: 'Test Group',
    harvestedAt: () => '2026-01-01T00:01:00.000Z',
    provenance: {
      collectorVersion: '1.0.0',
      jobId: 'job-wa-1',
      caseId: 'case-wa-1',
    },
    ...overrides,
  };
}

describe('mapWhatsAppMessage — platform + id', () => {
  it('sets platform to whatsapp', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.platform).toBe('whatsapp');
  });

  it('id is a 64-character hex string (SHA-256)', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('id is deterministic — stable across identical inputs', () => {
    const a = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    const b = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(a.id).toBe(b.id);
  });

  it('id differs when channelId differs', () => {
    const a = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    const b = mapWhatsAppMessage(
      makeWaMsg({ key: { ...makeWaMsg().key, remoteJid: '999@g.us' } }),
      makeCtx(),
    );
    expect(a.id).not.toBe(b.id);
  });

  it('id differs when messageId differs', () => {
    const a = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    const b = mapWhatsAppMessage(
      makeWaMsg({ key: { ...makeWaMsg().key, id: 'different-msg-id' } }),
      makeCtx(),
    );
    expect(a.id).not.toBe(b.id);
  });

  it('id matches harvestedItemId(whatsapp, remoteJid, key.id)', () => {
    const msg = makeWaMsg();
    const item = mapWhatsAppMessage(msg, makeCtx());
    const expected = harvestedItemId(
      'whatsapp',
      msg.key.remoteJid!,
      msg.key.id!,
    );
    expect(item.id).toBe(expected);
  });
});

describe('mapWhatsAppMessage — field mapping', () => {
  it('channelId is remoteJid', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.channelId).toBe('120363000000001@g.us');
  });

  it('channelLabel comes from ctx.channelLabel', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx({ channelLabel: 'Op-Sec Group' }));
    expect(item.channelLabel).toBe('Op-Sec Group');
  });

  it('authorId is key.participant', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.authorId).toBe('15551234567@s.whatsapp.net');
  });

  it('authorHandle strips @s.whatsapp.net suffix', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.authorHandle).toBe('15551234567');
  });

  it('authorHandle is untouched when participant has no @s.whatsapp.net suffix', () => {
    const msg = makeWaMsg({
      key: { ...makeWaMsg().key, participant: 'some-other-jid@g.us' },
    });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.authorHandle).toBe('some-other-jid@g.us');
  });

  it('messageId is key.id', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.messageId).toBe('msg-abc123');
  });

  it('text comes from message.conversation', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.text).toBe('Hello from WA group');
  });

  it('text falls back to extendedTextMessage.text when conversation is absent', () => {
    const msg = makeWaMsg({
      message: { extendedTextMessage: { text: 'Extended text content' } },
    });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.text).toBe('Extended text content');
  });

  it('text is empty string when both conversation and extendedText are absent', () => {
    const msg = makeWaMsg({ message: {} });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.text).toBe('');
  });

  it('text is empty string when message is null', () => {
    const msg = makeWaMsg({ message: null as any });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.text).toBe('');
  });

  it('publishedAt is derived from messageTimestamp (seconds → ISO)', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    // 1700000000 * 1000 = 2023-11-14T22:13:20.000Z
    expect(item.publishedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('publishedAt falls back to harvestedAt() when messageTimestamp is absent', () => {
    const msg = makeWaMsg({ messageTimestamp: null as any });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.publishedAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('publishedAt falls back to harvestedAt() when messageTimestamp is 0', () => {
    const msg = makeWaMsg({ messageTimestamp: 0 });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.publishedAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('harvestedAt comes from the injected clock (not Date.now())', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.harvestedAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('url is always empty string (no public WA permalink)', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.url).toBe('');
  });

  it('mediaRef is always empty string (no auto-download)', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.mediaRef).toBe('');
  });

  it('provenance is passed through from ctx', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.provenance).toEqual({
      collectorVersion: '1.0.0',
      jobId: 'job-wa-1',
      caseId: 'case-wa-1',
    });
  });
});

describe('mapWhatsAppMessage — mediaType detection', () => {
  it('mediaType is absent when message has no media', () => {
    const item = mapWhatsAppMessage(makeWaMsg(), makeCtx());
    expect(item.mediaType).toBeUndefined();
  });

  it('mediaType is image for imageMessage', () => {
    const msg = makeWaMsg({ message: { imageMessage: {} } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.mediaType).toBe('image');
  });

  it('mediaType is video for videoMessage', () => {
    const msg = makeWaMsg({ message: { videoMessage: {} } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.mediaType).toBe('video');
  });

  it('mediaType is audio for audioMessage', () => {
    const msg = makeWaMsg({ message: { audioMessage: {} } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.mediaType).toBe('audio');
  });

  it('mediaType is document for documentMessage', () => {
    const msg = makeWaMsg({ message: { documentMessage: {} } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.mediaType).toBe('document');
  });
});

describe('mapWhatsAppMessage — protobufjs Long timestamp', () => {
  it('handles Long (protobufjs) messageTimestamp via .toNumber()', () => {
    const longLike = { toNumber: () => 1700000000 };
    const msg = makeWaMsg({ messageTimestamp: longLike });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.publishedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });
});

describe('mapWhatsAppMessage — null/missing key fields', () => {
  it('channelId is empty string when remoteJid is null', () => {
    const msg = makeWaMsg({ key: { ...makeWaMsg().key, remoteJid: null } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.channelId).toBe('');
  });

  it('messageId is empty string when key.id is null', () => {
    const msg = makeWaMsg({ key: { ...makeWaMsg().key, id: null } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.messageId).toBe('');
  });

  it('authorId and authorHandle are empty string when participant is null', () => {
    const msg = makeWaMsg({ key: { ...makeWaMsg().key, participant: null } });
    const item = mapWhatsAppMessage(msg, makeCtx());
    expect(item.authorId).toBe('');
    expect(item.authorHandle).toBe('');
  });
});
