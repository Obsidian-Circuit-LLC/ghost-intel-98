// @vitest-environment node
/**
 * User-chosen button colour.
 *
 * GhostExodus, after the embedded station's stylesheet accidentally turned every button in the app
 * gold: "in the settings/theme section if users could select the button color and also hit a button
 * to go back to default, which should be that classic Windows color, and be able to save a color
 * preset… when things look flat, you end up getting lost when you're on a race against time".
 *
 * That accident is being fixed (his sheet is now confined to his module), which takes the look he
 * liked away again — so this gives it back deliberately, on any colour he wants.
 *
 * The contrast rule is the part that matters and the part he already got bitten by: he reported
 * unreadable text in input fields when a dark style landed on light chrome. A colour picker that
 * lets someone choose a dark face and keeps black label text reproduces exactly that. The label ink
 * is therefore DERIVED from the chosen face, never chosen separately.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_BUTTON_FACE,
  buttonInk,
  normalizeButtonColor,
  addColorPreset,
  MAX_COLOR_PRESETS,
} from '../src/shared/theme/button-color';

describe('buttonInk — the label must stay readable on any face', () => {
  it('uses dark ink on a light face', () => {
    expect(buttonInk('#ffffff')).toBe('#000000');
    expect(buttonInk(CLASSIC_BUTTON_FACE)).toBe('#000000'); // classic silver
    expect(buttonInk('#e8c461')).toBe('#000000'); // his gold
  });

  it('uses light ink on a dark face', () => {
    expect(buttonInk('#000000')).toBe('#ffffff');
    expect(buttonInk('#2a1a4a')).toBe('#ffffff'); // an amethyst-ish purple
    expect(buttonInk('#071216')).toBe('#ffffff'); // the dark field colour that caused his complaint
  });

  it('switches ink across the luminance boundary, not at a hue', () => {
    // Mid greys either side of the threshold — a hue-based rule would get one of these wrong.
    expect(buttonInk('#d0d0d0')).toBe('#000000');
    expect(buttonInk('#404040')).toBe('#ffffff');
  });

  it('falls back to dark ink rather than throwing on a malformed colour', () => {
    expect(buttonInk('nonsense')).toBe('#000000');
    expect(buttonInk('')).toBe('#000000');
  });
});

describe('normalizeButtonColor', () => {
  it('accepts a 6-digit hex, lower-casing it', () => {
    expect(normalizeButtonColor('#AABBCC')).toBe('#aabbcc');
  });

  it('expands a 3-digit hex', () => {
    expect(normalizeButtonColor('#abc')).toBe('#aabbcc');
  });

  it('treats empty / invalid as "no override" so the theme keeps its own look', () => {
    for (const bad of ['', '   ', 'red', '#12', 'javascript:alert(1)', '#ggg']) {
      expect(normalizeButtonColor(bad), bad).toBe('');
    }
  });
});

describe('addColorPreset', () => {
  it('saves a colour', () => {
    expect(addColorPreset([], '#e8c461')).toEqual(['#e8c461']);
  });

  it('does not save the same colour twice', () => {
    expect(addColorPreset(['#e8c461'], '#E8C461')).toEqual(['#e8c461']);
  });

  it('keeps the newest first and caps the list', () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_COLOR_PRESETS + 4; i++) {
      list = addColorPreset(list, `#0000${i.toString(16).padStart(2, '0')}`);
    }
    expect(list).toHaveLength(MAX_COLOR_PRESETS);
    // The most recently saved swatch is the first one he sees.
    expect(list[0]).toBe(`#0000${(MAX_COLOR_PRESETS + 3).toString(16).padStart(2, '0')}`);
  });

  it('ignores an invalid colour rather than storing junk', () => {
    expect(addColorPreset(['#e8c461'], 'nope')).toEqual(['#e8c461']);
  });
});
