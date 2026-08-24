/**
 * `window.xls` — GhostExodus's context-bridge surface, lifted VERBATIM from his
 * `src/global.d.ts` (X Listening Station Enterprise v3.4.1).
 *
 * This is the contract his embedded renderer is compiled against, so it is HIS declaration, not a
 * tidied version of it (the `any`s included — narrowing them would make his renderer stop
 * compiling, and his renderer is not ours to edit). Ghost Intel 98 serves this exact shape from
 * its own preload, backed by sender-validated, Tor-gated, encrypt-at-rest handlers: identical
 * surface, entirely different security posture underneath.
 *
 * `createCase` / `switchCase` / `updateCase` / `deleteEmptyCase` are DEAD in v3.4.1 — his preload
 * exposes them, his UI never calls them (his "campaigns" write to `appState.cases`; `cases` is the
 * legacy field name). They are kept here so the surface matches his exactly.
 *
 * Source of truth: vendor/x-listening-station-v3.4.1/src/global.d.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type XlsRelationshipType = 'follower' | 'following';
type XlsPostKind = 'post' | 'reply' | 'repost' | 'comment';

type XlsApi = {
  getState: () => Promise<any>;
  createCase: (input: { name: string; description?: string }) => Promise<any>;
  createCampaign: (input: { name: string; purpose?: string; description?: string }) => Promise<any>;
  switchCampaign: (id: string) => Promise<any>;
  updateCampaign: (id: string, input: { name?: string; purpose?: string; description?: string }) => Promise<any>;
  duplicateCampaign: (id: string) => Promise<any>;
  deleteCampaign: (id: string) => Promise<any>;
  switchCase: (id: string) => Promise<any>;
  updateCase: (id: string, input: { name?: string; description?: string }) => Promise<any>;
  deleteEmptyCase: (id: string) => Promise<any>;
  addProfile: (username: string) => Promise<any>;
  removeProfile: (id: string) => Promise<any>;
  refreshProfile: (id: string) => Promise<{ collected: number; added: number }>;
  setProfileImageMode: (id: string, mode: 'on' | 'off' | 'inherit') => Promise<{ id: string; imageMode: string; effective: boolean }>;
  getPostMediaDataUrl: (postId: string, index: number) => Promise<string | null>;
  getAvatarDataUrl: (username: string, preferredUrl?: string) => Promise<string | null>;
  setCampaignImages: (enabled: boolean) => Promise<{ enabled: boolean }>;
  refreshAll: () => Promise<any>;
  openProfileFeed: (id: string) => Promise<{ opened: boolean }>;
  openThread: (postId: string) => Promise<{ opened: boolean; url: string }>;
  verifyPost: (postId: string) => Promise<{ availability: string; verifiedAt: string; changed?: boolean }>;
  openIdentityProfile: (username: string) => Promise<{ opened: boolean; url: string }>;
  openRelationshipProfile: (relationshipId: string) => Promise<{ opened: boolean; url: string }>;
  extractRelationships: (id: string, relationship: XlsRelationshipType) => Promise<{ collected: number; added: number; relationship: XlsRelationshipType; reachedEnd?: boolean }>;
  exportRelationshipsJson: (filters: any) => Promise<{ canceled: boolean; filePath?: string; count?: number; sha256?: string; checksumPath?: string }>;
  exportRelationshipsCsv: (filters: any) => Promise<{ canceled: boolean; filePath?: string; count?: number; sha256?: string; checksumPath?: string }>;
  clearRelationships: (profileId?: string) => Promise<any>;
  getNetworkAnalysis: () => Promise<any>;
  getCollectionHealth: () => Promise<any>;
  addNote: (postId: string, text: string) => Promise<any>;
  updateNote: (noteId: string, text: string) => Promise<any>;
  removeNote: (noteId: string) => Promise<any>;
  connectX: () => Promise<{ opened: boolean }>;
  getSessionStatus: () => Promise<{ connected: boolean }>;
  clearSession: () => Promise<{ connected: boolean }>;
  toggleTor: (enabled: boolean) => Promise<{ enabled: boolean; connected: boolean; port: number | null; exitIp: string | null; error: string | null; source?: 'integrated' | 'external' | null; bootstrapPercent?: number; bundledAvailable?: boolean }>;
  getTorStatus: () => Promise<{ enabled: boolean; connected: boolean; port: number | null; exitIp: string | null; error: string | null; source?: 'integrated' | 'external' | null; bootstrapPercent?: number; bundledAvailable?: boolean }>;
  savePreset: (preset: any) => Promise<any>;
  removePreset: (id: string) => Promise<any>;
  runPreset: (id: string) => Promise<number>;
  saveSettings: (settings: any) => Promise<any>;
  runArchiveStep: () => Promise<{ type: string; profileId: string; username: string; depth: number; collected: number; added: number }>;
  resetArchiveProgress: () => Promise<any>;
  exportJson: (filters: any) => Promise<{ canceled: boolean; filePath?: string; count?: number; sha256?: string; checksumPath?: string }>;
  exportPdf: (filters: any) => Promise<{ canceled: boolean; filePath?: string; count?: number; sha256?: string; checksumPath?: string }>;
  loadDemo: () => Promise<any>;
  clearCollectedData: () => Promise<any>;
  onStateChanged: (callback: (state: any) => void) => () => void;
  onSweepProgress: (callback: (progress: { message: string; current: number; total: number; running: boolean }) => void) => () => void;
  onBackgroundError: (callback: (payload: { context: string; message: string; observedAt: string }) => void) => () => void;
};

declare global {
  interface Window { xls: XlsApi; }
}

export {};
