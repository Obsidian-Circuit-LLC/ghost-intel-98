import { describe, it, expect } from 'vitest';
import type { ModuleDescriptor } from '../src/renderer/state/registry';
import { buildOsintDirectory } from '../src/renderer/modules/osint-toolkit/directory';

const Dummy = () => null;

function mod(partial: Partial<ModuleDescriptor> & { key: string; title: string }): ModuleDescriptor {
  return {
    glyph: '🔧',
    component: Dummy as unknown as ModuleDescriptor['component'],
    builtin: true,
    ...partial,
  };
}

describe('buildOsintDirectory', () => {
  it('returns [] for empty input', () => {
    expect(buildOsintDirectory([])).toEqual([]);
  });

  it('returns [] when no module is tagged category:osint', () => {
    const mods = [
      mod({ key: 'chess', title: 'Chess' }),
      mod({ key: 'journal', title: 'Journal', subcategory: 'Social Media' }),
    ];
    expect(buildOsintDirectory(mods)).toEqual([]);
  });

  it('excludes non-osint modules while including osint ones', () => {
    const mods = [
      mod({ key: 'chess', title: 'Chess' }),
      mod({ key: 'x', title: 'X', category: 'osint', subcategory: 'Social Media' }),
    ];
    const groups = buildOsintDirectory(mods);
    expect(groups).toEqual([
      { subcategory: 'Social Media', tools: [{ key: 'x', title: 'X', glyph: '🔧' }] },
    ]);
  });

  it('orders groups by fixed priority regardless of input order', () => {
    const mods = [
      mod({ key: 'geoint', title: 'GeoINT', category: 'osint', subcategory: 'Geospatial' }),
      mod({ key: 'x', title: 'X', category: 'osint', subcategory: 'Social Media' }),
    ];
    const groups = buildOsintDirectory(mods);
    expect(groups.map((g) => g.subcategory)).toEqual(['Social Media', 'Geospatial']);
  });

  it('places unknown subcategories after the fixed priority ones, alphabetically, with Other last', () => {
    const mods = [
      mod({ key: 'zeta', title: 'Zeta', category: 'osint', subcategory: 'Zulu' }),
      mod({ key: 'other1', title: 'Other One', category: 'osint' }),
      mod({ key: 'alpha', title: 'Alpha', category: 'osint', subcategory: 'Alpha Group' }),
      mod({ key: 'net', title: 'Net', category: 'osint', subcategory: 'Network / Recon' }),
    ];
    const groups = buildOsintDirectory(mods);
    expect(groups.map((g) => g.subcategory)).toEqual([
      'Network / Recon',
      'Alpha Group',
      'Zulu',
      'Other',
    ]);
  });

  it('sorts tools within a group by title then key', () => {
    const mods = [
      mod({ key: 'b', title: 'Beta', category: 'osint', subcategory: 'Identity' }),
      mod({ key: 'a2', title: 'Alpha', category: 'osint', subcategory: 'Identity' }),
      mod({ key: 'a1', title: 'Alpha', category: 'osint', subcategory: 'Identity' }),
    ];
    const groups = buildOsintDirectory(mods);
    expect(groups).toEqual([
      {
        subcategory: 'Identity',
        tools: [
          { key: 'a1', title: 'Alpha', glyph: '🔧' },
          { key: 'a2', title: 'Alpha', glyph: '🔧' },
          { key: 'b', title: 'Beta', glyph: '🔧' },
        ],
      },
    ]);
  });

  it('buckets missing subcategory under Other', () => {
    const mods = [mod({ key: 'x', title: 'X', category: 'osint' })];
    const groups = buildOsintDirectory(mods);
    expect(groups).toEqual([{ subcategory: 'Other', tools: [{ key: 'x', title: 'X', glyph: '🔧' }] }]);
  });
});
