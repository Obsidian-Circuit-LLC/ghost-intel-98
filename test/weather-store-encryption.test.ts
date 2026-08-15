/**
 * Weather tool — store encryption-at-rest (constraint 4): the saved-locations/units/cache file is
 * written as ciphertext (ENCX magic) through secure-fs, and reads back plaintext in-app. Mirrors
 * `documents-store-encryption.test.ts`: a mocked electron userData dir + a reversible fake vault.
 *
 * Also proves the offline path's precondition end-to-end: a forecast cached via `setCache` survives a
 * round-trip through the encrypted file and is readable by `getCache` (what the IPC layer serves as
 * "stale, cached <time>" when a live fetch fails).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'dcs98-weather-enc-test');
const MAGIC = Buffer.from('ENCX');
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

// Reversible fake vault (same shape as documents-store-encryption.test.ts): enabled + unlocked;
// encrypt = MAGIC prefix + byte-inverted body.
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff)),
  };
});

import { addLocation, getCache, listLocations, setCache } from '../src/main/weather/store';
import { weatherStoreFile } from '../src/main/storage/paths';
import type { ForecastBundle } from '../src/shared/weather/types';

const BUNDLE: ForecastBundle = {
  current: { time: '2026-08-15T12:00', temperature: 20, apparentTemperature: 19, weatherCode: 2, windSpeed: 5, windDirection: 180, relativeHumidity: 50, precipitation: 0, isDay: 1 },
  hourlyToday: [],
  daily: [],
  units: 'metric',
  timezone: 'Europe/Berlin',
};

beforeEach(async () => {
  await mkdir(DATA, { recursive: true });
});
afterEach(async () => {
  await rm(DATA, { recursive: true, force: true });
});

describe('weather store — encryption at rest (ENCX on disk)', () => {
  it('writes ciphertext to weather.json but reads plaintext back through the store', async () => {
    await addLocation({ name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.41 });

    const onDisk = await readFile(weatherStoreFile());
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX'); // ciphertext magic
    expect(onDisk.includes(Buffer.from('Berlin'))).toBe(false); // plaintext city name not on disk

    const list = await listLocations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Berlin'); // decrypts in-app
    expect(list[0].latitude).toBe(52.52);
  });

  it('round-trips a cached forecast through the encrypted file (offline stale-render precondition)', async () => {
    const [loc] = await addLocation({ name: 'Paris', country: 'France', latitude: 48.85, longitude: 2.35 });
    await setCache(loc.id, BUNDLE);

    const onDisk = await readFile(weatherStoreFile());
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');

    const cached = await getCache(loc.id);
    expect(cached).not.toBeNull();
    expect(cached?.bundle.current.temperature).toBe(20);
    expect(cached?.cachedAt).toBeTruthy();
  });
});
