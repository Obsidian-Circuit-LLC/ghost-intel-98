// HostInfo/RdapInfo are defined canonically in src/shared/post-mvp-types.ts (so the preload api.d.ts
// boundary and the main service share ONE definition). Re-exported here so existing
// `import ... from './types'` call sites in this folder keep working.
export type { RdapInfo, HostInfo } from '../../../shared/post-mvp-types';
