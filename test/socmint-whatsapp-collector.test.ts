/**
 * WA-T2: Sealed WhatsApp collector tests.
 *
 * Mirrors the structure of socmint-collector.test.ts (sealed mtcute seam).
 *
 * Tests:
 *   1. makeWhatsAppCollector — connect() rejects with the sealed-seam message on
 *      direct transport (library absent by design, always).
 *   2. makeWhatsAppCollector — connect() rejects with the sealed-seam message on
 *      tor transport.
 *   3. makeWhatsAppCollector — connect() rejects with an Error instance.
 *   4. makeWhatsAppCollector — join() throws the sealed-seam message.
 *   5. makeWhatsAppCollector — backfill() throws the sealed-seam message.
 *   6. makeWhatsAppCollector — subscribe() throws the sealed-seam message.
 *   7. makeWhatsAppCollector — disconnect() resolves without error (no-op before
 *      the seam is open; nothing to close).
 *   8. WA_SEALED_MESSAGE references §5.5 supply-chain checklist (lotusbail guard).
 *
 * Transport resolution is handled by resolveTransport() at the egress boundary
 * (handleStartMonitor), not inside the collector. Tor-down behaviour is covered
 * by socmint-tor-identity.test.ts. Tests here use pre-resolved transport objects
 * so no bgconn Tor singleton manipulation is needed.
 */

import { describe, it, expect } from 'vitest';
import {
  makeWhatsAppCollector,
  WA_SEALED_MESSAGE,
} from '../src/main/socmint/whatsapp-collector';
import { deriveBurnerCredentials } from '../src/main/socmint/tor-identity';
import type { SocmintTransport } from '../src/main/socmint/tor-identity';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function directTransport(): SocmintTransport {
  return { mode: 'direct' };
}

function torTransport(burnerId: string): SocmintTransport {
  const { user, pass } = deriveBurnerCredentials(burnerId);
  return {
    mode: 'tor',
    proxy: {
      host: '127.0.0.1',
      port: 9050,
      version: 5,
      user,
      password: pass,
    },
  };
}

// ---------------------------------------------------------------------------
// connect() — sealed seam (direct transport)
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — connect() sealed seam (direct)', () => {
  it('rejects with the sealed-seam error message on direct transport', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-1',
      transport: directTransport(),
      harvestedAt: () => new Date().toISOString(),
    });
    await expect(collector.connect()).rejects.toThrow(WA_SEALED_MESSAGE);
  });

  it('rejects with an Error instance on direct transport', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-2',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.connect()).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// connect() — sealed seam (tor transport)
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — connect() sealed seam (tor)', () => {
  it('rejects with the sealed-seam error message on tor transport', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-tor-1',
      transport: torTransport('wa-burner-tor-1'),
      harvestedAt: () => '',
    });
    await expect(collector.connect()).rejects.toThrow(WA_SEALED_MESSAGE);
  });

  it('rejects with an Error instance on tor transport', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-tor-2',
      transport: torTransport('wa-burner-tor-2'),
      harvestedAt: () => '',
    });
    await expect(collector.connect()).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// join() — sealed seam
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — join() sealed seam', () => {
  it('throws the sealed-seam message when called', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-join',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.join('120363000000001@g.us')).rejects.toThrow(WA_SEALED_MESSAGE);
  });

  it('throws an Error instance', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-join-2',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.join('some-group@g.us')).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// backfill() — sealed seam
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — backfill() sealed seam', () => {
  it('throws the sealed-seam message when called', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-backfill',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.backfill('120363000000001@g.us', 50)).rejects.toThrow(WA_SEALED_MESSAGE);
  });

  it('throws an Error instance', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-backfill-2',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.backfill('some-group@g.us', 10)).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// subscribe() — sealed seam
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — subscribe() sealed seam', () => {
  it('throws the sealed-seam message when called', () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-sub',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    expect(() => collector.subscribe(['120363000000001@g.us'], () => {})).toThrow(WA_SEALED_MESSAGE);
  });

  it('throws an Error instance', () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-sub-2',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    expect(() => collector.subscribe([], () => {})).toThrow(Error);
  });
});

// ---------------------------------------------------------------------------
// disconnect() — no-op before seam is open
// ---------------------------------------------------------------------------

describe('makeWhatsAppCollector — disconnect() no-op', () => {
  it('resolves without error (nothing to close before the seam is open)', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-disc',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await expect(collector.disconnect()).resolves.toBeUndefined();
  });

  it('disconnect() is idempotent — calling twice does not throw', async () => {
    const collector = makeWhatsAppCollector({
      burnerId: 'wa-burner-disc-2',
      transport: directTransport(),
      harvestedAt: () => '',
    });
    await collector.disconnect();
    await expect(collector.disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WA_SEALED_MESSAGE — content invariant (lotusbail supply-chain guard)
// ---------------------------------------------------------------------------

describe('WA_SEALED_MESSAGE — content invariant', () => {
  it('references the §5.5 supply-chain checklist', () => {
    expect(WA_SEALED_MESSAGE).toContain('§5.5');
  });

  it('identifies the WhatsApp library', () => {
    expect(WA_SEALED_MESSAGE).toContain('WhatsApp');
  });

  it('is a non-empty string', () => {
    expect(typeof WA_SEALED_MESSAGE).toBe('string');
    expect(WA_SEALED_MESSAGE.length).toBeGreaterThan(0);
  });
});
