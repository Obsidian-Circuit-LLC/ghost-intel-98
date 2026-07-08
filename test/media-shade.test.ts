import { describe, it, expect } from 'vitest';
import { SHADE_HEIGHTS, shadeHeight, toggleShade, toggleStations, modeFromLegacy } from '../src/renderer/modules/media/shade';

describe('jukebox shade model', () => {
  it('heights increase strip < deck < full', () => {
    expect(SHADE_HEIGHTS.strip).toBeLessThan(SHADE_HEIGHTS.deck);
    expect(SHADE_HEIGHTS.deck).toBeLessThan(SHADE_HEIGHTS.full);
    expect(shadeHeight('deck')).toBe(SHADE_HEIGHTS.deck);
  });
  it('toggleShade: strip<->deck, and full collapses to strip', () => {
    expect(toggleShade('strip')).toBe('deck');
    expect(toggleShade('deck')).toBe('strip');
    expect(toggleShade('full')).toBe('strip');
  });
  it('toggleStations: deck<->full (strip opens to full via deck-normalised)', () => {
    expect(toggleStations('deck')).toBe('full');
    expect(toggleStations('full')).toBe('deck');
    expect(toggleStations('strip')).toBe('full'); // opening stations from strip expands past deck
  });
  it('modeFromLegacy maps the old boolean', () => {
    expect(modeFromLegacy(true)).toBe('full');
    expect(modeFromLegacy(false)).toBe('strip');
    expect(modeFromLegacy(undefined)).toBe('strip');
  });
});
