export interface SecretBackend {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  delete(k: string): Promise<void>;
}
export interface BgConnSecrets {
  get(pluginId: string, connId: string, field: string): Promise<string | null>;
  set(pluginId: string, connId: string, field: string, value: string): Promise<void>;
  clear(pluginId: string, connId: string, fields: string[]): Promise<void>;
}
const key = (p: string, c: string, f: string): string => `bgconn:${p}:${c}:${f}`;

export function makeBgConnSecrets(backend: SecretBackend): BgConnSecrets {
  return {
    get: (p, c, f) => backend.get(key(p, c, f)),
    set: (p, c, f, v) => backend.set(key(p, c, f), v),
    clear: async (p, c, fields) => { for (const f of fields) await backend.delete(key(p, c, f)); }
  };
}
