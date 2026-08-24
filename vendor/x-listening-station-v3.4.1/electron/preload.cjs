const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xls', {
  getState: () => ipcRenderer.invoke('state:get'),
  createCase: (input) => ipcRenderer.invoke('cases:create', input),
  createCampaign: (input) => ipcRenderer.invoke('campaigns:create', input),
  switchCampaign: (id) => ipcRenderer.invoke('campaigns:switch', id),
  updateCampaign: (id, input) => ipcRenderer.invoke('campaigns:update', id, input),
  duplicateCampaign: (id) => ipcRenderer.invoke('campaigns:duplicate', id),
  deleteCampaign: (id) => ipcRenderer.invoke('campaigns:delete', id),
  switchCase: (id) => ipcRenderer.invoke('cases:switch', id),
  updateCase: (id, input) => ipcRenderer.invoke('cases:update', id, input),
  deleteEmptyCase: (id) => ipcRenderer.invoke('cases:delete-empty', id),
  addProfile: (username) => ipcRenderer.invoke('profiles:add', username),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  refreshProfile: (id) => ipcRenderer.invoke('profiles:refresh', id),
  setProfileImageMode: (id, mode) => ipcRenderer.invoke('profiles:set-image-mode', id, mode),
  getPostMediaDataUrl: (postId, index) => ipcRenderer.invoke('media:get-data-url', postId, index),
  getAvatarDataUrl: (username, preferredUrl) => ipcRenderer.invoke('avatars:get-data-url', username, preferredUrl),
  setCampaignImages: (enabled) => ipcRenderer.invoke('media:set-campaign-enabled', enabled),
  refreshAll: () => ipcRenderer.invoke('profiles:refresh-all'),
  openProfileFeed: (id) => ipcRenderer.invoke('feed:open-profile', id),
  openThread: (postId) => ipcRenderer.invoke('feed:open-thread', postId),
  verifyPost: (postId) => ipcRenderer.invoke('feed:verify-post', postId),
  openIdentityProfile: (username) => ipcRenderer.invoke('identity:open-profile', username),
  openRelationshipProfile: (relationshipId) => ipcRenderer.invoke('relationships:open-profile', relationshipId),
  extractRelationships: (id, relationship) => ipcRenderer.invoke('relationships:extract', id, relationship),
  exportRelationshipsJson: (filters) => ipcRenderer.invoke('relationships:export-json', filters),
  exportRelationshipsCsv: (filters) => ipcRenderer.invoke('relationships:export-csv', filters),
  clearRelationships: (profileId) => ipcRenderer.invoke('relationships:clear', profileId),
  getNetworkAnalysis: () => ipcRenderer.invoke('analysis:network'),
  getCollectionHealth: () => ipcRenderer.invoke('analysis:health'),
  addNote: (postId, text) => ipcRenderer.invoke('notes:add', postId, text),
  updateNote: (noteId, text) => ipcRenderer.invoke('notes:update', noteId, text),
  removeNote: (noteId) => ipcRenderer.invoke('notes:remove', noteId),
  connectX: () => ipcRenderer.invoke('session:connect'),
  getSessionStatus: () => ipcRenderer.invoke('session:status'),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  toggleTor: (enabled) => ipcRenderer.invoke('tor:toggle', enabled),
  getTorStatus: () => ipcRenderer.invoke('tor:status'),
  savePreset: (preset) => ipcRenderer.invoke('presets:save', preset),
  removePreset: (id) => ipcRenderer.invoke('presets:remove', id),
  runPreset: (id) => ipcRenderer.invoke('presets:run', id),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  runArchiveStep: () => ipcRenderer.invoke('archive:run-step'),
  resetArchiveProgress: () => ipcRenderer.invoke('archive:reset-progress'),
  exportJson: (filters) => ipcRenderer.invoke('export:json', filters),
  exportPdf: (filters) => ipcRenderer.invoke('export:pdf', filters),
  loadDemo: () => ipcRenderer.invoke('demo:load'),
  clearCollectedData: () => ipcRenderer.invoke('data:clear-posts'),
  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
  onSweepProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('sweep:progress', handler);
    return () => ipcRenderer.removeListener('sweep:progress', handler);
  },
  onBackgroundError: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:background-error', handler);
    return () => ipcRenderer.removeListener('app:background-error', handler);
  },
});
