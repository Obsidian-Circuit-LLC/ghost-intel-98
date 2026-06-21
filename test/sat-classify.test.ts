import { describe, it, expect } from 'vitest';
import { classifyByName } from '../src/renderer/modules/geoint/satellites/classify';

describe('classifyByName', () => {
  it('maps Starlink by name prefix', () => {
    expect(classifyByName('STARLINK-1283', 50345)).toBe('starlink');
  });
  it('maps GPS / NAVSTAR', () => {
    expect(classifyByName('NAVSTAR 81 (USA 319)', 48859)).toBe('gps');
    expect(classifyByName('GPS BIIF-7', 40730)).toBe('gps');
  });
  it('maps weather birds', () => {
    expect(classifyByName('NOAA 20', 43013)).toBe('weather');
    expect(classifyByName('METEOR-M 2', 40069)).toBe('weather');
  });
  it('maps stations', () => {
    expect(classifyByName('ISS (ZARYA)', 25544)).toBe('station');
    expect(classifyByName('CSS (TIANHE)', 48274)).toBe('station');
  });
  it('falls back to other', () => {
    expect(classifyByName('SOME RANDOM OBJECT', 99999)).toBe('other');
  });
});
