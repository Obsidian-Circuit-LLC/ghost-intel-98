/**
 * `window.xls` channel map — GhostExodus's surface, namespaced.
 *
 * Every entry is one of his preload methods mapped to `xls:` + HIS channel name. The namespace is
 * not cosmetic: his bare `cases:create` / `cases:update` would collide with Ghost Intel 98's own
 * case-manager channels, and a collision here means his renderer silently driving our case
 * manager. Keeping his name under the prefix is what lets his handlers be transcribed rather than
 * re-mapped, and keeps a diff against his source readable.
 *
 * Generated from vendor/x-listening-station-v3.4.1/electron/preload.cjs and held to it by
 * test/xls-embed-bridge-parity.test.ts, which fails if this map gains or loses a method.
 *
 * `createCase` / `switchCase` / `updateCase` / `deleteEmptyCase` are dead in v3.4.1 — exposed by
 * his preload, never called by his UI. They are here because the surface must match his exactly.
 */
export const XLS_CHANNELS = {
  getState: 'xls:state:get',
  createCase: 'xls:cases:create',
  createCampaign: 'xls:campaigns:create',
  switchCampaign: 'xls:campaigns:switch',
  updateCampaign: 'xls:campaigns:update',
  duplicateCampaign: 'xls:campaigns:duplicate',
  deleteCampaign: 'xls:campaigns:delete',
  switchCase: 'xls:cases:switch',
  updateCase: 'xls:cases:update',
  deleteEmptyCase: 'xls:cases:delete-empty',
  addProfile: 'xls:profiles:add',
  removeProfile: 'xls:profiles:remove',
  refreshProfile: 'xls:profiles:refresh',
  setProfileImageMode: 'xls:profiles:set-image-mode',
  getPostMediaDataUrl: 'xls:media:get-data-url',
  getAvatarDataUrl: 'xls:avatars:get-data-url',
  setCampaignImages: 'xls:media:set-campaign-enabled',
  refreshAll: 'xls:profiles:refresh-all',
  openProfileFeed: 'xls:feed:open-profile',
  openThread: 'xls:feed:open-thread',
  verifyPost: 'xls:feed:verify-post',
  openIdentityProfile: 'xls:identity:open-profile',
  openRelationshipProfile: 'xls:relationships:open-profile',
  extractRelationships: 'xls:relationships:extract',
  exportRelationshipsJson: 'xls:relationships:export-json',
  exportRelationshipsCsv: 'xls:relationships:export-csv',
  clearRelationships: 'xls:relationships:clear',
  getNetworkAnalysis: 'xls:analysis:network',
  getCollectionHealth: 'xls:analysis:health',
  addNote: 'xls:notes:add',
  updateNote: 'xls:notes:update',
  removeNote: 'xls:notes:remove',
  connectX: 'xls:session:connect',
  getSessionStatus: 'xls:session:status',
  clearSession: 'xls:session:clear',
  toggleTor: 'xls:tor:toggle',
  getTorStatus: 'xls:tor:status',
  savePreset: 'xls:presets:save',
  removePreset: 'xls:presets:remove',
  runPreset: 'xls:presets:run',
  saveSettings: 'xls:settings:save',
  runArchiveStep: 'xls:archive:run-step',
  resetArchiveProgress: 'xls:archive:reset-progress',
  exportJson: 'xls:export:json',
  exportPdf: 'xls:export:pdf',
  loadDemo: 'xls:demo:load',
  clearCollectedData: 'xls:data:clear-posts',
} as const;

/** His three main→renderer pushes: the whole-state snapshot, sweep progress, background errors. */
export const XLS_EVENT_CHANNELS = {
  onStateChanged: 'xls:state:changed',
  onSweepProgress: 'xls:sweep:progress',
  onBackgroundError: 'xls:app:background-error',
} as const;

export type XlsChannel = (typeof XLS_CHANNELS)[keyof typeof XLS_CHANNELS];
export type XlsEventChannel = (typeof XLS_EVENT_CHANNELS)[keyof typeof XLS_EVENT_CHANNELS];
