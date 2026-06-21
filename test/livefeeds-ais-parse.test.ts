import { describe, it, expect } from 'vitest';
import { parseAisMessage, pruneVessels } from '../src/shared/livefeeds/aisParse';

const T = 1_700_000_000_000;
const msg = {
  MessageType: 'PositionReport',
  MetaData: { MMSI: 259000420, ShipName: 'AUGUSTSON ', latitude: 66.02695, longitude: 12.2538 },
  Message: { PositionReport: { Latitude: 66.02695, Longitude: 12.2538, Sog: 0, Cog: 308 } }
};

describe('parseAisMessage', () => {
  it('extracts a PositionReport into a ShipPos (capitalized Message fields, trimmed name)', () => {
    expect(parseAisMessage(msg, T)).toMatchObject({ id: '259000420', name: 'AUGUSTSON', lat: 66.02695, lon: 12.2538, sogKt: 0, cogDeg: 308, type: 'other', lastSeen: T });
  });
  it('ignores non-PositionReport message types and garbage; never throws', () => {
    expect(parseAisMessage({ MessageType: 'ShipStaticData', MetaData: { MMSI: 1 } }, T)).toBeNull();
    expect(parseAisMessage(null, T)).toBeNull();
    expect(parseAisMessage({ MessageType: 'PositionReport', Message: { PositionReport: { Latitude: 999, Longitude: 0 } }, MetaData: { MMSI: 1 } }, T)).toBeNull();
  });
});

describe('pruneVessels', () => {
  it('drops vessels older than maxAge, keeps fresh', () => {
    const m = new Map([['a', { id: 'a', lastSeen: T - 11 * 60_000 } as any], ['b', { id: 'b', lastSeen: T } as any]]);
    pruneVessels(m, T, 10 * 60_000);
    expect([...m.keys()]).toEqual(['b']);
  });
});
