import { describe, it, expect } from 'vitest';
import { resolveNodeColor, clampNodeSize, headerLabel } from '../src/renderer/modules/whiteboard/node-visual';

describe('node-visual helpers', () => {
  it('resolveNodeColor: preset key, custom hex, fallback', () => {
    expect(resolveNodeColor('yellow')).toEqual({ body: '#fff9c4', head: '#f9a825' });
    expect(resolveNodeColor('#123abc')).toEqual({ body: '#ffffff', head: '#123abc' });
    expect(resolveNodeColor(undefined)).toEqual({ body: '#ffffff', head: '#607d8b' }); // default preset
    expect(resolveNodeColor('not-a-color')).toEqual({ body: '#ffffff', head: '#607d8b' });
  });

  it('clampNodeSize enforces a minimum', () => {
    expect(clampNodeSize(10, 10)).toEqual({ w: 120, h: 64 });
    expect(clampNodeSize(300, 200)).toEqual({ w: 300, h: 200 });
  });

  it('headerLabel prefers the name, else the type', () => {
    expect(headerLabel({ name: 'Finn photo', type: 'image' })).toBe('Finn photo');
    expect(headerLabel({ type: 'file' })).toBe('file');
    expect(headerLabel({ name: '  ', type: 'text' })).toBe('text'); // blank name → type
  });
});
