import { CAPABILITIES, type Capability, type PluginManifest, type PluginModuleDecl } from '../../shared/plugin-types';

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ID_RE = /^[a-z][a-z0-9-]{2,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SUB_RE = /^[a-z0-9-]{1,32}$/;
const CAP_SET = new Set<string>(CAPABILITIES);

function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) throw new ManifestError(`manifest.${k} must be a non-empty string`);
  return v;
}

export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ManifestError('manifest must be a JSON object');
  }
  const o = raw as Record<string, unknown>;

  const id = str(o, 'id');
  if (!ID_RE.test(id)) throw new ManifestError(`manifest.id "${id}" must match ${ID_RE}`);

  const name = str(o, 'name');
  const version = str(o, 'version');
  if (!SEMVER_RE.test(version)) throw new ManifestError(`manifest.version "${version}" is not semver`);

  if (!Number.isInteger(o['targetApiVersion'])) throw new ManifestError('manifest.targetApiVersion must be an integer');
  const targetApiVersion = o['targetApiVersion'] as number;

  if (!Array.isArray(o['modules']) || o['modules'].length === 0) {
    throw new ManifestError('manifest.modules must be a non-empty array');
  }
  const modules: PluginModuleDecl[] = (o['modules'] as unknown[]).map((mu, i) => {
    if (typeof mu !== 'object' || mu === null) throw new ManifestError(`manifest.modules[${i}] must be an object`);
    const mo = mu as Record<string, unknown>;
    const key = str(mo, 'key');
    const [ns, sub, ...rest] = key.split(':');
    if (rest.length > 0 || ns !== id || !SUB_RE.test(sub ?? '')) {
      throw new ManifestError(`manifest.modules[${i}].key "${key}" must be "${id}:<sub>" with sub matching ${SUB_RE}`);
    }
    return { key, title: str(mo, 'title'), glyph: str(mo, 'glyph') };
  });

  if (!Array.isArray(o['capabilities'])) throw new ManifestError('manifest.capabilities must be an array');
  const capabilities: Capability[] = (o['capabilities'] as unknown[]).map((c, i) => {
    if (typeof c !== 'string' || !CAP_SET.has(c)) throw new ManifestError(`manifest.capabilities[${i}] "${String(c)}" is not a known capability`);
    return c as Capability;
  });

  const main = str(o, 'main');
  const renderer = str(o, 'renderer');

  return { id, name, version, targetApiVersion, modules, capabilities, main, renderer };
}
