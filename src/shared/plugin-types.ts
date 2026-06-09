/** Shared between main, preload, and renderer. The frozen v1 plugin contract surface. */

export const CAPABILITIES = [
  'egress', 'secrets', 'case-storage', 'plugin-storage', 'entity-registry', 'timeline'
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface PluginModuleDecl {
  key: string; // `<id>:<sub>`, namespaced
  title: string;
  glyph: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  targetApiVersion: number;
  modules: PluginModuleDecl[];
  capabilities: Capability[];
  main: string;
  renderer: string;
}

/** Returned to the renderer by `plugins:listVerified`. */
export interface VerifiedPluginInfo {
  id: string;
  name: string;
  version: string;
  modules: PluginModuleDecl[];
  renderer: string; // relative path, e.g. 'renderer.js'
}

export interface PluginStatus {
  id: string;
  loaded: boolean;
  error?: string;
}
