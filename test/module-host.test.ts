// Mock heavy DOM-dependent modules loaded transitively by renderer components.
// Same mock set as register-builtins.test.ts — selectModuleComponent is pure
// but ModuleHost.tsx imports ComingSoon which pulls in the renderer tree.
import { vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));
vi.mock('leaflet', () => {
  const stub = vi.fn(() => ({}));
  return {
    default: {
      divIcon: stub,
      map: stub,
      tileLayer: stub,
      marker: stub,
      layerGroup: stub,
      control: { layers: stub },
    },
  };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { describe, it, expect, beforeEach } from 'vitest';
import { _resetRegistryForTest, registerModule } from '../src/renderer/state/registry';
import { selectModuleComponent } from '../src/renderer/shell/ModuleHost';
import type { ModuleDescriptor } from '../src/renderer/state/registry';

const Dummy = (() => null) as unknown as ModuleDescriptor['component'];

describe('selectModuleComponent', () => {
  beforeEach(() => _resetRegistryForTest());

  it('returns the registered component for a known key', () => {
    registerModule({ key: 'demo', title: 'Demo', glyph: 'd', component: Dummy, builtin: false });
    expect(selectModuleComponent('demo')).toBe(Dummy);
  });

  it('returns null for an unknown key', () => {
    expect(selectModuleComponent('nope')).toBeNull();
  });
});
