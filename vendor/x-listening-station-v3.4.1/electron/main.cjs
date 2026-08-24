const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
} = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nodeNet = require('node:net');
const { spawn } = require('node:child_process');
const { sha256, canonicalPostEvidence, canonicalRelationshipEvidence, extractEntities, computeNetworkAnalysis, deriveCollectionHealth } = require('./enterprise.cjs');

const X_PARTITION = 'persist:x-listening-station';
const APP_TITLE = 'CYBERVS DOMINATVS X LISTENING STATION';
const APP_BYLINE = 'by GhostExodus';
const LEGACY_USER_DATA_NAME = 'X Listening Station';
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// Preserve the existing local archive and authenticated X session after rebranding.
app.setName(APP_TITLE);
const appDataPath = app.getPath('appData');
const userDataCandidates = [
  path.join(appDataPath, LEGACY_USER_DATA_NAME),
  path.join(appDataPath, 'x-listening-station'),
];
const legacyUserDataPath = userDataCandidates.find((candidate) =>
  fsSync.existsSync(path.join(candidate, 'station-state.json')) ||
  fsSync.existsSync(path.join(candidate, 'Partitions'))
) || userDataCandidates[0];
fsSync.mkdirSync(legacyUserDataPath, { recursive: true });
app.setPath('userData', legacyUserDataPath);

const STARTUP_LOG_PATH = path.join(legacyUserDataPath, 'startup.log');
function startupLog(message, error = null) {
  try {
    const detail = error ? ` | ${error instanceof Error ? (error.stack || error.message) : String(error)}` : '';
    fsSync.appendFileSync(STARTUP_LOG_PATH, `[${new Date().toISOString()}] ${message}${detail}\n`, 'utf8');
  } catch {
    // Never let diagnostics prevent application startup.
  }
}
startupLog(`Process started. Version ${app.getVersion()} packaged=${app.isPackaged}`);
try { app.setAppUserModelId('com.xlisteningstation.desktop'); } catch (error) { startupLog('Could not set AppUserModelId.', error); }
process.on('uncaughtExceptionMonitor', (error, origin) => startupLog(`Uncaught exception (${origin})`, error));
process.on('unhandledRejection', (reason) => startupLog('Unhandled promise rejection', reason));

let mainWindow = null;
let appState = null;
let statePath = '';
let saveQueue = Promise.resolve();
let autoSweepTimer = null;
let archiveTimer = null;
let sweepRunning = false;
let torStatusTimer = null;
const mediaPolicyByWebContents = new Map();
let remoteSessionConfigured = false;
let torRuntime = { connected: false, port: null, exitIp: null, lastCheckedAt: null, error: null, source: null, bootstrapPercent: 0, bundledAvailable: false };
let managedTorProcess = null;
let managedTorPort = null;
let torConnectPromise = null;
let avatarRepairRunning = false;
let avatarRepairTimer = null;

const TOR_CHECK_URL = 'https://check.torproject.org/api/ip';
const EXTERNAL_TOR_PORTS = [9050, 9150];
const INTEGRATED_TOR_PORT_START = 19050;

function runtimeIconPath() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.ico')
    : path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fsSync.existsSync(candidate) ? candidate : path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

const nowIso = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultState() {
  const defaultCaseId = 'case-default';
  const timestamp = nowIso();
  return {
    schemaVersion: 9,
    cases: [{ id: defaultCaseId, name: 'Primary Campaign', purpose: 'General intelligence monitoring', description: 'Migrated/default campaign workspace', createdAt: timestamp, updatedAt: timestamp }],
    activeCaseId: defaultCaseId,
    profiles: [],
    posts: [],
    relationships: [],
    notes: [],
    presets: [],
    matches: [],
    entities: [],
    profileSnapshots: [],
    changeEvents: [],
    collectionRuns: [],
    networkSnapshots: [],
    networkEvents: [],
    settings: {
      autoSweep: false,
      intervalMinutes: 30,
      scrollPasses: 5,
      scrollDelayMs: 1100,
      retentionLimit: 50000,
      collectReplies: true,
      collectReposts: false,
      collectComments: false,
      collectImages: true,
      commentThreadsPerSweep: 3,
      commentScrollPasses: 2,
      relationshipScrollPasses: 8,
      networkStagnationLimit: 7,
      networkSnapshotLimit: 20,
      archiveEnabled: false,
      archiveIntervalMinutes: 240,
      archivePostStep: 2,
      archivePostMaxPasses: 40,
      archiveFollowers: false,
      archiveFollowing: false,
      archiveRelationshipStep: 3,
      archiveRelationshipMaxPasses: 160,
    },
    campaignSettings: {},
    tor: { enabled: false, preferredPort: null },
    archive: {
      lastCycleAt: null,
      nextOperationIndex: 0,
      cyclesCompleted: 0,
      profiles: {},
    },
    avatarRepair: {
      version: 1,
      pending: false,
      migratedAt: null,
      lastAttemptAt: null,
      completedAt: null,
      lastError: null,
    },
    lastSweepAt: null,
  };
}

function normalizeUsername(input) {
  const value = String(input || '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
    throw new Error('Enter a valid X username containing letters, numbers, or underscores.');
  }
  return value;
}

function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const cases = Array.isArray(raw.cases) && raw.cases.length
    ? raw.cases.filter((item) => item && item.id).map((item) => ({
        id: String(item.id),
        name: String(item.name || 'Investigation'),
        purpose: String(item.purpose || item.description || ''),
        description: String(item.description || ''),
        createdAt: String(item.createdAt || nowIso()),
        updatedAt: String(item.updatedAt || item.createdAt || nowIso()),
      }))
    : base.cases;
  const validCaseIds = new Set(cases.map((item) => item.id));
  const activeCaseId = validCaseIds.has(raw.activeCaseId) ? raw.activeCaseId : cases[0].id;
  const fallbackCaseId = cases[0].id;
  const attachCase = (item) => ({ ...item, caseId: validCaseIds.has(item?.caseId) ? item.caseId : fallbackCaseId });

  const state = {
    ...base,
    ...raw,
    schemaVersion: base.schemaVersion,
    cases,
    activeCaseId,
    profiles: Array.isArray(raw.profiles) ? raw.profiles.map((profile) => attachCase({ ...profile, imageMode: ['on','off','inherit'].includes(profile?.imageMode) ? profile.imageMode : 'inherit' })) : [],
    posts: Array.isArray(raw.posts)
      ? raw.posts.map((post) => attachCase({
          ...post,
          kind: post.kind || (post.isReply ? 'reply' : 'post'),
          isReply: post.kind ? post.kind === 'reply' || post.kind === 'comment' : Boolean(post.isReply),
          sourceUsername: post.sourceUsername || post.username || '',
          parentPostId: post.parentPostId || null,
          firstObservedAt: post.firstObservedAt || post.collectedAt || nowIso(),
          lastObservedAt: post.lastObservedAt || post.collectedAt || nowIso(),
          collectionMethod: post.collectionMethod || 'authenticated_browser',
          versionHistory: Array.isArray(post.versionHistory) ? post.versionHistory : [],
          availability: post.availability || 'unknown',
          verifiedAt: post.verifiedAt || null,
          mediaEvidence: Array.isArray(post.mediaEvidence) ? post.mediaEvidence : [],
          evidenceHash: post.evidenceHash || sha256(canonicalPostEvidence(post)),
        }))
      : [],
    relationships: Array.isArray(raw.relationships)
      ? raw.relationships.map((row) => attachCase({
          ...row,
          firstObservedAt: row.firstObservedAt || row.collectedAt || nowIso(),
          lastObservedAt: row.lastObservedAt || row.collectedAt || nowIso(),
          observedCount: Math.max(1, Number(row.observedCount) || 1),
          evidenceHash: row.evidenceHash || sha256(canonicalRelationshipEvidence(row)),
        }))
      : [],
    notes: Array.isArray(raw.notes)
      ? raw.notes.filter((note) => note && note.id && note.postId && String(note.text || '').trim()).map((note) => attachCase({
          id: String(note.id),
          postId: String(note.postId),
          text: String(note.text),
          createdAt: String(note.createdAt || note.updatedAt || nowIso()),
          updatedAt: String(note.updatedAt || note.createdAt || nowIso()),
        }))
      : [],
    presets: Array.isArray(raw.presets) ? raw.presets.map(attachCase) : [],
    matches: Array.isArray(raw.matches) ? raw.matches.map(attachCase) : [],
    entities: Array.isArray(raw.entities) ? raw.entities.map(attachCase) : [],
    profileSnapshots: Array.isArray(raw.profileSnapshots) ? raw.profileSnapshots.map(attachCase) : [],
    changeEvents: Array.isArray(raw.changeEvents) ? raw.changeEvents.map(attachCase) : [],
    collectionRuns: Array.isArray(raw.collectionRuns) ? raw.collectionRuns.map(attachCase).slice(-2000) : [],
    networkSnapshots: Array.isArray(raw.networkSnapshots) ? raw.networkSnapshots.map(attachCase) : [],
    networkEvents: Array.isArray(raw.networkEvents) ? raw.networkEvents.map(attachCase).slice(-5000) : [],
    settings: {
      ...base.settings,
      ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
    },
    campaignSettings: {},
    tor: {
      enabled: Boolean(raw.tor?.enabled),
      preferredPort: Number(raw.tor?.preferredPort) || null,
    },
    archive: {
      ...base.archive,
      ...(raw.archive && typeof raw.archive === 'object' ? raw.archive : {}),
      profiles: raw.archive && typeof raw.archive.profiles === 'object' && raw.archive.profiles
        ? raw.archive.profiles
        : {},
    },
    avatarRepair: {
      ...base.avatarRepair,
      ...(raw.avatarRepair && typeof raw.avatarRepair === 'object' ? raw.avatarRepair : {}),
      version: Math.max(0, Number(raw.avatarRepair?.version) || 0),
      pending: Boolean(raw.avatarRepair?.pending),
    },
  };
  for (const campaign of cases) {
    const prior = raw.campaignSettings && typeof raw.campaignSettings === 'object' ? raw.campaignSettings[campaign.id] : null;
    state.campaignSettings[campaign.id] = {
      ...base.settings,
      ...(prior && typeof prior === 'object' ? prior : (campaign.id === activeCaseId ? state.settings : {})),
      collectImages: prior?.collectImages !== false && (prior?.collectImages !== undefined ? Boolean(prior.collectImages) : state.settings.collectImages !== false),
    };
  }
  state.settings = { ...base.settings, ...(state.campaignSettings[activeCaseId] || state.settings) };
  return state;
}

async function migrateAvatarDataIfNeeded(rawState) {
  const priorSchemaVersion = Math.max(0, Number(rawState?.schemaVersion) || 0);
  if (priorSchemaVersion >= 9 && Number(appState?.avatarRepair?.version) >= 1) return false;

  startupLog(`Migrating avatar data from schema ${priorSchemaVersion} to schema 9.`);
  const oldProfileAvatarByUsername = new Map();
  const oldProfileAvatarById = new Map();
  for (const rawProfile of Array.isArray(rawState?.profiles) ? rawState.profiles : []) {
    const username = String(rawProfile?.username || '').replace(/^@/, '').trim().toLowerCase();
    const avatar = String(rawProfile?.avatar || '').trim();
    if (username && avatar) oldProfileAvatarByUsername.set(username, avatar);
    if (rawProfile?.id && avatar) oldProfileAvatarById.set(String(rawProfile.id), avatar);
  }

  // v3.4.0 could accidentally select the signed-in account avatar from X's global navigation.
  // Prefer an independently observed avatar from a tweet/network row for the same username,
  // otherwise clear the profile avatar so it can be re-read from the target profile header.
  for (const profile of appState.profiles) {
    const key = String(profile.username || '').replace(/^@/, '').toLowerCase();
    const badUrl = oldProfileAvatarByUsername.get(key) || String(profile.avatar || '');
    const relationshipCandidate = [...appState.relationships]
      .filter((row) => String(row.username || '').replace(/^@/, '').toLowerCase() === key && row.avatar && String(row.avatar) !== badUrl)
      .sort((a, b) => String(b.lastObservedAt || b.collectedAt || '').localeCompare(String(a.lastObservedAt || a.collectedAt || '')))[0]?.avatar;
    const postCandidate = [...appState.posts]
      .filter((post) => String(post.username || '').replace(/^@/, '').toLowerCase() === key && post.avatar && String(post.avatar) !== badUrl)
      .sort((a, b) => String(b.lastObservedAt || b.collectedAt || '').localeCompare(String(a.lastObservedAt || a.collectedAt || '')))[0]?.avatar;
    profile.avatar = String(relationshipCandidate || postCandidate || '');
  }

  // Remove only inherited copies of the known-bad target avatar. Correct article/network avatars remain intact.
  for (const post of appState.posts) {
    const key = String(post.username || '').replace(/^@/, '').toLowerCase();
    const badUrl = oldProfileAvatarByUsername.get(key);
    if (badUrl && String(post.avatar || '') === badUrl) post.avatar = '';
  }
  for (const row of appState.relationships) {
    const key = String(row.username || '').replace(/^@/, '').toLowerCase();
    const badUrl = oldProfileAvatarByUsername.get(key);
    if (badUrl && String(row.avatar || '') === badUrl) row.avatar = '';
  }
  for (const snapshot of appState.profileSnapshots) {
    const badUrl = oldProfileAvatarById.get(String(snapshot.profileId || ''));
    if (badUrl && String(snapshot.avatar || '') === badUrl) snapshot.avatar = '';
  }

  try {
    await fs.rm(path.join(app.getPath('userData'), 'avatar-cache'), { recursive: true, force: true });
  } catch (error) {
    startupLog('Could not remove legacy avatar cache during migration.', error);
  }
  avatarDataUrlMemory.clear();
  appState.avatarRepair = {
    version: 1,
    pending: true,
    migratedAt: nowIso(),
    lastAttemptAt: null,
    completedAt: null,
    lastError: null,
  };
  await persistState();
  startupLog('Legacy avatar cache invalidated; live target-avatar repair is pending.');
  return true;
}

async function loadState() {
  statePath = path.join(app.getPath('userData'), 'station-state.json');
  try {
    const text = await fs.readFile(statePath, 'utf8');
    const rawState = JSON.parse(text);
    appState = normalizeState(rawState);
    await migrateAvatarDataIfNeeded(rawState);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error('Could not read saved state:', error);
    }
    appState = defaultState();
    await persistState();
  }
}

function persistState() {
  const snapshot = JSON.stringify(appState, null, 2);
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(statePath, snapshot, 'utf8');
    });
  return saveQueue;
}

function activeCaseId() {
  return appState?.activeCaseId || appState?.cases?.[0]?.id || 'case-default';
}

function activeSettings() {
  const caseId = activeCaseId();
  return appState?.campaignSettings?.[caseId] || appState?.settings || defaultState().settings;
}

function syncActiveSettings(caseId = activeCaseId()) {
  if (!appState.campaignSettings || typeof appState.campaignSettings !== 'object') appState.campaignSettings = {};
  if (!appState.campaignSettings[caseId]) appState.campaignSettings[caseId] = { ...defaultState().settings, ...appState.settings };
  appState.settings = { ...defaultState().settings, ...appState.campaignSettings[caseId] };
  return appState.settings;
}

function effectiveImageCollection(profile) {
  if (profile?.imageMode === 'on') return true;
  if (profile?.imageMode === 'off') return false;
  return activeSettings().collectImages !== false;
}

function isActiveCase(item) {
  return item && item.caseId === activeCaseId();
}

function getClientState() {
  const caseId = activeCaseId();
  return {
    ...appState,
    settings: { ...activeSettings() },
    tor: { ...appState.tor, ...torRuntime, enabled: Boolean(appState.tor?.enabled) },
    profiles: appState.profiles.filter((item) => item.caseId === caseId),
    posts: appState.posts.filter((item) => item.caseId === caseId),
    relationships: appState.relationships.filter((item) => item.caseId === caseId),
    notes: appState.notes.filter((item) => item.caseId === caseId),
    presets: appState.presets.filter((item) => item.caseId === caseId),
    matches: appState.matches.filter((item) => item.caseId === caseId),
    entities: appState.entities.filter((item) => item.caseId === caseId),
    profileSnapshots: appState.profileSnapshots.filter((item) => item.caseId === caseId),
    changeEvents: appState.changeEvents.filter((item) => item.caseId === caseId).slice(-2000),
    collectionRuns: appState.collectionRuns.filter((item) => item.caseId === caseId).slice(-1000),
    networkSnapshots: appState.networkSnapshots.filter((item) => item.caseId === caseId).slice(-200),
    networkEvents: appState.networkEvents.filter((item) => item.caseId === caseId).slice(-2000),
  };
}

function trimEnterpriseLogs() {
  appState.collectionRuns = appState.collectionRuns.slice(-2000);
  appState.changeEvents = appState.changeEvents.slice(-5000);
  appState.networkEvents = appState.networkEvents.slice(-5000);
  const snapshotLimit = Math.max(5, Math.min(100, Number(appState.settings.networkSnapshotLimit) || 20));
  const grouped = new Map();
  for (const snap of appState.networkSnapshots) {
    const key = `${snap.caseId}:${snap.profileId}:${snap.relationship}`;
    const rows = grouped.get(key) || [];
    rows.push(snap);
    grouped.set(key, rows);
  }
  const retained = [];
  for (const rows of grouped.values()) {
    rows.sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
    retained.push(...rows.slice(0, snapshotLimit));
  }
  appState.networkSnapshots = retained;
}

function startCollectionRun(profile, operation, requestedPasses = 0) {
  const run = {
    id: makeId(),
    caseId: profile.caseId || activeCaseId(),
    profileId: profile.id,
    username: profile.username,
    operation,
    startedAt: nowIso(),
    completedAt: null,
    requestedPasses,
    passesCompleted: 0,
    observed: 0,
    added: 0,
    duplicates: 0,
    stopReason: null,
    reachedEnd: false,
    frontierUsernames: [],
    status: 'running',
    error: null,
  };
  appState.collectionRuns.push(run);
  trimEnterpriseLogs();
  return run;
}

function finishCollectionRun(run, details = {}) {
  Object.assign(run, {
    completedAt: nowIso(),
    status: details.error ? 'error' : 'complete',
    ...details,
  });
  run.observed = Math.max(0, Number(run.observed) || 0);
  run.added = Math.max(0, Number(run.added) || 0);
  run.duplicates = Math.max(0, run.observed - run.added);
  trimEnterpriseLogs();
  return run;
}

function addChangeEvent(profile, type, summary, details = {}) {
  appState.changeEvents.push({
    id: makeId(),
    caseId: profile?.caseId || activeCaseId(),
    profileId: profile?.id || null,
    sourceUsername: profile?.username || null,
    type,
    summary,
    details,
    observedAt: nowIso(),
  });
  trimEnterpriseLogs();
}

function indexEntitiesForPost(post) {
  const caseId = post.caseId || activeCaseId();
  const found = extractEntities(post.text || '');
  for (const entity of found) {
    const key = `${caseId}:${entity.type}:${entity.normalizedValue}`;
    let existing = appState.entities.find((item) => `${item.caseId}:${item.type}:${item.normalizedValue}` === key);
    if (!existing) {
      existing = {
        id: makeId(),
        caseId,
        type: entity.type,
        value: entity.value,
        normalizedValue: entity.normalizedValue,
        postIds: [],
        sourceUsernames: [],
        firstObservedAt: post.firstObservedAt || post.collectedAt || nowIso(),
        lastObservedAt: post.lastObservedAt || post.collectedAt || nowIso(),
        count: 0,
      };
      appState.entities.push(existing);
    }
    if (!existing.postIds.includes(post.id)) {
      existing.postIds.push(post.id);
      if (existing.postIds.length > 1000) existing.postIds = existing.postIds.slice(-1000);
      existing.count = Math.max(Number(existing.count) || 0, 0) + 1;
    }
    if (post.username && !existing.sourceUsernames.includes(post.username)) existing.sourceUsernames.push(post.username);
    existing.lastObservedAt = post.lastObservedAt || post.collectedAt || nowIso();
  }
}

function updateProfileMetadata(profile, metadata) {
  if (!metadata || typeof metadata !== 'object') return;
  const fields = ['displayName', 'bio', 'avatar', 'location', 'website'];
  const before = {};
  let changed = false;
  for (const field of fields) {
    const next = String(metadata[field] || '').trim();
    const previous = String(profile[field] || '').trim();
    if (next && next !== previous) {
      before[field] = previous;
      profile[field] = next;
      changed = true;
    }
  }
  const snapshot = {
    id: makeId(),
    caseId: profile.caseId || activeCaseId(),
    profileId: profile.id,
    username: profile.username,
    displayName: profile.displayName || '',
    bio: profile.bio || '',
    avatar: profile.avatar || '',
    location: profile.location || '',
    website: profile.website || '',
    capturedAt: nowIso(),
  };
  const previousSnapshot = appState.profileSnapshots
    .filter((item) => item.profileId === profile.id && item.caseId === snapshot.caseId)
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))[0];
  const signature = sha256({ displayName: snapshot.displayName, bio: snapshot.bio, avatar: snapshot.avatar, location: snapshot.location, website: snapshot.website });
  snapshot.signature = signature;
  if (!previousSnapshot || previousSnapshot.signature !== signature) {
    appState.profileSnapshots.push(snapshot);
    if (previousSnapshot || changed) addChangeEvent(profile, 'profile_change', `Profile metadata changed for @${profile.username}.`, { before, after: metadata });
  }
}

function recordNetworkSnapshot(profile, relationship, rows, meta, addedUsernames = []) {
  const caseId = profile.caseId || activeCaseId();
  const previous = appState.networkSnapshots
    .filter((item) => item.caseId === caseId && item.profileId === profile.id && item.relationship === relationship)
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))[0];
  const observedUsernames = [...new Set(rows.map((row) => String(row.username || '').toLowerCase()).filter(Boolean))];
  const snapshot = {
    id: makeId(),
    caseId,
    profileId: profile.id,
    sourceUsername: profile.username,
    relationship,
    capturedAt: nowIso(),
    requestedPasses: Number(meta?.requestedPasses) || 0,
    passesCompleted: Number(meta?.passesCompleted) || 0,
    reachedEnd: Boolean(meta?.reachedEnd),
    observedCount: observedUsernames.length,
    observedUsernames: observedUsernames.slice(0, 30000),
    frontierUsernames: Array.isArray(meta?.frontierUsernames) ? meta.frontierUsernames.slice(-12) : [],
  };
  appState.networkSnapshots.push(snapshot);
  for (const username of addedUsernames) {
    appState.networkEvents.push({
      id: makeId(), caseId, profileId: profile.id, sourceUsername: profile.username,
      relationship, username, eventType: 'newly_observed', observedAt: snapshot.capturedAt,
      confidence: 'observed', snapshotId: snapshot.id,
    });
  }
  if (previous && snapshot.passesCompleted >= Number(previous.passesCompleted || 0) && snapshot.observedCount >= Math.max(10, Math.floor(Number(previous.observedCount || 0) * 0.85))) {
    const current = new Set(observedUsernames);
    const missing = (previous.observedUsernames || []).filter((username) => !current.has(username)).slice(0, 500);
    for (const username of missing) {
      appState.networkEvents.push({
        id: makeId(), caseId, profileId: profile.id, sourceUsername: profile.username,
        relationship, username, eventType: 'not_seen_latest', observedAt: snapshot.capturedAt,
        confidence: 'unconfirmed', snapshotId: snapshot.id,
      });
    }
  }
  trimEnterpriseLogs();
  return snapshot;
}

function emitState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:changed', getClientState());
  }
}

function emitProgress(message, current = 0, total = 0) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sweep:progress', {
      message,
      current,
      total,
      running: sweepRunning,
    });
  }
}

function emitBackgroundError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  startupLog(`Background task failed: ${context}`, error);
  console.error(`${context} failed:`, error);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('app:background-error', {
      context,
      message,
      observedAt: nowIso(),
    });
  }
}

function runBackgroundTask(context, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => emitBackgroundError(context, error));
}

function assertTrustedSender(event) {
  const url = event.senderFrame?.url || event.sender.getURL();
  const allowed = DEV_URL
    ? url.startsWith(DEV_URL)
    : url.startsWith('file://');
  if (!allowed) throw new Error('Blocked IPC call from an untrusted page.');
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event);
    return fn(...args);
  });
}

function configureRemoteSession(ses) {
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (!remoteSessionConfigured) {
    remoteSessionConfigured = true;
    ses.webRequest.onBeforeRequest({ urls: ['*://pbs.twimg.com/*'] }, (details, callback) => {
      const policy = mediaPolicyByWebContents.get(details.webContentsId);
      const isTweetMedia = /pbs\.twimg\.com\/(?:media|ext_tw_video_thumb)\//i.test(details.url || '');
      callback({ cancel: policy === false && isTweetMedia });
    });
  }
}

function testTcpPort(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = nodeNet.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function findFileRecursiveSync(root, filename) {
  if (!root || !fsSync.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fsSync.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === filename.toLowerCase()) return full;
    }
  }
  return null;
}

function bundledTorRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tor-bundle')
    : path.join(__dirname, '..', 'vendor', 'tor-bundle');
}

function bundledTorExecutable() {
  return findFileRecursiveSync(bundledTorRoot(), 'tor.exe');
}

function bundledTorGeoIp(name) {
  return findFileRecursiveSync(bundledTorRoot(), name);
}

async function findAvailableLocalPort(start = INTEGRATED_TOR_PORT_START, end = INTEGRATED_TOR_PORT_START + 50) {
  for (let port = start; port <= end; port += 1) {
    const available = await new Promise((resolve) => {
      const server = nodeNet.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free local SOCKS port was available for the integrated Tor runtime.');
}

async function applyXProxy(config) {
  const ses = session.fromPartition(X_PARTITION);
  configureRemoteSession(ses);
  await ses.setProxy(config);
  await ses.closeAllConnections();
  return ses;
}

async function applyTorFailClosed() {
  return applyXProxy({
    mode: 'fixed_servers',
    proxyRules: 'socks5://127.0.0.1:1',
    proxyBypassRules: '<local>,localhost,127.0.0.1',
  });
}

async function verifyTorExit(ses) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await ses.fetch(TOR_CHECK_URL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Tor verification returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload?.IsTor !== true) throw new Error('Tor Project verification did not identify this connection as Tor.');
    return { connected: true, exitIp: String(payload?.IP || '') || null };
  } finally {
    clearTimeout(timer);
  }
}

function updateTorBootstrapFromLog(line) {
  const match = String(line || '').match(/Bootstrapped\s+(\d+)%/i);
  if (!match) return;
  const percent = Math.max(0, Math.min(100, Number(match[1]) || 0));
  if (percent === torRuntime.bootstrapPercent) return;
  torRuntime = { ...torRuntime, bootstrapPercent: percent, error: percent < 100 ? `Integrated Tor bootstrapping: ${percent}%` : null };
  startupLog(`Integrated Tor bootstrap ${percent}%.`);
  emitState();
}

async function stopManagedTor() {
  const child = managedTorProcess;
  managedTorProcess = null;
  managedTorPort = null;
  if (!child) return;
  try { child.kill(); } catch {}
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(1800),
  ]).catch(() => undefined);
}

async function startIntegratedTor() {
  if (managedTorProcess && managedTorPort && await testTcpPort(managedTorPort, 500)) {
    return { port: managedTorPort, source: 'integrated' };
  }

  const torExe = bundledTorExecutable();
  torRuntime = { ...torRuntime, bundledAvailable: Boolean(torExe) };
  if (!torExe) throw new Error('Integrated Tor runtime is missing. Re-run INSTALL_WINDOWS.bat so the official Tor Expert Bundle is included.');

  await stopManagedTor();
  const preferred = Number(appState?.tor?.preferredPort) || INTEGRATED_TOR_PORT_START;
  const port = await findAvailableLocalPort(Math.max(INTEGRATED_TOR_PORT_START, preferred), Math.max(INTEGRATED_TOR_PORT_START, preferred) + 50);
  const dataDir = path.join(app.getPath('userData'), 'integrated-tor-data');
  await fs.mkdir(dataDir, { recursive: true });

  const args = [
    '--SocksPort', `127.0.0.1:${port}`,
    '--DataDirectory', dataDir,
    '--ClientOnly', '1',
    '--AvoidDiskWrites', '1',
    '--Log', 'notice stdout',
  ];
  const geoip = bundledTorGeoIp('geoip');
  const geoip6 = bundledTorGeoIp('geoip6');
  if (geoip) args.push('--GeoIPFile', geoip);
  if (geoip6) args.push('--GeoIPv6File', geoip6);

  startupLog(`Starting integrated Tor: ${torExe} SOCKS=${port}`);
  torRuntime = { ...torRuntime, connected: false, port, exitIp: null, source: 'integrated', bootstrapPercent: 0, bundledAvailable: true, lastCheckedAt: nowIso(), error: 'Starting integrated Tor…' };
  emitState();

  const child = spawn(torExe, args, {
    cwd: path.dirname(torExe),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedTorProcess = child;
  managedTorPort = port;

  const onLine = (chunk) => {
    const text = String(chunk || '');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      startupLog(`[Tor] ${line.trim()}`);
      updateTorBootstrapFromLog(line);
    }
  };
  child.stdout?.on('data', onLine);
  child.stderr?.on('data', onLine);
  child.once('error', (error) => {
    startupLog('Integrated Tor process error.', error);
    if (managedTorProcess === child) {
      torRuntime = { ...torRuntime, connected: false, error: `Integrated Tor process error: ${error.message}`, lastCheckedAt: nowIso() };
      emitState();
    }
  });
  child.once('exit', (code, signal) => {
    startupLog(`Integrated Tor exited code=${code} signal=${signal || 'none'}.`);
    if (managedTorProcess === child) {
      managedTorProcess = null;
      managedTorPort = null;
      if (appState?.tor?.enabled) {
        torRuntime = { ...torRuntime, connected: false, port: null, exitIp: null, bootstrapPercent: 0, error: `Integrated Tor stopped unexpectedly (exit ${code ?? 'unknown'}).`, lastCheckedAt: nowIso() };
        emitState();
      }
    }
  });

  return { port, source: 'integrated' };
}

async function routeAndVerifyTor(port, source, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Tor has not finished bootstrapping.';
  while (Date.now() < deadline) {
    if (source === 'integrated' && (!managedTorProcess || managedTorProcess.exitCode !== null)) {
      throw new Error(lastError || 'Integrated Tor process exited before connecting.');
    }
    if (await testTcpPort(port, 750)) {
      try {
        const ses = await applyXProxy({
          mode: 'fixed_servers',
          proxyRules: `socks5://127.0.0.1:${port}`,
          proxyBypassRules: '<local>,localhost,127.0.0.1',
        });
        const verified = await verifyTorExit(ses);
        return verified;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await sleep(1000);
  }
  throw new Error(lastError || 'Tor connection timed out.');
}

async function connectTorRouting() {
  if (!appState.tor) appState.tor = { enabled: false, preferredPort: null };
  appState.tor.enabled = true;
  await persistState();
  await applyTorFailClosed();
  torRuntime = {
    connected: false,
    port: null,
    exitIp: null,
    source: 'integrated',
    bootstrapPercent: 0,
    bundledAvailable: Boolean(bundledTorExecutable()),
    lastCheckedAt: nowIso(),
    error: 'Starting integrated Tor…',
  };
  emitState();

  let lastError = null;
  try {
    const integrated = await startIntegratedTor();
    const verified = await routeAndVerifyTor(integrated.port, 'integrated', 90000);
    appState.tor.preferredPort = integrated.port;
    torRuntime = { connected: true, port: integrated.port, exitIp: verified.exitIp, source: 'integrated', bootstrapPercent: 100, bundledAvailable: true, lastCheckedAt: nowIso(), error: null };
    await persistState();
    emitState();
    return { ...torRuntime, enabled: true };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    startupLog('Integrated Tor connection attempt failed.', error);
  }

  // Compatibility fallback: if a user already has Tor Browser or a Tor service running,
  // use it only after explicit Tor verification succeeds.
  for (const port of EXTERNAL_TOR_PORTS) {
    if (!(await testTcpPort(port))) continue;
    try {
      const verified = await routeAndVerifyTor(port, 'external', 15000);
      torRuntime = { connected: true, port, exitIp: verified.exitIp, source: 'external', bootstrapPercent: 100, bundledAvailable: Boolean(bundledTorExecutable()), lastCheckedAt: nowIso(), error: null };
      await persistState();
      emitState();
      return { ...torRuntime, enabled: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  await applyTorFailClosed();
  torRuntime = { connected: false, port: null, exitIp: null, source: 'integrated', bootstrapPercent: 0, bundledAvailable: Boolean(bundledTorExecutable()), lastCheckedAt: nowIso(), error: lastError || 'Integrated Tor could not connect.' };
  await persistState();
  emitState();
  return { ...torRuntime, enabled: true };
}

async function setTorRouting(enabled) {
  if (!enabled) {
    if (torConnectPromise) await Promise.race([torConnectPromise.catch(() => undefined), sleep(500)]);
    await stopManagedTor();
    await applyXProxy({ mode: 'direct' });
    if (!appState.tor) appState.tor = { enabled: false, preferredPort: null };
    appState.tor.enabled = false;
    torRuntime = { connected: false, port: null, exitIp: null, source: null, bootstrapPercent: 0, bundledAvailable: Boolean(bundledTorExecutable()), lastCheckedAt: nowIso(), error: null };
    await persistState();
    emitState();
    return { ...torRuntime, enabled: false };
  }

  if (torConnectPromise) return torConnectPromise;
  torConnectPromise = connectTorRouting().finally(() => { torConnectPromise = null; });
  return torConnectPromise;
}

async function refreshTorStatus() {
  const bundledAvailable = Boolean(bundledTorExecutable());
  if (!appState?.tor?.enabled) return { ...torRuntime, bundledAvailable, enabled: false };
  if (!torRuntime.connected) {
    if (!torConnectPromise) runBackgroundTask('Integrated Tor reconnect', () => setTorRouting(true));
    return { ...torRuntime, bundledAvailable, enabled: true };
  }
  const ses = session.fromPartition(X_PARTITION);
  try {
    const verified = await verifyTorExit(ses);
    torRuntime = { ...torRuntime, connected: true, exitIp: verified.exitIp, bundledAvailable, lastCheckedAt: nowIso(), error: null };
  } catch (error) {
    torRuntime = { ...torRuntime, connected: false, exitIp: null, bundledAvailable, lastCheckedAt: nowIso(), error: error instanceof Error ? error.message : String(error) };
    if (!torConnectPromise) runBackgroundTask('Integrated Tor reconnect', () => setTorRouting(true));
  }
  emitState();
  return { ...torRuntime, enabled: true };
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: `${APP_TITLE} ${APP_BYLINE}`,
    width: 1500,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#05090d',
    show: true,
    center: true,
    icon: runtimeIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try { mainWindow.setIcon(runtimeIconPath()); } catch (error) { startupLog('Could not set native window icon.', error); }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    startupLog(`Preload failed: ${preloadPath}`, error);
    dialog.showErrorBox(APP_TITLE, `The application preload failed.\n\n${error?.message || error}\n\nStartup log:\n${STARTUP_LOG_PATH}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    startupLog(`Renderer process exited: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  let hasShown = false;
  const showMainWindow = (reason) => {
    if (!mainWindow || mainWindow.isDestroyed() || hasShown) return;
    hasShown = true;
    startupLog(`Showing main window (${reason}).`);
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', () => showMainWindow('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => showMainWindow('did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    startupLog(`Main renderer failed to load: ${errorCode} ${errorDescription} ${validatedURL}`);
    showMainWindow('did-fail-load');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(APP_TITLE, `The application window could not load.\n\n${errorDescription} (${errorCode})\n\nStartup log:\n${STARTUP_LOG_PATH}`);
      }
    }, 0);
  });
  const showFallbackTimer = setTimeout(() => showMainWindow('5-second fallback'), 5000);
  showFallbackTimer.unref?.();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const rendererTarget = DEV_URL || path.join(__dirname, '..', 'dist', 'index.html');
  const preloadTarget = path.join(__dirname, 'preload.cjs');
  if (!DEV_URL && !fsSync.existsSync(rendererTarget)) {
    const error = new Error(`Packaged renderer is missing: ${rendererTarget}`);
    startupLog('Packaged renderer validation failed.', error);
    throw error;
  }
  if (!fsSync.existsSync(preloadTarget)) {
    const error = new Error(`Preload script is missing: ${preloadTarget}`);
    startupLog('Preload validation failed.', error);
    throw error;
  }
  startupLog(`Loading renderer: ${rendererTarget}`);
  if (DEV_URL) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    await mainWindow.loadFile(rendererTarget);
  }
}

async function getXSessionStatus() {
  const ses = session.fromPartition(X_PARTITION);
  configureRemoteSession(ses);
  const cookies = await ses.cookies.get({ name: 'auth_token' });
  const connected = cookies.some((cookie) =>
    /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(cookie.domain || '')
  );
  return { connected };
}

async function ensureXRouteReadyForLogin() {
  const ses = session.fromPartition(X_PARTITION);
  configureRemoteSession(ses);
  if (!appState?.tor?.enabled) {
    await applyXProxy({ mode: 'direct' });
    return { mode: 'direct' };
  }

  if (!torRuntime.connected) {
    const status = await setTorRouting(true);
    if (!status?.connected) {
      throw new Error(`Tor is enabled but not ready for X login: ${status?.error || 'Tor connection could not be verified.'}`);
    }
  }

  try {
    await verifyTorExit(ses);
  } catch (error) {
    await applyTorFailClosed();
    torRuntime = { ...torRuntime, connected: false, error: error instanceof Error ? error.message : String(error), lastCheckedAt: nowIso() };
    emitState();
    throw new Error(`Tor is enabled but its route could not be verified for X login: ${torRuntime.error}`);
  }
  return { mode: 'tor', port: torRuntime.port, exitIp: torRuntime.exitIp };
}

async function openXLogin() {
  const ses = session.fromPartition(X_PARTITION);
  configureRemoteSession(ses);
  await ensureXRouteReadyForLogin();

  const loginWindow = new BrowserWindow({
    title: `${APP_TITLE} — Connect X`,
    width: 1180,
    height: 850,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: runtimeIconPath(),
    webPreferences: {
      partition: X_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try { loginWindow.setIcon(runtimeIconPath()); } catch (error) { startupLog('Could not set X login window icon.', error); }
  loginWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) emitBackgroundError('X login load', new Error(`${description} (${code}) ${url}`));
  });
  loginWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details?.reason !== 'clean-exit') emitBackgroundError('X login renderer', new Error(`Renderer ${details?.reason || 'terminated'} (${details?.exitCode ?? 'unknown'})`));
  });

  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:[^/]+\.)?(?:x|twitter)\.com\//i.test(url)) {
      void loginWindow.loadURL(url).catch((error) => emitBackgroundError('X login navigation', error));
      return { action: 'deny' };
    }
    if (/^https:\/\/(?:accounts\.google\.com|appleid\.apple\.com)\//i.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: `${APP_TITLE} — Sign in`,
          width: 980,
          height: 760,
          autoHideMenuBar: true,
          icon: runtimeIconPath(),
          webPreferences: { partition: X_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    }
    return { action: 'deny' };
  });

  loginWindow.on('closed', () => scheduleAvatarRepair(750));
  loginWindow.webContents.on('did-navigate', () => {
    void getXSessionStatus().then((status) => { if (status.connected) scheduleAvatarRepair(750); }).catch(() => undefined);
  });
  await loginWindow.loadURL('https://x.com/i/flow/login');
  return { opened: true };
}

async function clearXSession() {
  const ses = session.fromPartition(X_PARTITION);
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
  });
  await ses.clearCache();
  return { connected: false };
}

function createRemoteWindow({ title, show, mediaEnabled = true }) {
  const ses = session.fromPartition(X_PARTITION);
  configureRemoteSession(ses);

  const win = new BrowserWindow({
    title,
    width: 1240,
    height: 900,
    show,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: runtimeIconPath(),
    webPreferences: {
      partition: X_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  const remoteWebContentsId = win.webContents.id;
  mediaPolicyByWebContents.set(remoteWebContentsId, mediaEnabled !== false);
  win.once('closed', () => mediaPolicyByWebContents.delete(remoteWebContentsId));
  try { win.setIcon(runtimeIconPath()); } catch (error) { startupLog(`Could not set remote X window icon: ${title}`, error); }
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details?.reason !== 'clean-exit') emitBackgroundError(`X browser renderer ${details?.reason || 'terminated'}`, new Error(`Renderer exit code ${details?.exitCode ?? 'unknown'}`));
  });
  win.on('unresponsive', () => startupLog(`Remote X window became unresponsive: ${title}`));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(?:[^/]+\.)?(?:x|twitter)\.com\//i.test(url)) {
      void win.loadURL(url).catch((error) => emitBackgroundError('X remote-window navigation', error));
    }
    return { action: 'deny' };
  });
  return win;
}

async function openProfileFeed(profileId) {
  const profile = appState.profiles.find((item) => item.id === profileId && item.caseId === activeCaseId());
  if (!profile) throw new Error('Profile not found.');

  const win = createRemoteWindow({
    title: `@${profile.username} — X Feed`,
    show: true,
    mediaEnabled: effectiveImageCollection(profile),
  });
  await win.loadURL(`https://x.com/${encodeURIComponent(profile.username)}/with_replies`);
  return { opened: true };
}

async function openPostThread(postId) {
  const post = appState.posts.find((item) => item.id === postId && item.caseId === activeCaseId());
  if (!post) throw new Error('Finding not found.');

  const fallbackUrl = `https://x.com/${encodeURIComponent(post.username)}/status/${encodeURIComponent(post.id)}`;
  let target;
  try {
    target = new URL(String(post.url || fallbackUrl));
  } catch {
    target = new URL(fallbackUrl);
  }

  const hostname = target.hostname.toLowerCase();
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(hostname)) {
    throw new Error('Blocked a non-X thread URL.');
  }
  if (!/\/status\/\d+/i.test(target.pathname)) {
    throw new Error('The selected finding does not contain a valid X status URL.');
  }

  target.protocol = 'https:';
  const sourceProfile = appState.profiles.find((item) => item.id === post.profileId);
  const win = createRemoteWindow({
    title: `@${post.username} — X Thread`,
    show: true,
    mediaEnabled: sourceProfile ? effectiveImageCollection(sourceProfile) : Boolean(activeSettings().collectImages),
  });
  await win.loadURL(target.toString());
  return { opened: true, url: target.toString() };
}

async function openRelationshipProfile(relationshipId) {
  const relationship = appState.relationships.find((item) => item.id === relationshipId && item.caseId === activeCaseId());
  if (!relationship) throw new Error('Follower/following profile not found.');

  const username = String(relationship.username || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    throw new Error('The selected record does not contain a valid X username.');
  }

  const targetUrl = `https://x.com/${encodeURIComponent(username)}`;
  const win = createRemoteWindow({
    title: `@${username} — X Profile`,
    show: true,
  });
  await win.loadURL(targetUrl);
  return { opened: true, url: targetUrl };
}

function parseMetricText(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  const match = text.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || '').toUpperCase()] || 1;
  return Math.round(number * multiplier);
}

async function readVisibleTimelineItems(win) {
  const collected = await win.webContents.executeJavaScript(String.raw`
    (() => {
      const metric = (article, testId) => {
        const node = article.querySelector('[data-testid="' + testId + '"]');
        if (!node) return '';
        return node.getAttribute('aria-label') || node.textContent || '';
      };

      return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map((article) => {
        const time = article.querySelector('time');
        const timeLink = time?.closest('a[href*="/status/"]');
        const statusLink = timeLink || Array.from(article.querySelectorAll('a[href*="/status/"]'))[0];
        const rawHref = statusLink?.getAttribute('href') || '';
        const match = rawHref.match(/^\/([^/]+)\/status\/(\d+)/);
        const tweetText = article.querySelector('[data-testid="tweetText"]');
        const fullText = article.innerText || '';
        const socialContext = article.querySelector('[data-testid="socialContext"]')?.textContent || '';
        const userNameArea = article.querySelector('[data-testid="User-Name"]') || article.querySelector('[data-testid="UserName"]');
        const displayName = Array.from(userNameArea?.querySelectorAll('span') || [])
          .map((node) => (node.textContent || '').trim())
          .find((text) => text && !text.startsWith('@') && !/^·$/.test(text)) || '';
        const avatar = Array.from(article.querySelectorAll('img[src*="profile_images"]'))
          .map((image) => image.getAttribute('src') || '')
          .find(Boolean) || '';
        const images = Array.from(article.querySelectorAll('img[src*="pbs.twimg.com/media"]'))
          .map((image) => image.getAttribute('src'))
          .filter(Boolean);

        return {
          id: match?.[2] || '',
          username: match?.[1] || '',
          displayName,
          avatar,
          url: rawHref ? new URL(rawHref, location.origin).href : '',
          text: (tweetText?.innerText || '').trim(),
          createdAt: time?.getAttribute('datetime') || '',
          isReply: /Replying to/i.test(fullText),
          isRepost: /reposted/i.test(socialContext),
          socialContext: socialContext.trim(),
          metricsRaw: {
            replies: metric(article, 'reply'),
            reposts: metric(article, 'retweet'),
            likes: metric(article, 'like'),
            views: metric(article, 'analytics')
          },
          media: [...new Set(images)]
        };
      }).filter((item) => item.id && item.url && item.text);
    })()
  `, true);
  return Array.isArray(collected) ? collected : [];
}

async function assertSignedInPage(win) {
  const pageCheck = await win.webContents.executeJavaScript(String.raw`
    (() => ({
      url: location.href,
      text: (document.body?.innerText || '').slice(0, 5000),
      articles: document.querySelectorAll('article[data-testid="tweet"]').length
    }))()
  `, true);

  const pageUrl = String(pageCheck?.url || '');
  const pageText = String(pageCheck?.text || '');
  if (/\/i\/flow\/login/i.test(pageUrl) || /sign in to x/i.test(pageText)) {
    throw new Error('The saved X session is no longer signed in. Reconnect it from System.');
  }
  if (/verify your identity|unusual activity|temporarily limited|rate limit exceeded|try again later|security check|arkose/i.test(pageText)) {
    throw new Error('X presented a verification challenge or temporary limit. Collection stopped without attempting to bypass it. Open the X session and resolve the prompt before continuing.');
  }
}

async function readProfileMetadata(win) {
  try {
    return await win.webContents.executeJavaScript(String.raw`
      (() => {
        const usernameArea = document.querySelector('[data-testid="UserName"]');
        const displayName = Array.from(usernameArea?.querySelectorAll('span') || [])
          .map((node) => (node.textContent || '').trim())
          .find((text) => text && !text.startsWith('@')) || '';
        const bio = document.querySelector('[data-testid="UserDescription"]')?.innerText?.trim() || '';
        const locationText = document.querySelector('[data-testid="UserLocation"]')?.innerText?.trim() || '';
        const websiteAnchor = document.querySelector('[data-testid="UserUrl"] a') || document.querySelector('[data-testid="UserUrl"]');
        const website = websiteAnchor?.getAttribute?.('href') || websiteAnchor?.textContent?.trim() || '';

        // IMPORTANT: never use the first document-wide profile_images element. X's global
        // navigation contains the signed-in account avatar and can appear before the target header.
        const currentUsername = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        const photoAnchor = Array.from(document.querySelectorAll('main a[href]')).find((anchor) => {
          try {
            const url = new URL(anchor.getAttribute('href') || '', location.origin);
            return url.pathname.toLowerCase() === '/' + currentUsername + '/photo' &&
              Boolean(anchor.querySelector('img[src*="profile_images"]'));
          } catch {
            return false;
          }
        });
        const avatar = photoAnchor?.querySelector('img[src*="profile_images"]')?.getAttribute('src') || '';
        return { displayName, bio, location: locationText, website, avatar };
      })()
    `, true);
  } catch {
    return null;
  }
}

function mapCollectedPost(profile, item, kind, parentPostId = null) {
  const timestamp = nowIso();
  const recordId = kind === 'post' || kind === 'reply'
    ? String(item.id)
    : `${profile.id}:${kind}:${String(item.id)}`;
  const record = {
    id: recordId,
    caseId: profile.caseId || activeCaseId(),
    profileId: profile.id,
    username: String(item.username || profile.username),
    displayName: String(item.displayName || (String(item.username || profile.username).toLowerCase() === profile.username.toLowerCase() ? profile.displayName || '' : '')),
    avatar: String(item.avatar || (String(item.username || profile.username).toLowerCase() === profile.username.toLowerCase() ? profile.avatar || '' : '')),
    sourceUsername: profile.username,
    url: String(item.url),
    text: String(item.text),
    createdAt: item.createdAt || timestamp,
    collectedAt: timestamp,
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    collectionMethod: 'authenticated_browser',
    kind,
    isReply: kind === 'reply' || kind === 'comment',
    parentPostId,
    metrics: {
      replies: parseMetricText(item.metricsRaw?.replies),
      reposts: parseMetricText(item.metricsRaw?.reposts),
      likes: parseMetricText(item.metricsRaw?.likes),
      views: parseMetricText(item.metricsRaw?.views),
    },
    media: Array.isArray(item.media) ? item.media.slice(0, 8) : [],
    mediaEvidence: [],
    versionHistory: [],
    availability: 'observed',
    verifiedAt: timestamp,
  };
  record.evidenceHash = sha256(canonicalPostEvidence(record));
  return record;
}

function mediaExtension(contentType, sourceUrl) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  try {
    const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if (/^\.(?:png|jpe?g|webp|gif)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {}
  return '.jpg';
}

async function archiveMediaForPosts(posts, profile) {
  if (!effectiveImageCollection(profile)) return { downloaded: 0 };
  const ses = session.fromPartition(X_PARTITION);
  const root = path.join(app.getPath('userData'), 'evidence-media', profile.caseId || activeCaseId());
  let downloaded = 0;
  for (const post of posts) {
    const urls = Array.isArray(post.media) ? post.media.slice(0, 8) : [];
    if (!urls.length) continue;
    post.mediaEvidence = Array.isArray(post.mediaEvidence) ? post.mediaEvidence : [];
    const existing = new Set(post.mediaEvidence.map((row) => row.sourceUrl));
    for (let index = 0; index < urls.length; index += 1) {
      const sourceUrl = String(urls[index] || '');
      if (!sourceUrl || existing.has(sourceUrl)) continue;
      try {
        const response = await ses.fetch(sourceUrl, { cache: 'no-store' });
        if (!response.ok) continue;
        const contentType = String(response.headers.get('content-type') || 'image/jpeg');
        if (!/^image\//i.test(contentType)) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) continue;
        const safePost = String(post.id).replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);
        const dir = path.join(root, safePost);
        await fs.mkdir(dir, { recursive: true });
        const ext = mediaExtension(contentType, sourceUrl);
        const filePath = path.join(dir, `${String(index + 1).padStart(2, '0')}${ext}`);
        await fs.writeFile(filePath, bytes);
        post.mediaEvidence.push({ sourceUrl, filePath, contentType, size: bytes.length, sha256: sha256(bytes), collectedAt: nowIso() });
        existing.add(sourceUrl);
        downloaded += 1;
      } catch (error) {
        console.warn('Media archive failed:', sourceUrl, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { downloaded };
}

async function getPostMediaDataUrl(postId, index) {
  const post = appState.posts.find((item) => item.id === postId && item.caseId === activeCaseId());
  if (!post) throw new Error('Finding not found in the active campaign.');
  const mediaIndex = Math.max(0, Number(index) || 0);
  const sourceUrl = Array.isArray(post.media) ? String(post.media[mediaIndex] || '') : '';
  const evidence = Array.isArray(post.mediaEvidence) ? post.mediaEvidence : [];
  const row = evidence.find((item) => sourceUrl && item.sourceUrl === sourceUrl) || evidence[mediaIndex] || null;
  if (!row?.filePath) return null;
  const mediaRoot = path.resolve(path.join(app.getPath('userData'), 'evidence-media'));
  const resolved = path.resolve(row.filePath);
  if (!(resolved === mediaRoot || resolved.startsWith(mediaRoot + path.sep))) throw new Error('Blocked media path outside the evidence-media directory.');
  const bytes = await fs.readFile(resolved);
  return `data:${row.contentType || 'image/jpeg'};base64,${bytes.toString('base64')}`;
}

const avatarDataUrlMemory = new Map();

function avatarSourceForUsername(username, preferredUrl = '') {
  const clean = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!clean) return String(preferredUrl || '');
  if (preferredUrl) return String(preferredUrl);
  const profile = appState?.profiles?.find((item) => String(item.username || '').toLowerCase() === clean && item.avatar);
  if (profile?.avatar) return String(profile.avatar);
  const relationship = [...(appState?.relationships || [])]
    .filter((item) => String(item.username || '').toLowerCase() === clean && item.avatar)
    .sort((a, b) => String(b.lastObservedAt || b.collectedAt || '').localeCompare(String(a.lastObservedAt || a.collectedAt || '')))[0];
  if (relationship?.avatar) return String(relationship.avatar);
  const post = [...(appState?.posts || [])]
    .filter((item) => String(item.username || '').toLowerCase() === clean && item.avatar)
    .sort((a, b) => String(b.lastObservedAt || b.collectedAt || '').localeCompare(String(a.lastObservedAt || a.collectedAt || '')))[0];
  return String(post?.avatar || '');
}

function avatarCachePaths(username) {
  const safeKey = crypto.createHash('sha256').update(String(username || '').toLowerCase()).digest('hex').slice(0, 40);
  const dir = path.join(app.getPath('userData'), 'avatar-cache');
  return { dir, bytes: path.join(dir, `${safeKey}.bin`), meta: path.join(dir, `${safeKey}.json`) };
}

async function readCachedAvatar(username) {
  const paths = avatarCachePaths(username);
  try {
    const [metaText, bytes] = await Promise.all([fs.readFile(paths.meta, 'utf8'), fs.readFile(paths.bytes)]);
    const meta = JSON.parse(metaText);
    if (!bytes.length || !/^image\//i.test(String(meta.contentType || ''))) return null;
    return { dataUrl: `data:${meta.contentType};base64,${bytes.toString('base64')}`, sourceUrl: String(meta.sourceUrl || '') };
  } catch {
    return null;
  }
}

async function getAvatarDataUrl(username, preferredUrl = '', forceRefresh = false) {
  const clean = String(username || '').replace(/^@/, '').trim();
  if (!clean) return null;
  const sourceUrl = avatarSourceForUsername(clean, preferredUrl);
  const memoryKey = `${clean.toLowerCase()}|${sourceUrl}`;
  if (!forceRefresh && avatarDataUrlMemory.has(memoryKey)) return avatarDataUrlMemory.get(memoryKey);

  const cached = forceRefresh ? null : await readCachedAvatar(clean);
  if (cached && (!sourceUrl || cached.sourceUrl === sourceUrl)) {
    avatarDataUrlMemory.set(memoryKey, cached.dataUrl);
    return cached.dataUrl;
  }
  if (!/^https?:\/\//i.test(sourceUrl)) return cached?.dataUrl || null;

  try {
    const ses = session.fromPartition(X_PARTITION);
    configureRemoteSession(ses);
    const response = await ses.fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Avatar HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!/^image\//i.test(contentType)) throw new Error(`Avatar response was ${contentType || 'not an image'}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Avatar image was empty or too large.');
    const paths = avatarCachePaths(clean);
    await fs.mkdir(paths.dir, { recursive: true });
    await Promise.all([
      fs.writeFile(paths.bytes, bytes),
      fs.writeFile(paths.meta, JSON.stringify({ username: clean, sourceUrl, contentType, size: bytes.length, cachedAt: nowIso() }, null, 2), 'utf8'),
    ]);
    const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`;
    avatarDataUrlMemory.set(memoryKey, dataUrl);
    return dataUrl;
  } catch (error) {
    startupLog(`Avatar cache fetch failed for @${clean}.`, error);
    return cached?.dataUrl || null;
  }
}


async function repairExistingProfileAvatars() {
  if (!appState?.avatarRepair?.pending || avatarRepairRunning || sweepRunning) return { pending: Boolean(appState?.avatarRepair?.pending), skipped: true };
  const status = await getXSessionStatus();
  if (!status.connected) {
    startupLog('Avatar repair remains pending until the X session is connected.');
    return { pending: true, connected: false };
  }

  avatarRepairRunning = true;
  appState.avatarRepair.lastAttemptAt = nowIso();
  appState.avatarRepair.lastError = null;
  const failures = [];
  let repaired = 0;
  try {
    const profiles = [...appState.profiles];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      emitProgress(`Repairing profile image @${profile.username}…`, index + 1, profiles.length);
      const win = createRemoteWindow({ title: `Repairing @${profile.username} profile image`, show: false, mediaEnabled: true });
      try {
        await win.loadURL(`https://x.com/${encodeURIComponent(profile.username)}`);
        await sleep(2500);
        await assertSignedInPage(win);
        const metadata = await readProfileMetadata(win);
        if (!metadata?.avatar) throw new Error(`X did not expose a target-header avatar for @${profile.username}.`);
        updateProfileMetadata(profile, metadata);
        await getAvatarDataUrl(profile.username, metadata.avatar, true);
        repaired += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`@${profile.username}: ${message}`);
        startupLog(`Avatar repair failed for @${profile.username}.`, error);
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
      if (index < profiles.length - 1) await sleep(750);
    }

    // Prime corrected caches for identities whose valid avatar URLs were already captured from
    // tweet cards or follower/following cells. This replaces stale on-disk images without
    // needing to visit hundreds of individual profiles.
    const candidates = new Map();
    const remember = (username, avatar) => {
      const clean = String(username || '').replace(/^@/, '').trim().toLowerCase();
      const url = String(avatar || '').trim();
      if (clean && /^https?:\/\//i.test(url) && !candidates.has(clean)) candidates.set(clean, url);
    };
    for (const profile of appState.profiles) remember(profile.username, profile.avatar);
    for (const row of [...appState.relationships].sort((a, b) => String(b.lastObservedAt || '').localeCompare(String(a.lastObservedAt || '')))) remember(row.username, row.avatar);
    for (const post of [...appState.posts].sort((a, b) => String(b.lastObservedAt || '').localeCompare(String(a.lastObservedAt || '')))) remember(post.username, post.avatar);
    let primed = 0;
    for (const [username, avatar] of candidates) {
      try {
        await getAvatarDataUrl(username, avatar, true);
        primed += 1;
      } catch {
        // Individual image failures should not block repair completion; the UI can retry on demand.
      }
      if (primed >= 500) break;
    }

    appState.avatarRepair.pending = failures.length > 0;
    appState.avatarRepair.completedAt = failures.length ? null : nowIso();
    appState.avatarRepair.lastError = failures.length ? failures.join(' | ') : null;
    await persistState();
    emitState();
    startupLog(`Avatar repair finished: ${repaired}/${profiles.length} monitored targets refreshed; ${primed} identity caches primed; ${failures.length} failures.`);
    return { pending: appState.avatarRepair.pending, repaired, primed, failures };
  } finally {
    avatarRepairRunning = false;
    emitProgress('Idle', 0, 0);
  }
}

function scheduleAvatarRepair(delayMs = 2500) {
  if (!appState?.avatarRepair?.pending) return;
  if (avatarRepairTimer) clearTimeout(avatarRepairTimer);
  avatarRepairTimer = setTimeout(() => {
    avatarRepairTimer = null;
    void repairExistingProfileAvatars().catch((error) => startupLog('Scheduled avatar repair failed.', error));
  }, Math.max(250, Number(delayMs) || 2500));
  avatarRepairTimer.unref?.();
}


async function scrapeCommentsForPosts(win, profile, rootPosts) {
  if (!appState.settings.collectComments || !rootPosts.length) return [];

  const maxThreads = Math.max(1, Math.min(20, Number(appState.settings.commentThreadsPerSweep) || 3));
  const passes = Math.max(1, Math.min(8, Number(appState.settings.commentScrollPasses) || 2));
  const delay = Math.max(500, Math.min(5000, Number(appState.settings.scrollDelayMs) || 1100));
  const comments = [];

  for (const rootPost of rootPosts.slice(0, maxThreads)) {
    await win.loadURL(rootPost.url);
    await sleep(2500);
    await assertSignedInPage(win);
    const itemsByKey = new Map();
    for (let index = 0; index <= passes; index += 1) {
      const visibleItems = await readVisibleTimelineItems(win);
      for (const item of visibleItems) itemsByKey.set(String(item.id), item);
      if (index < passes) {
        await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)', true);
        await sleep(delay);
      }
    }

    for (const item of itemsByKey.values()) {
      if (String(item.id) === String(rootPost.id)) continue;
      if (String(item.username || '').toLowerCase() === profile.username.toLowerCase()) continue;
      comments.push(mapCollectedPost(profile, item, 'comment', rootPost.id));
    }
  }
  return comments;
}

async function scrapeProfile(profile, options = {}) {
  const status = await getXSessionStatus();
  if (!status.connected) {
    throw new Error('X is not connected. Open System, select Connect X, and sign in.');
  }

  const win = createRemoteWindow({
    title: options.title || `Collecting @${profile.username}`,
    show: false,
    mediaEnabled: effectiveImageCollection(profile),
  });

  try {
    const route = appState.settings.collectReplies ? 'with_replies' : '';
    const url = `https://x.com/${encodeURIComponent(profile.username)}${route ? `/${route}` : ''}`;
    await win.loadURL(url);
    await sleep(3500);
    await assertSignedInPage(win);
    updateProfileMetadata(profile, await readProfileMetadata(win));

    const requestedPasses = Number.isFinite(Number(options.passes))
      ? Number(options.passes)
      : Number(appState.settings.scrollPasses) || 5;
    const passes = Math.max(1, Math.min(120, requestedPasses));
    const delay = Math.max(500, Math.min(5000, Number(appState.settings.scrollDelayMs) || 1100));

    const itemsByKey = new Map();
    let stagnantPasses = 0;
    let previousSize = 0;
    let passesCompleted = 0;
    let stopReason = 'pass_limit';
    for (let index = 0; index <= passes; index += 1) {
      passesCompleted = index + 1;
      const visibleItems = await readVisibleTimelineItems(win);
      for (const item of visibleItems) {
        const key = `${item.id}:${item.isRepost ? 'repost' : 'tweet'}`;
        itemsByKey.set(key, item);
      }

      if (itemsByKey.size === previousSize) stagnantPasses += 1;
      else stagnantPasses = 0;
      previousSize = itemsByKey.size;

      if (options.progressLabel) {
        emitProgress(`${options.progressLabel} @${profile.username} — pass ${index + 1}/${passes + 1}`, index + 1, passes + 1);
      }

      if (index < passes && stagnantPasses < 5) {
        await win.webContents.executeJavaScript(String.raw`
          (() => {
            const scroller = document.scrollingElement || document.documentElement;
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
            return { top: scroller.scrollTop, height: scroller.scrollHeight };
          })()
        `, true);
        await sleep(delay);
        await assertSignedInPage(win);
      } else if (stagnantPasses >= 5) {
        stopReason = 'stagnant';
        break;
      }
    }

    const items = [...itemsByKey.values()];
    const profileRecords = [];
    for (const item of items) {
      const authorMatches = String(item.username || '').toLowerCase() === profile.username.toLowerCase();
      if (item.isRepost && !authorMatches) {
        if (appState.settings.collectReposts) profileRecords.push(mapCollectedPost(profile, item, 'repost'));
        continue;
      }
      if (!authorMatches) continue;
      if (item.isReply) {
        if (appState.settings.collectReplies) profileRecords.push(mapCollectedPost(profile, item, 'reply'));
      } else {
        profileRecords.push(mapCollectedPost(profile, item, 'post'));
      }
    }

    const rootPosts = profileRecords.filter((post) => post.kind === 'post');
    const comments = options.collectComments === false
      ? []
      : await scrapeCommentsForPosts(win, profile, rootPosts);
    const result = [...profileRecords, ...comments];
    result.__meta = {
      requestedPasses: passes,
      passesCompleted,
      stopReason,
      observedTimelineItems: itemsByKey.size,
      oldestObservedAt: result.map((post) => post.createdAt).filter(Boolean).sort()[0] || null,
    };
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function evaluatePreset(preset, post) {
  if (Array.isArray(preset.profileIds) && preset.profileIds.length && !preset.profileIds.includes(post.profileId)) {
    return [];
  }

  const source = preset.caseSensitive ? post.text : post.text.toLowerCase();
  const keywords = (Array.isArray(preset.keywords) ? preset.keywords : [])
    .map((keyword) => String(keyword).trim())
    .filter(Boolean);

  const matched = keywords.filter((keyword) => {
    const needle = preset.caseSensitive ? keyword : keyword.toLowerCase();
    return source.includes(needle);
  });

  if (preset.mode === 'all') return matched.length === keywords.length ? matched : [];
  return matched;
}

function rebuildMatchesForPosts(posts) {
  const caseId = activeCaseId();
  const existing = new Set(appState.matches.filter((m) => m.caseId === caseId).map((match) => `${match.presetId}:${match.postId}`));
  for (const post of posts.filter((item) => item.caseId === caseId)) {
    for (const preset of appState.presets.filter((item) => item.caseId === caseId && item.enabled !== false)) {
      const keywords = evaluatePreset(preset, post);
      if (!keywords.length) continue;
      const key = `${preset.id}:${post.id}`;
      if (existing.has(key)) continue;
      appState.matches.push({
        id: makeId(),
        caseId,
        presetId: preset.id,
        postId: post.id,
        matchedKeywords: keywords,
        createdAt: nowIso(),
      });
      existing.add(key);
    }
  }
}

function ingestPosts(profile, posts) {
  const caseId = profile.caseId || activeCaseId();
  const byId = new Map(appState.posts.filter((post) => post.caseId === caseId).map((post) => [post.id, post]));
  const added = [];
  const touched = [];
  for (const incoming of posts) {
    const post = { ...incoming, caseId };
    const existing = byId.get(post.id);
    if (existing) {
      const previousText = String(existing.text || '');
      const previousMedia = JSON.stringify(existing.media || []);
      const previousHash = existing.evidenceHash || sha256(canonicalPostEvidence(existing));
      const firstObservedAt = existing.firstObservedAt || existing.collectedAt || post.firstObservedAt || nowIso();
      if (previousText !== String(post.text || '') || previousMedia !== JSON.stringify(post.media || [])) {
        existing.versionHistory = Array.isArray(existing.versionHistory) ? existing.versionHistory : [];
        existing.versionHistory.push({
          observedAt: nowIso(),
          text: previousText,
          media: Array.isArray(existing.media) ? existing.media : [],
          evidenceHash: previousHash,
        });
        if (existing.versionHistory.length > 20) existing.versionHistory = existing.versionHistory.slice(-20);
        addChangeEvent(profile, 'post_changed', `Previously captured post ${post.id} changed.`, { postId: post.id, url: post.url });
      }
      Object.assign(existing, post, {
        firstObservedAt,
        lastObservedAt: nowIso(),
        availability: 'observed',
        verifiedAt: nowIso(),
      });
      existing.evidenceHash = sha256(canonicalPostEvidence(existing));
      touched.push(existing);
    } else {
      post.firstObservedAt = post.firstObservedAt || nowIso();
      post.lastObservedAt = nowIso();
      post.evidenceHash = sha256(canonicalPostEvidence(post));
      appState.posts.push(post);
      byId.set(post.id, post);
      added.push(post);
      touched.push(post);
    }
  }

  appState.posts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const limit = Math.max(1000, Math.min(250000, Number(appState.settings.retentionLimit) || 50000));
  const casePosts = appState.posts.filter((post) => post.caseId === caseId);
  if (casePosts.length > limit) {
    const retainedCaseIds = new Set(casePosts.slice(0, limit).map((post) => post.id));
    appState.posts = appState.posts.filter((post) => post.caseId !== caseId || retainedCaseIds.has(post.id));
    appState.matches = appState.matches.filter((match) => match.caseId !== caseId || retainedCaseIds.has(match.postId));
    appState.notes = appState.notes.filter((note) => note.caseId !== caseId || retainedCaseIds.has(note.postId));
  }

  profile.lastCheckedAt = nowIso();
  profile.lastError = null;
  profile.collectedCount = appState.posts.filter((post) => post.profileId === profile.id && post.caseId === caseId).length;
  rebuildMatchesForPosts(added);
  for (const post of touched) indexEntitiesForPost(post);
  return { added: added.length, addedPosts: added, touched: touched.length, touchedPosts: touched };
}

async function refreshProfile(profileId) {
  const profile = appState.profiles.find((item) => item.id === profileId && item.caseId === activeCaseId());
  if (!profile) throw new Error('Profile not found in the active campaign.');
  if (sweepRunning) throw new Error('A collection sweep is already running.');

  sweepRunning = true;
  const run = startCollectionRun(profile, 'posts', Number(appState.settings.scrollPasses) || 5);
  emitProgress(`Collecting @${profile.username}…`, 0, 1);
  try {
    const posts = await scrapeProfile(profile);
    const ingest = ingestPosts(profile, posts);
    await archiveMediaForPosts(ingest.touchedPosts || [], profile);
    finishCollectionRun(run, {
      observed: posts.length,
      added: ingest.added,
      passesCompleted: posts.__meta?.passesCompleted || 0,
      stopReason: posts.__meta?.stopReason || 'complete',
    });
    appState.lastSweepAt = nowIso();
    await persistState();
    emitState();
    return { collected: posts.length, added: ingest.added };
  } catch (error) {
    profile.lastCheckedAt = nowIso();
    profile.lastError = error instanceof Error ? error.message : String(error);
    finishCollectionRun(run, { error: profile.lastError, stopReason: 'error' });
    await persistState();
    emitState();
    throw error;
  } finally {
    sweepRunning = false;
    emitProgress('Idle', 0, 0);
  }
}

async function refreshAll() {
  if (sweepRunning) throw new Error('A collection sweep is already running.');
  const caseId = activeCaseId();
  const profiles = appState.profiles.filter((profile) => profile.caseId === caseId && profile.enabled !== false);
  if (!profiles.length) throw new Error('Add at least one source profile to the active campaign first.');

  sweepRunning = true;
  const summary = [];
  try {
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      const run = startCollectionRun(profile, 'posts', Number(appState.settings.scrollPasses) || 5);
      emitProgress(`Collecting @${profile.username}…`, index + 1, profiles.length);
      try {
        const posts = await scrapeProfile(profile);
        const ingest = ingestPosts(profile, posts);
        await archiveMediaForPosts(ingest.touchedPosts || [], profile);
        finishCollectionRun(run, {
          observed: posts.length,
          added: ingest.added,
          passesCompleted: posts.__meta?.passesCompleted || 0,
          stopReason: posts.__meta?.stopReason || 'complete',
        });
        summary.push({ profileId: profile.id, username: profile.username, collected: posts.length, added: ingest.added });
      } catch (error) {
        profile.lastCheckedAt = nowIso();
        profile.lastError = error instanceof Error ? error.message : String(error);
        finishCollectionRun(run, { error: profile.lastError, stopReason: 'error' });
        summary.push({ profileId: profile.id, username: profile.username, error: profile.lastError });
      }
      await persistState();
      emitState();
      if (index < profiles.length - 1) await sleep(1500);
    }
    appState.lastSweepAt = nowIso();
    await persistState();
    emitState();
    return summary;
  } finally {
    sweepRunning = false;
    emitProgress('Idle', 0, 0);
  }
}

function restartAutoSweep() {
  if (autoSweepTimer) clearInterval(autoSweepTimer);
  autoSweepTimer = null;
  if (!appState?.settings?.autoSweep) return;

  const minutes = Math.max(5, Math.min(1440, Number(appState.settings.intervalMinutes) || 30));
  autoSweepTimer = setInterval(() => {
    if (!sweepRunning && appState.profiles.some((profile) => profile.caseId === activeCaseId() && profile.enabled !== false)) {
      runBackgroundTask('Automatic sweep', () => refreshAll());
    }
  }, minutes * 60 * 1000);
}


function getArchiveProfileProgress(profile) {
  if (!appState.archive || typeof appState.archive !== 'object') appState.archive = defaultState().archive;
  if (!appState.archive.profiles || typeof appState.archive.profiles !== 'object') appState.archive.profiles = {};
  const existing = appState.archive.profiles[profile.id] || {};
  const oldestExisting = appState.posts
    .filter((post) => post.profileId === profile.id)
    .map((post) => String(post.createdAt || ''))
    .filter(Boolean)
    .sort()[0] || null;
  const progress = {
    postPasses: Math.max(1, Number(existing.postPasses) || Number(appState.settings.scrollPasses) || 5),
    followerPasses: Math.max(1, Number(existing.followerPasses) || Number(appState.settings.relationshipScrollPasses) || 8),
    followingPasses: Math.max(1, Number(existing.followingPasses) || Number(appState.settings.relationshipScrollPasses) || 8),
    lastPostRunAt: existing.lastPostRunAt || null,
    lastFollowerRunAt: existing.lastFollowerRunAt || null,
    lastFollowingRunAt: existing.lastFollowingRunAt || null,
    oldestPostAt: existing.oldestPostAt || oldestExisting,
    postAddedTotal: Math.max(0, Number(existing.postAddedTotal) || 0),
    followerAddedTotal: Math.max(0, Number(existing.followerAddedTotal) || 0),
    followingAddedTotal: Math.max(0, Number(existing.followingAddedTotal) || 0),
  };
  appState.archive.profiles[profile.id] = progress;
  return progress;
}

function buildArchiveOperations() {
  const operations = [];
  for (const profile of appState.profiles.filter((item) => item.caseId === activeCaseId() && item.enabled !== false)) {
    operations.push({ profile, type: 'posts' });
    if (appState.settings.archiveFollowers) operations.push({ profile, type: 'follower' });
    if (appState.settings.archiveFollowing) operations.push({ profile, type: 'following' });
  }
  return operations;
}

async function runArchiveCycle() {
  if (sweepRunning) throw new Error('Another collection operation is already running.');
  const operations = buildArchiveOperations();
  if (!operations.length) throw new Error('Add and enable at least one source profile first.');

  const rawIndex = Math.max(0, Number(appState.archive?.nextOperationIndex) || 0);
  const operationIndex = rawIndex % operations.length;
  const operation = operations[operationIndex];
  const { profile, type } = operation;
  const progress = getArchiveProfileProgress(profile);
  sweepRunning = true;

  try {
    let result;
    if (type === 'posts') {
      const step = Math.max(1, Math.min(20, Number(appState.settings.archivePostStep) || 2));
      const maximum = Math.max(
        Number(appState.settings.scrollPasses) || 5,
        Math.min(120, Number(appState.settings.archivePostMaxPasses) || 40)
      );
      const requestedPasses = Math.min(maximum, Math.max(Number(appState.settings.scrollPasses) || 5, progress.postPasses + step));
      emitProgress(`Incremental archive: @${profile.username} posts — depth ${requestedPasses}`, 0, requestedPasses + 1);
      const posts = await scrapeProfile(profile, {
        passes: requestedPasses,
        collectComments: false,
      collectImages: effectiveImageCollection(profile),
        progressLabel: 'Incremental archive',
        title: `Archiving @${profile.username}`,
      });
      const run = startCollectionRun(profile, 'archive_posts', requestedPasses);
      const ingest = ingestPosts(profile, posts);
      await archiveMediaForPosts(ingest.touchedPosts || [], profile);
      finishCollectionRun(run, { observed: posts.length, added: ingest.added, passesCompleted: posts.__meta?.passesCompleted || 0, stopReason: posts.__meta?.stopReason || 'complete' });
      progress.postPasses = requestedPasses;
      progress.lastPostRunAt = nowIso();
      progress.postAddedTotal += ingest.added;
      progress.oldestPostAt = appState.posts
        .filter((post) => post.profileId === profile.id)
        .map((post) => String(post.createdAt || ''))
        .filter(Boolean)
        .sort()[0] || progress.oldestPostAt;
      result = { type, profileId: profile.id, username: profile.username, depth: requestedPasses, collected: posts.length, added: ingest.added };
    } else {
      const step = Math.max(1, Math.min(20, Number(appState.settings.archiveRelationshipStep) || 3));
      const maximum = Math.max(
        Number(appState.settings.relationshipScrollPasses) || 8,
        Math.min(240, Number(appState.settings.archiveRelationshipMaxPasses) || 160)
      );
      const key = type === 'follower' ? 'followerPasses' : 'followingPasses';
      const requestedPasses = Math.min(maximum, Math.max(Number(appState.settings.relationshipScrollPasses) || 8, progress[key] + step));
      const label = type === 'follower' ? 'followers' : 'following';
      emitProgress(`Incremental archive: @${profile.username} ${label} — depth ${requestedPasses}`, 0, requestedPasses + 1);
      const rows = await scrapeRelationshipRows(profile, type, {
        passes: requestedPasses,
        progressLabel: 'Incremental archive',
        title: `Archiving ${label} — @${profile.username}`,
      });
      const run = startCollectionRun(profile, type === 'follower' ? 'archive_followers' : 'archive_following', requestedPasses);
      const ingest = ingestRelationships(profile, type, rows);
      const snapshot = recordNetworkSnapshot(profile, type, rows, rows.__meta || {}, ingest.addedUsernames);
      finishCollectionRun(run, {
        observed: rows.length,
        added: ingest.added,
        passesCompleted: rows.__meta?.passesCompleted || 0,
        stopReason: rows.__meta?.stopReason || 'complete',
        reachedEnd: Boolean(rows.__meta?.reachedEnd),
        frontierUsernames: rows.__meta?.frontierUsernames || [],
        snapshotId: snapshot.id,
      });
      progress[key] = requestedPasses;
      if (type === 'follower') {
        progress.lastFollowerRunAt = nowIso();
        progress.followerAddedTotal += ingest.added;
      } else {
        progress.lastFollowingRunAt = nowIso();
        progress.followingAddedTotal += ingest.added;
      }
      result = { type, profileId: profile.id, username: profile.username, depth: requestedPasses, collected: rows.length, added: ingest.added };
    }

    appState.archive.nextOperationIndex = (operationIndex + 1) % operations.length;
    appState.archive.lastCycleAt = nowIso();
    appState.archive.cyclesCompleted = Math.max(0, Number(appState.archive.cyclesCompleted) || 0) + 1;
    await persistState();
    emitState();
    return result;
  } catch (error) {
    profile.lastError = error instanceof Error ? error.message : String(error);
    await persistState();
    emitState();
    throw error;
  } finally {
    sweepRunning = false;
    emitProgress('Idle', 0, 0);
  }
}

function restartArchiveTimer() {
  if (archiveTimer) clearInterval(archiveTimer);
  archiveTimer = null;
  if (!appState?.settings?.archiveEnabled) return;

  const minutes = Math.max(30, Math.min(10080, Number(appState.settings.archiveIntervalMinutes) || 240));
  archiveTimer = setInterval(() => {
    if (!sweepRunning && appState.profiles.some((profile) => profile.caseId === activeCaseId() && profile.enabled !== false)) {
      runBackgroundTask('Incremental archive cycle', () => runArchiveCycle());
    }
  }, minutes * 60 * 1000);
}

function filteredPosts(filters = {}) {
  const caseId = activeCaseId();
  let posts = appState.posts.filter((post) => post.caseId === caseId);
  if (filters.profileId) posts = posts.filter((post) => post.profileId === filters.profileId);
  if (filters.kind && filters.kind !== 'all') {
    posts = posts.filter((post) => (post.kind || (post.isReply ? 'reply' : 'post')) === filters.kind);
  }
  if (filters.query) {
    const query = String(filters.query).toLowerCase();
    posts = posts.filter((post) => {
      const noteText = appState.notes.filter((note) => note.caseId === caseId && note.postId === post.id).map((note) => note.text).join(' ').toLowerCase();
      return post.text.toLowerCase().includes(query) || noteText.includes(query);
    });
  }
  if (filters.presetId) {
    const matchedIds = new Set(
      appState.matches.filter((match) => match.caseId === caseId && match.presetId === filters.presetId).map((match) => match.postId)
    );
    posts = posts.filter((post) => matchedIds.has(post.id));
  }
  return posts;
}

async function writeChecksumSidecar(filePath, dataBuffer = null) {
  const buffer = dataBuffer || await fs.readFile(filePath);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const checksumPath = `${filePath}.sha256.txt`;
  await fs.writeFile(checksumPath, `${digest}  ${path.basename(filePath)}
`, 'utf8');
  return { sha256: digest, checksumPath };
}

async function exportJson(filters) {
  const caseId = activeCaseId();
  const currentCase = appState.cases.find((item) => item.id === caseId) || null;
  const posts = filteredPosts(filters);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${APP_TITLE} JSON`,
    defaultPath: `cybervs-dominatvs-x-listening-station-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON file', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const postIds = new Set(posts.map((post) => post.id));
  const profileIds = new Set(posts.map((post) => post.profileId));
  const payload = {
    format: 'CYBERVS DOMINATVS X Listening Station Enterprise Export',
    schemaVersion: appState.schemaVersion,
    exportedAt: nowIso(),
    case: currentCase,
    filters: filters || {},
    profiles: appState.profiles.filter((profile) => profile.caseId === caseId && profileIds.has(profile.id)),
    posts,
    notes: appState.notes.filter((note) => note.caseId === caseId && postIds.has(note.postId)),
    matches: appState.matches.filter((match) => match.caseId === caseId && postIds.has(match.postId)),
    entities: appState.entities.filter((entity) => entity.caseId === caseId && entity.postIds.some((id) => postIds.has(id))),
    provenance: {
      collectionMethod: 'authenticated_browser',
      generatedBy: `${APP_TITLE} ${APP_BYLINE}`,
      recordHashAlgorithm: 'SHA-256',
    },
  };
  payload.manifestHash = sha256(payload);
  const text = JSON.stringify(payload, null, 2);
  await fs.writeFile(result.filePath, text, 'utf8');
  const checksum = await writeChecksumSidecar(result.filePath, Buffer.from(text, 'utf8'));
  return { canceled: false, filePath: result.filePath, count: posts.length, ...checksum };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function exportPdf(filters) {
  const posts = filteredPosts(filters).slice(0, 5000);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${APP_TITLE} PDF`,
    defaultPath: `cybervs-dominatvs-x-listening-station-${new Date().toISOString().slice(0, 10)}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const rows = posts.map((post) => {
    const notes = appState.notes
      .filter((note) => note.postId === post.id)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const notesHtml = notes.length
      ? `<section class="analyst-notes"><h3>Analyst notes</h3>${notes.map((note) => `<div class="analyst-note"><p>${escapeHtml(note.text).replaceAll('\n', '<br>')}</p><small>Updated ${escapeHtml(note.updatedAt)}</small></div>`).join('')}</section>`
      : '';
    return `
    <article>
      <header><strong>@${escapeHtml(post.username)}</strong><span>${escapeHtml(post.createdAt)}</span></header>
      <p>${escapeHtml(post.text).replaceAll('\n', '<br>')}</p>
      ${notesHtml}
      <footer>${escapeHtml(String(post.kind || (post.isReply ? 'reply' : 'post')).toUpperCase())} · Monitored via @${escapeHtml(post.sourceUsername || post.username)} · First observed ${escapeHtml(post.firstObservedAt || post.collectedAt)} · Last observed ${escapeHtml(post.lastObservedAt || post.collectedAt)} · SHA-256 ${escapeHtml(post.evidenceHash || '')}<br>${escapeHtml(post.url)}</footer>
    </article>
  `;
  }).join('');

  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 10pt; }
    h1 { font-size: 20pt; margin: 0 0 4px; }
    .byline { color: #2b5d84; font-weight: 700; letter-spacing: .08em; margin-bottom: 4px; }
    .meta { color: #555; margin-bottom: 18px; }
    article { break-inside: avoid; border-top: 1px solid #bbb; padding: 10px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; }
    header span, footer { color: #555; font-size: 8.5pt; }
    p { line-height: 1.4; white-space: normal; }
    .analyst-notes { margin: 9px 0; padding: 8px 10px; border-left: 3px solid #8a6a17; background: #f6f1e4; }
    .analyst-notes h3 { margin: 0 0 6px; font-size: 10pt; }
    .analyst-note { margin-top: 7px; padding-top: 7px; border-top: 1px solid #d8ccb0; }
    .analyst-note p { margin: 0 0 3px; }
    .analyst-note small { color: #666; }
  </style></head><body>
    <h1>CYBERVS DOMINATVS X LISTENING STATION</h1>
    <div class="byline">by GhostExodus</div>
    <div class="meta">Campaign: ${escapeHtml(appState.cases.find((item) => item.id === activeCaseId())?.name || 'Investigation')} · Exported ${escapeHtml(nowIso())} · ${posts.length} records · Individual findings carry SHA-256 evidence hashes</div>
    ${rows || '<p>No records matched the selected filters.</p>'}
  </body></html>`;

  const tempPath = path.join(app.getPath('temp'), `xls-report-${makeId()}.html`);
  const printWindow = new BrowserWindow({
    show: false,
    icon: runtimeIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    await fs.writeFile(tempPath, html, 'utf8');
    await printWindow.loadFile(tempPath);
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    await fs.writeFile(result.filePath, pdf);
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
    await fs.rm(tempPath, { force: true });
  }

  const checksum = await writeChecksumSidecar(result.filePath);
  return { canceled: false, filePath: result.filePath, count: posts.length, ...checksum };
}


async function installNetworkCollector(win) {
  await win.webContents.executeJavaScript(String.raw`
    (() => {
      const parseCell = (cell) => {
        const rawText = cell.innerText || '';
        const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        const links = Array.from(cell.querySelectorAll('a[href^="/"]')).map((link) => link.getAttribute('href') || '').filter(Boolean);
        const profileHref = links.find((href) => /^\/[A-Za-z0-9_]{1,15}$/.test(href)) || '';
        const hrefMatch = profileHref.match(/^\/([A-Za-z0-9_]{1,15})$/);
        const textMatch = rawText.match(/(?:^|\s)@([A-Za-z0-9_]{1,15})(?:\b|$)/);
        const username = hrefMatch?.[1] || textMatch?.[1] || '';
        if (!username) return null;
        const displayName = lines.find((line) => !line.startsWith('@') && !/^(Follow|Following|Follows you|Verified)$/i.test(line)) || username;
        const ignored = new Set([displayName, '@' + username, 'Follow', 'Following', 'Follows you', 'Verified']);
        const bio = lines.filter((line) => !ignored.has(line)).join(' ').trim();
        const avatar = cell.querySelector('img[src*="profile_images"]')?.getAttribute('src') || '';
        return { username, displayName, bio, url: profileHref ? new URL(profileHref, location.origin).href : '', avatar };
      };
      const collector = window.__xlsNetworkCollector = {
        rows: new Map(), order: [], captures: 0, maxScrollY: 0, lastGrowthAt: Date.now(), lastCount: 0,
      };
      collector.capture = () => {
        try {
          const scope = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document;
          const cells = Array.from(scope.querySelectorAll('[data-testid="UserCell"]'));
          for (const cell of cells) {
            const row = parseCell(cell);
            if (!row?.username || !row.url) continue;
            const key = row.username.toLowerCase();
            if (!collector.rows.has(key)) collector.order.push(key);
            collector.rows.set(key, row);
          }
          collector.captures += 1;
          const scroller = document.scrollingElement || document.documentElement;
          collector.maxScrollY = Math.max(collector.maxScrollY, scroller.scrollTop || 0);
          if (collector.rows.size > collector.lastCount) collector.lastGrowthAt = Date.now();
          collector.lastCount = collector.rows.size;
          collector.lastError = null;
        } catch (error) {
          collector.lastError = error instanceof Error ? error.message : String(error);
        }
        return collector.rows.size;
      };
      collector.observer = new MutationObserver(() => { try { collector.capture(); } catch (error) { collector.lastError = error instanceof Error ? error.message : String(error); } });
      collector.observer.observe(document.body, { childList: true, subtree: true });
      collector.capture();
      return collector.rows.size;
    })()
  `, true);
}

async function readNetworkCollector(win) {
  const result = await win.webContents.executeJavaScript(String.raw`
    (() => {
      const c = window.__xlsNetworkCollector;
      if (!c) return { rows: [], order: [], count: 0, scrollTop: 0, scrollHeight: 0, innerHeight: innerHeight };
      c.capture();
      const scroller = document.scrollingElement || document.documentElement;
      return {
        rows: Array.from(c.rows.values()),
        order: Array.from(c.order),
        count: c.rows.size,
        captures: c.captures,
        maxScrollY: c.maxScrollY,
        scrollTop: scroller.scrollTop || 0,
        scrollHeight: scroller.scrollHeight || 0,
        innerHeight: innerHeight,
        lastGrowthAt: c.lastGrowthAt,
        lastError: c.lastError || null,
      };
    })()
  `, true);
  return result && typeof result === 'object' ? result : { rows: [], order: [], count: 0 };
}

function ingestRelationships(profile, relationship, rows) {
  const caseId = profile.caseId || activeCaseId();
  const byKey = new Map(appState.relationships.filter((item) => item.caseId === caseId).map((item) => [
    `${item.profileId}:${item.relationship}:${String(item.username).toLowerCase()}`,
    item,
  ]));
  const collectedAt = nowIso();
  const addedUsernames = [];
  let updated = 0;
  for (const row of rows) {
    const username = String(row.username || '').replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) continue;
    const key = `${profile.id}:${relationship}:${username.toLowerCase()}`;
    const existing = byKey.get(key);
    const record = {
      id: existing?.id || makeId(),
      caseId,
      profileId: profile.id,
      sourceUsername: profile.username,
      relationship,
      username,
      displayName: String(row.displayName || username),
      bio: String(row.bio || ''),
      url: String(row.url || `https://x.com/${username}`),
      avatar: String(row.avatar || ''),
      collectedAt,
      firstObservedAt: existing?.firstObservedAt || existing?.collectedAt || collectedAt,
      lastObservedAt: collectedAt,
      observedCount: Math.max(0, Number(existing?.observedCount) || 0) + 1,
    };
    record.evidenceHash = sha256(canonicalRelationshipEvidence(record));
    if (existing) {
      Object.assign(existing, record);
      updated += 1;
    } else {
      appState.relationships.push(record);
      byKey.set(key, record);
      addedUsernames.push(username);
    }
  }
  appState.relationships.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  return { added: addedUsernames.length, addedUsernames, updated };
}

async function scrapeRelationshipRows(profile, relationship, options = {}) {
  if (!['follower', 'following'].includes(relationship)) throw new Error('Unknown relationship type.');
  const status = await getXSessionStatus();
  if (!status.connected) throw new Error('X is not connected. Open System, select Connect X, and sign in.');

  const label = relationship === 'follower' ? 'followers' : 'following';
  const requestedPasses = Number.isFinite(Number(options.passes))
    ? Number(options.passes)
    : Number(appState.settings.relationshipScrollPasses) || 8;
  const passes = Math.max(1, Math.min(240, requestedPasses));
  const delay = Math.max(500, Math.min(5000, Number(appState.settings.scrollDelayMs) || 1100));
  const stagnationLimit = Math.max(4, Math.min(20, Number(appState.settings.networkStagnationLimit) || 7));
  const win = createRemoteWindow({ title: options.title || `Extracting ${label} — @${profile.username}`, show: false });

  try {
    await win.loadURL(`https://x.com/${encodeURIComponent(profile.username)}/${label}`);
    await sleep(3500);
    await assertSignedInPage(win);
    await installNetworkCollector(win);

    let stagnantPasses = 0;
    let previousSize = 0;
    let passesCompleted = 0;
    let reachedEnd = false;
    let stopReason = 'pass_limit';
    for (let index = 0; index <= passes; index += 1) {
      passesCompleted = index + 1;
      const state = await readNetworkCollector(win);
      if (state.lastError) startupLog(`Network page collector recovered from a renderer error for @${profile.username}: ${state.lastError}`);
      if (state.count === previousSize) stagnantPasses += 1;
      else stagnantPasses = 0;
      previousSize = state.count;
      reachedEnd = Number(state.scrollTop || 0) + Number(state.innerHeight || 0) >= Number(state.scrollHeight || 0) - 8;

      const prefix = options.progressLabel || `Extracting ${label}`;
      emitProgress(`${prefix} for @${profile.username} — pass ${index + 1}/${passes + 1} — ${state.count} unique`, index + 1, passes + 1);

      if (index >= passes) break;
      if (stagnantPasses >= stagnationLimit && reachedEnd) {
        stopReason = 'stable_end';
        break;
      }

      await win.webContents.executeJavaScript(String.raw`
        (() => {
          const scroller = document.scrollingElement || document.documentElement;
          const jump = Math.max(innerHeight * 0.9, 650);
          const target = Math.min(scroller.scrollHeight, (scroller.scrollTop || 0) + jump);
          scroller.scrollTo({ top: target, behavior: 'auto' });
          window.__xlsNetworkCollector?.capture?.();
          return { top: scroller.scrollTop, height: scroller.scrollHeight };
        })()
      `, true);
      await sleep(delay);
      await assertSignedInPage(win);
    }

    const finalState = await readNetworkCollector(win);
    const rows = Array.isArray(finalState.rows) ? finalState.rows : [];
    rows.__meta = {
      requestedPasses: passes,
      passesCompleted,
      reachedEnd,
      stopReason,
      frontierUsernames: Array.isArray(finalState.order) ? finalState.order.slice(-12) : [],
      maxScrollY: finalState.maxScrollY || 0,
      captures: finalState.captures || 0,
    };
    return rows;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function extractRelationships(profileId, relationship) {
  if (!['follower', 'following'].includes(relationship)) throw new Error('Unknown relationship type.');
  const profile = appState.profiles.find((item) => item.id === profileId && item.caseId === activeCaseId());
  if (!profile) throw new Error('Profile not found in the active campaign.');
  if (sweepRunning) throw new Error('Another collection operation is already running.');

  sweepRunning = true;
  const label = relationship === 'follower' ? 'followers' : 'following';
  const passes = Math.max(1, Math.min(60, Number(appState.settings.relationshipScrollPasses) || 8));
  const run = startCollectionRun(profile, label, passes);
  emitProgress(`Extracting ${label} for @${profile.username}…`, 0, 1);
  try {
    const rows = await scrapeRelationshipRows(profile, relationship, { passes });
    const ingest = ingestRelationships(profile, relationship, rows);
    const snapshot = recordNetworkSnapshot(profile, relationship, rows, rows.__meta || {}, ingest.addedUsernames);
    finishCollectionRun(run, {
      observed: rows.length,
      added: ingest.added,
      passesCompleted: rows.__meta?.passesCompleted || 0,
      stopReason: rows.__meta?.stopReason || 'complete',
      reachedEnd: Boolean(rows.__meta?.reachedEnd),
      frontierUsernames: rows.__meta?.frontierUsernames || [],
      snapshotId: snapshot.id,
    });
    await persistState();
    emitState();
    return { collected: rows.length, added: ingest.added, relationship, reachedEnd: snapshot.reachedEnd };
  } catch (error) {
    finishCollectionRun(run, { error: error instanceof Error ? error.message : String(error), stopReason: 'error' });
    throw error;
  } finally {
    sweepRunning = false;
    emitProgress('Idle', 0, 0);
  }
}

function filteredRelationships(filters = {}) {
  let rows = appState.relationships.filter((item) => item.caseId === activeCaseId());
  if (filters.profileId) rows = rows.filter((item) => item.profileId === filters.profileId);
  if (filters.relationship && filters.relationship !== 'all') {
    rows = rows.filter((item) => item.relationship === filters.relationship);
  }
  if (filters.query) {
    const query = String(filters.query).toLowerCase();
    rows = rows.filter((item) => [item.username, item.displayName, item.bio]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

async function exportRelationshipsJson(filters) {
  const rows = filteredRelationships(filters);
  const caseRecord = appState.cases.find((item) => item.id === activeCaseId()) || null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export followers and following as JSON',
    defaultPath: `cybervs-dominatvs-x-listening-station-network-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON file', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const payload = {
    format: 'CYBERVS DOMINATVS X Listening Station Network Export',
    exportedAt: nowIso(), case: caseRecord, filters: filters || {}, relationships: rows,
    analysis: computeNetworkAnalysis(appState, activeCaseId()),
  };
  payload.manifestHash = sha256(payload);
  const text = JSON.stringify(payload, null, 2);
  await fs.writeFile(result.filePath, text, 'utf8');
  const checksum = await writeChecksumSidecar(result.filePath, Buffer.from(text, 'utf8'));
  return { canceled: false, filePath: result.filePath, count: rows.length, ...checksum };
}

async function exportRelationshipsCsv(filters) {
  const rows = filteredRelationships(filters);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export followers and following as CSV',
    defaultPath: `cybervs-dominatvs-x-listening-station-network-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV file', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const header = ['source_username', 'relationship', 'username', 'display_name', 'bio', 'url', 'first_observed_at', 'last_observed_at', 'observed_count', 'evidence_sha256'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      row.sourceUsername, row.relationship, row.username, row.displayName, row.bio, row.url,
      row.firstObservedAt || row.collectedAt, row.lastObservedAt || row.collectedAt, row.observedCount || 1, row.evidenceHash || '',
    ].map(csvCell).join(','));
  }
  const text = `\uFEFF${lines.join('\r\n')}`;
  await fs.writeFile(result.filePath, text, 'utf8');
  const checksum = await writeChecksumSidecar(result.filePath, Buffer.from(text, 'utf8'));
  return { canceled: false, filePath: result.filePath, count: rows.length, ...checksum };
}

function loadDemoData() {
  const demoProfiles = [
    { username: 'SignalWatch', displayName: 'Signal Watch' },
    { username: 'OpenSourceDesk', displayName: 'Open Source Desk' },
  ];
  const timestamp = Date.now();
  const caseId = activeCaseId();

  for (const item of demoProfiles) {
    let profile = appState.profiles.find((candidate) => candidate.caseId === caseId && candidate.username.toLowerCase() === item.username.toLowerCase());
    if (!profile) {
      profile = {
        id: makeId(),
        caseId,
        username: item.username,
        displayName: item.displayName,
        enabled: true,
        addedAt: nowIso(),
        lastCheckedAt: null,
        lastError: null,
        collectedCount: 0,
      };
      appState.profiles.push(profile);
    }

    const examples = item.username === 'SignalWatch'
      ? [
          'Demo alert: infrastructure disruption reports are increasing in the monitored region.',
          'Analyst note: verify the original source before treating screenshots as confirmed evidence.',
          'Replying to a researcher: archive the post URL and capture time before escalation.',
        ]
      : [
          'Daily OSINT brief: several accounts are repeating the same unverified claim.',
          'Keyword watch detected references to a planned announcement later this week.',
          'Replying to the thread: geolocation remains inconclusive from the available imagery.',
        ];

    examples.forEach((text, index) => {
      const id = `demo-${profile.id}-${index}`;
      if (appState.posts.some((post) => post.id === id)) return;
      appState.posts.push({
        id,
        caseId,
        profileId: profile.id,
        username: profile.username,
        sourceUsername: profile.username,
        url: `https://x.com/${profile.username}/status/${timestamp + index}`,
        text,
        createdAt: new Date(timestamp - index * 3600000).toISOString(),
        collectedAt: nowIso(),
        firstObservedAt: nowIso(),
        lastObservedAt: nowIso(),
        collectionMethod: 'demo',
        versionHistory: [],
        availability: 'demo',
        verifiedAt: nowIso(),
        kind: text.startsWith('Replying') ? 'reply' : 'post',
        isReply: text.startsWith('Replying'),
        parentPostId: null,
        metrics: { replies: index + 1, reposts: index * 2, likes: 10 + index * 3, views: 100 + index * 50 },
        media: [],
      });
    });

    const demoNetwork = [
      { relationship: 'follower', username: `${item.username}Observer`, displayName: `${item.displayName} Observer` },
      { relationship: 'following', username: `${item.username}Source`, displayName: `${item.displayName} Source` },
    ];
    for (const row of demoNetwork) {
      if (appState.relationships.some((candidate) => candidate.profileId === profile.id && candidate.relationship === row.relationship && candidate.username === row.username)) continue;
      appState.relationships.push({
        id: makeId(),
        caseId,
        profileId: profile.id,
        sourceUsername: profile.username,
        relationship: row.relationship,
        username: row.username.slice(0, 15),
        displayName: row.displayName,
        bio: 'Demo network identity for interface testing.',
        url: `https://x.com/${row.username.slice(0, 15)}`,
        avatar: '',
        collectedAt: nowIso(),
        firstObservedAt: nowIso(),
        lastObservedAt: nowIso(),
        observedCount: 1,
      });
    }
  }

  appState.posts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  rebuildMatchesForPosts(appState.posts);
}

async function openUsernameProfile(rawUsername) {
  const username = normalizeUsername(rawUsername);
  const targetUrl = `https://x.com/${encodeURIComponent(username)}`;
  const win = createRemoteWindow({ title: `@${username} — X Profile`, show: true, mediaEnabled: Boolean(activeSettings().collectImages) });
  await win.loadURL(targetUrl);
  return { opened: true, url: targetUrl };
}

async function verifyPostLive(postId) {
  const post = appState.posts.find((item) => item.id === postId && item.caseId === activeCaseId());
  if (!post) throw new Error('Finding not found in the active campaign.');
  const profile = appState.profiles.find((item) => item.id === post.profileId) || { id: post.profileId, username: post.sourceUsername, caseId: post.caseId };
  const win = createRemoteWindow({ title: `Verifying @${post.username} post`, show: false, mediaEnabled: effectiveImageCollection(profile) });
  try {
    await win.loadURL(post.url);
    await sleep(2600);
    await assertSignedInPage(win);
    const page = await win.webContents.executeJavaScript(String.raw`
      (() => ({
        body: (document.body?.innerText || '').slice(0, 12000),
        items: Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map((article) => {
          const time = article.querySelector('time');
          const link = time?.closest('a[href*="/status/"]') || article.querySelector('a[href*="/status/"]');
          const href = link?.getAttribute('href') || '';
          const m = href.match(/\/status\/(\d+)/);
          return { id: m?.[1] || '', text: article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '' };
        })
      }))()
    `, true);
    const unavailable = /this post is unavailable|post deleted|page doesn.t exist|nothing to see here/i.test(String(page?.body || ''));
    const live = Array.isArray(page?.items) ? page.items.find((item) => String(item.id) === String(post.id).replace(/^.*:/, '')) : null;
    const previousAvailability = post.availability || 'unknown';
    let changed = false;
    post.verifiedAt = nowIso();
    if (unavailable && !live) {
      post.availability = 'unavailable';
      if (previousAvailability !== 'unavailable') addChangeEvent(profile, 'post_unavailable', `Post ${post.id} is no longer available at its original URL.`, { postId: post.id, url: post.url });
    } else {
      post.availability = 'available';
      if (live?.text && live.text !== post.text) {
        changed = true;
        post.versionHistory = Array.isArray(post.versionHistory) ? post.versionHistory : [];
        post.versionHistory.push({ observedAt: nowIso(), text: post.text, evidenceHash: post.evidenceHash || '' });
        post.text = live.text;
        post.lastObservedAt = nowIso();
        post.evidenceHash = sha256(canonicalPostEvidence(post));
        indexEntitiesForPost(post);
        addChangeEvent(profile, 'post_changed', `Live text changed for post ${post.id}.`, { postId: post.id, url: post.url });
      }
    }
    await persistState();
    emitState();
    return { availability: post.availability, verifiedAt: post.verifiedAt, changed };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function registerIpc() {
  handle('state:get', async () => getClientState());

  handle('cases:create', async (input) => {
    const name = String(input?.name || '').trim();
    const purpose = String(input?.purpose || input?.description || '').trim();
    const description = String(input?.description || '').trim();
    if (!name) throw new Error('Case name is required.');
    const caseRecord = { id: makeId(), name, purpose, description, createdAt: nowIso(), updatedAt: nowIso() };
    appState.cases.push(caseRecord);
    appState.activeCaseId = caseRecord.id;
    appState.campaignSettings[caseRecord.id] = { ...defaultState().settings, ...appState.settings };
    syncActiveSettings(caseRecord.id);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    restartAutoSweep();
    restartArchiveTimer();
    emitState();
    return getClientState();
  });

  handle('cases:switch', async (id) => {
    if (!appState.cases.some((item) => item.id === id)) throw new Error('Case not found.');
    if (sweepRunning) throw new Error('Wait for the current collection operation to finish before switching cases.');
    appState.activeCaseId = id;
    syncActiveSettings(id);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    restartAutoSweep();
    restartArchiveTimer();
    emitState();
    return getClientState();
  });

  handle('cases:update', async (id, input) => {
    const item = appState.cases.find((candidate) => candidate.id === id);
    if (!item) throw new Error('Case not found.');
    const name = String(input?.name || item.name).trim();
    if (!name) throw new Error('Case name is required.');
    item.name = name;
    item.purpose = String(input?.purpose ?? item.purpose ?? '').trim();
    item.description = String(input?.description ?? item.description ?? '').trim();
    item.updatedAt = nowIso();
    await persistState();
    emitState();
    return item;
  });

  handle('cases:delete-empty', async (id) => {
    if (appState.cases.length <= 1) throw new Error('At least one case must remain.');
    const hasData = ['profiles', 'posts', 'relationships', 'notes', 'presets'].some((key) => (appState[key] || []).some((item) => item.caseId === id));
    if (hasData) throw new Error('This case contains investigation data. Export or remove its data before deleting the case.');
    appState.cases = appState.cases.filter((item) => item.id !== id);
    if (appState.activeCaseId === id) appState.activeCaseId = appState.cases[0].id;
    await persistState();
    emitState();
    return getClientState();
  });

  handle('campaigns:create', async (input) => {
    const name = String(input?.name || '').trim();
    const purpose = String(input?.purpose || '').trim();
    const description = String(input?.description || '').trim();
    if (!name) throw new Error('Campaign name is required.');
    const campaign = { id: makeId(), name, purpose, description, createdAt: nowIso(), updatedAt: nowIso() };
    appState.cases.push(campaign);
    appState.campaignSettings[campaign.id] = { ...defaultState().settings, ...activeSettings() };
    appState.activeCaseId = campaign.id;
    syncActiveSettings(campaign.id);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    restartAutoSweep();
    restartArchiveTimer();
    emitState();
    return getClientState();
  });

  handle('campaigns:switch', async (id) => {
    if (!appState.cases.some((item) => item.id === id)) throw new Error('Campaign not found.');
    if (sweepRunning) throw new Error('Wait for the current collection operation to finish before switching campaigns.');
    appState.activeCaseId = id;
    syncActiveSettings(id);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    restartAutoSweep();
    restartArchiveTimer();
    emitState();
    return getClientState();
  });

  handle('campaigns:update', async (id, input) => {
    const campaign = appState.cases.find((candidate) => candidate.id === id);
    if (!campaign) throw new Error('Campaign not found.');
    const name = String(input?.name ?? campaign.name).trim();
    if (!name) throw new Error('Campaign name is required.');
    campaign.name = name;
    campaign.purpose = String(input?.purpose ?? campaign.purpose ?? '').trim();
    campaign.description = String(input?.description ?? campaign.description ?? '').trim();
    campaign.updatedAt = nowIso();
    await persistState();
    emitState();
    return campaign;
  });

  handle('campaigns:duplicate', async (id) => {
    const source = appState.cases.find((candidate) => candidate.id === id);
    if (!source) throw new Error('Campaign not found.');
    const campaign = { ...source, id: makeId(), name: `${source.name} Copy`, createdAt: nowIso(), updatedAt: nowIso() };
    appState.cases.push(campaign);
    appState.campaignSettings[campaign.id] = { ...defaultState().settings, ...(appState.campaignSettings?.[id] || activeSettings()) };
    const profileMap = new Map();
    for (const profile of appState.profiles.filter((item) => item.caseId === id)) {
      const cloned = { ...profile, id: makeId(), caseId: campaign.id, addedAt: nowIso(), lastCheckedAt: null, lastError: null, collectedCount: 0 };
      profileMap.set(profile.id, cloned.id);
      appState.profiles.push(cloned);
    }
    for (const preset of appState.presets.filter((item) => item.caseId === id)) {
      appState.presets.push({ ...preset, id: makeId(), caseId: campaign.id, profileIds: (preset.profileIds || []).map((profileId) => profileMap.get(profileId)).filter(Boolean), updatedAt: nowIso() });
    }
    appState.activeCaseId = campaign.id;
    syncActiveSettings(campaign.id);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    emitState();
    return getClientState();
  });

  handle('campaigns:delete', async (id) => {
    if (appState.cases.length <= 1) throw new Error('At least one campaign must remain.');
    const campaign = appState.cases.find((item) => item.id === id);
    if (!campaign) throw new Error('Campaign not found.');
    const postIds = new Set(appState.posts.filter((item) => item.caseId === id).map((item) => item.id));
    const profileIds = new Set(appState.profiles.filter((item) => item.caseId === id).map((item) => item.id));
    for (const key of ['profiles','posts','relationships','notes','presets','matches','entities','profileSnapshots','changeEvents','collectionRuns','networkSnapshots','networkEvents']) {
      appState[key] = (appState[key] || []).filter((item) => item.caseId !== id);
    }
    for (const profileId of profileIds) if (appState.archive?.profiles) delete appState.archive.profiles[profileId];
    if (appState.campaignSettings) delete appState.campaignSettings[id];
    try { await fs.rm(path.join(app.getPath('userData'), 'evidence-media', id), { recursive: true, force: true }); } catch {}
    appState.cases = appState.cases.filter((item) => item.id !== id);
    if (appState.activeCaseId === id) appState.activeCaseId = appState.cases[0].id;
    syncActiveSettings(appState.activeCaseId);
    appState.archive.nextOperationIndex = 0;
    await persistState();
    restartAutoSweep();
    restartArchiveTimer();
    emitState();
    return getClientState();
  });

  handle('profiles:add', async (input) => {
    const username = normalizeUsername(input);
    const caseId = activeCaseId();
    if (appState.profiles.some((profile) => profile.caseId === caseId && profile.username.toLowerCase() === username.toLowerCase())) {
      throw new Error(`@${username} is already in this case.`);
    }
    appState.profiles.push({
      id: makeId(), caseId, username, displayName: `@${username}`, bio: '', avatar: '', location: '', website: '',
      enabled: true, imageMode: 'inherit', addedAt: nowIso(), lastCheckedAt: null, lastError: null, collectedCount: 0,
    });
    await persistState();
    emitState();
    return getClientState();
  });

  handle('profiles:set-image-mode', async (id, mode) => {
    const profile = appState.profiles.find((item) => item.id === id && item.caseId === activeCaseId());
    if (!profile) throw new Error('Profile not found in the active campaign.');
    if (!['on', 'off', 'inherit'].includes(mode)) throw new Error('Invalid image collection mode.');
    profile.imageMode = mode;
    await persistState();
    emitState();
    return { id: profile.id, imageMode: profile.imageMode, effective: effectiveImageCollection(profile) };
  });

  handle('media:get-data-url', getPostMediaDataUrl);
  handle('avatars:get-data-url', getAvatarDataUrl);

  handle('profiles:remove', async (id) => {
    const caseId = activeCaseId();
    const profile = appState.profiles.find((item) => item.id === id && item.caseId === caseId);
    if (!profile) throw new Error('Profile not found in the active campaign.');
    appState.profiles = appState.profiles.filter((item) => item.id !== id);
    const removedPostIds = new Set(appState.posts.filter((post) => post.profileId === id && post.caseId === caseId).map((post) => post.id));
    appState.posts = appState.posts.filter((post) => post.profileId !== id);
    appState.relationships = appState.relationships.filter((item) => item.profileId !== id);
    appState.matches = appState.matches.filter((match) => !removedPostIds.has(match.postId));
    appState.notes = appState.notes.filter((note) => !removedPostIds.has(note.postId));
    appState.profileSnapshots = appState.profileSnapshots.filter((item) => item.profileId !== id);
    appState.changeEvents = appState.changeEvents.filter((item) => item.profileId !== id);
    appState.collectionRuns = appState.collectionRuns.filter((item) => item.profileId !== id);
    appState.networkSnapshots = appState.networkSnapshots.filter((item) => item.profileId !== id);
    appState.networkEvents = appState.networkEvents.filter((item) => item.profileId !== id);
    if (appState.archive?.profiles) delete appState.archive.profiles[id];
    if (appState.archive) appState.archive.nextOperationIndex = 0;
    await persistState();
    emitState();
    return getClientState();
  });

  handle('profiles:refresh', refreshProfile);
  handle('profiles:refresh-all', refreshAll);
  handle('feed:open-profile', openProfileFeed);
  handle('feed:open-thread', openPostThread);
  handle('feed:verify-post', verifyPostLive);
  handle('identity:open-profile', openUsernameProfile);

  handle('relationships:open-profile', openRelationshipProfile);
  handle('relationships:extract', extractRelationships);
  handle('relationships:export-json', exportRelationshipsJson);
  handle('relationships:export-csv', exportRelationshipsCsv);
  handle('relationships:clear', async (profileId) => {
    const caseId = activeCaseId();
    appState.relationships = profileId
      ? appState.relationships.filter((item) => !(item.caseId === caseId && item.profileId === profileId))
      : appState.relationships.filter((item) => item.caseId !== caseId);
    appState.networkSnapshots = profileId
      ? appState.networkSnapshots.filter((item) => !(item.caseId === caseId && item.profileId === profileId))
      : appState.networkSnapshots.filter((item) => item.caseId !== caseId);
    appState.networkEvents = profileId
      ? appState.networkEvents.filter((item) => !(item.caseId === caseId && item.profileId === profileId))
      : appState.networkEvents.filter((item) => item.caseId !== caseId);
    await persistState();
    emitState();
    return getClientState();
  });

  handle('analysis:network', async () => computeNetworkAnalysis(appState, activeCaseId()));
  handle('analysis:health', async () => deriveCollectionHealth(appState, activeCaseId()));

  handle('notes:add', async (postId, rawText) => {
    const caseId = activeCaseId();
    const post = appState.posts.find((item) => item.id === postId && item.caseId === caseId);
    if (!post) throw new Error('Finding not found in the active campaign.');
    const text = String(rawText || '').trim();
    if (!text) throw new Error('Note text is required.');
    if (text.length > 20000) throw new Error('Note is too long. Maximum length is 20,000 characters.');
    const note = { id: makeId(), caseId, postId, text, createdAt: nowIso(), updatedAt: nowIso() };
    appState.notes.push(note);
    await persistState();
    emitState();
    return note;
  });

  handle('notes:update', async (noteId, rawText) => {
    const note = appState.notes.find((item) => item.id === noteId && item.caseId === activeCaseId());
    if (!note) throw new Error('Investigative note not found in the active campaign.');
    const text = String(rawText || '').trim();
    if (!text) throw new Error('Note text is required.');
    if (text.length > 20000) throw new Error('Note is too long. Maximum length is 20,000 characters.');
    note.text = text;
    note.updatedAt = nowIso();
    await persistState();
    emitState();
    return note;
  });

  handle('notes:remove', async (noteId) => {
    const caseId = activeCaseId();
    appState.notes = appState.notes.filter((note) => !(note.caseId === caseId && note.id === noteId));
    await persistState();
    emitState();
    return getClientState();
  });

  handle('session:connect', openXLogin);
  handle('session:status', getXSessionStatus);
  handle('session:clear', async () => {
    const result = await clearXSession();
    emitState();
    return result;
  });

  handle('tor:toggle', async (enabled) => setTorRouting(Boolean(enabled)));
  handle('tor:status', async () => refreshTorStatus());

  handle('presets:save', async (input) => {
    const caseId = activeCaseId();
    const name = String(input?.name || '').trim();
    const keywords = Array.isArray(input?.keywords) ? input.keywords.map((keyword) => String(keyword).trim()).filter(Boolean) : [];
    if (!name) throw new Error('Preset name is required.');
    if (!keywords.length) throw new Error('Add at least one keyword or phrase.');
    const preset = {
      id: input?.id || makeId(), caseId, name, keywords,
      mode: input?.mode === 'all' ? 'all' : 'any', caseSensitive: Boolean(input?.caseSensitive),
      profileIds: Array.isArray(input?.profileIds) ? input.profileIds : [], enabled: input?.enabled !== false, updatedAt: nowIso(),
    };
    const index = appState.presets.findIndex((item) => item.id === preset.id && item.caseId === caseId);
    if (index >= 0) appState.presets[index] = preset; else appState.presets.push(preset);
    appState.matches = appState.matches.filter((match) => !(match.caseId === caseId && match.presetId === preset.id));
    rebuildMatchesForPosts(appState.posts.filter((post) => post.caseId === caseId));
    await persistState();
    emitState();
    return preset;
  });

  handle('presets:remove', async (id) => {
    const caseId = activeCaseId();
    appState.presets = appState.presets.filter((preset) => !(preset.caseId === caseId && preset.id === id));
    appState.matches = appState.matches.filter((match) => !(match.caseId === caseId && match.presetId === id));
    await persistState();
    emitState();
    return getClientState();
  });

  handle('presets:run', async (id) => {
    const caseId = activeCaseId();
    const preset = appState.presets.find((item) => item.id === id && item.caseId === caseId);
    if (!preset) throw new Error('Preset not found in the active campaign.');
    appState.matches = appState.matches.filter((match) => !(match.caseId === caseId && match.presetId === id));
    rebuildMatchesForPosts(appState.posts.filter((post) => post.caseId === caseId));
    await persistState();
    emitState();
    return appState.matches.filter((match) => match.caseId === caseId && match.presetId === id).length;
  });

  handle('settings:save', async (settings) => {
    appState.settings = {
      ...appState.settings,
      autoSweep: Boolean(settings?.autoSweep),
      intervalMinutes: Math.max(5, Math.min(1440, Number(settings?.intervalMinutes) || 30)),
      scrollPasses: Math.max(1, Math.min(20, Number(settings?.scrollPasses) || 5)),
      scrollDelayMs: Math.max(500, Math.min(5000, Number(settings?.scrollDelayMs) || 1100)),
      retentionLimit: Math.max(1000, Math.min(250000, Number(settings?.retentionLimit) || 50000)),
      collectReplies: settings?.collectReplies !== false,
      collectReposts: Boolean(settings?.collectReposts),
      collectComments: Boolean(settings?.collectComments),
      collectImages: settings?.collectImages !== false,
      commentThreadsPerSweep: Math.max(1, Math.min(20, Number(settings?.commentThreadsPerSweep) || 3)),
      commentScrollPasses: Math.max(1, Math.min(12, Number(settings?.commentScrollPasses) || 2)),
      relationshipScrollPasses: Math.max(1, Math.min(60, Number(settings?.relationshipScrollPasses) || 8)),
      networkStagnationLimit: Math.max(4, Math.min(20, Number(settings?.networkStagnationLimit) || 7)),
      networkSnapshotLimit: Math.max(5, Math.min(100, Number(settings?.networkSnapshotLimit) || 20)),
      archiveEnabled: Boolean(settings?.archiveEnabled),
      archiveIntervalMinutes: Math.max(30, Math.min(10080, Number(settings?.archiveIntervalMinutes) || 240)),
      archivePostStep: Math.max(1, Math.min(20, Number(settings?.archivePostStep) || 2)),
      archivePostMaxPasses: Math.max(5, Math.min(120, Number(settings?.archivePostMaxPasses) || 40)),
      archiveFollowers: Boolean(settings?.archiveFollowers),
      archiveFollowing: Boolean(settings?.archiveFollowing),
      archiveRelationshipStep: Math.max(1, Math.min(40, Number(settings?.archiveRelationshipStep) || 3)),
      archiveRelationshipMaxPasses: Math.max(8, Math.min(240, Number(settings?.archiveRelationshipMaxPasses) || 160)),
    };
    if (!appState.campaignSettings) appState.campaignSettings = {};
    appState.campaignSettings[activeCaseId()] = { ...appState.settings };
    trimEnterpriseLogs();
    restartAutoSweep();
    restartArchiveTimer();
    await persistState();
    emitState();
    return appState.settings;
  });

  handle('media:set-campaign-enabled', async (enabled) => {
    appState.settings = { ...activeSettings(), collectImages: Boolean(enabled) };
    if (!appState.campaignSettings) appState.campaignSettings = {};
    appState.campaignSettings[activeCaseId()] = { ...appState.settings };
    await persistState();
    emitState();
    return { enabled: appState.settings.collectImages };
  });

  handle('archive:run-step', runArchiveCycle);
  handle('archive:reset-progress', async () => {
    const caseProfileIds = new Set(appState.profiles.filter((item) => item.caseId === activeCaseId()).map((item) => item.id));
    for (const id of caseProfileIds) delete appState.archive.profiles[id];
    appState.archive.nextOperationIndex = 0;
    await persistState();
    emitState();
    return appState.archive;
  });

  handle('export:json', exportJson);
  handle('export:pdf', exportPdf);

  handle('demo:load', async () => {
    loadDemoData();
    await persistState();
    emitState();
    return getClientState();
  });

  handle('data:clear-posts', async () => {
    const caseId = activeCaseId();
    const postIds = new Set(appState.posts.filter((item) => item.caseId === caseId).map((item) => item.id));
    appState.posts = appState.posts.filter((item) => item.caseId !== caseId);
    appState.matches = appState.matches.filter((item) => item.caseId !== caseId);
    appState.notes = appState.notes.filter((item) => item.caseId !== caseId);
    appState.entities = appState.entities.filter((item) => item.caseId !== caseId);
    appState.changeEvents = appState.changeEvents.filter((item) => item.caseId !== caseId || !item.details?.postId || !postIds.has(item.details.postId));
    for (const profile of appState.profiles.filter((item) => item.caseId === caseId)) {
      profile.collectedCount = 0;
      if (appState.archive?.profiles?.[profile.id]) appState.archive.profiles[profile.id].oldestPostAt = null;
    }
    await persistState();
    emitState();
    return getClientState();
  });
}

app.on('render-process-gone', (_event, webContents, details) => {
  startupLog(`Global renderer-process-gone: id=${webContents?.id || 'unknown'} reason=${details.reason} exitCode=${details.exitCode}`);
});
app.on('child-process-gone', (_event, details) => {
  startupLog(`Child process exited: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});

app.whenReady().then(async () => {
  startupLog('Electron app ready.');
  await loadState();
  const xSession = session.fromPartition(X_PARTITION);
  configureRemoteSession(xSession);
  syncActiveSettings();

  // If Tor was left enabled, fail closed immediately without delaying the UI.
  // X traffic is blocked until background Tor verification succeeds.
  if (appState.tor?.enabled) {
    startupLog('Tor was enabled at shutdown; applying fail-closed bootstrap proxy before UI startup.');
    await xSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:1',
      proxyBypassRules: '<local>,localhost,127.0.0.1',
    });
    await xSession.closeAllConnections();
    torRuntime = { connected: false, port: null, exitIp: null, source: 'integrated', bootstrapPercent: 0, bundledAvailable: Boolean(bundledTorExecutable()), lastCheckedAt: nowIso(), error: 'Restoring integrated Tor…' };
  }

  registerIpc();
  restartAutoSweep();
  restartArchiveTimer();
  await createMainWindow();
  startupLog('Main window created successfully.');

  if (appState.tor?.enabled) {
    void setTorRouting(true)
      .then((result) => {
        startupLog(result.connected ? `Tor restored on SOCKS port ${result.port}.` : `Tor restore did not connect: ${result.error || 'unknown error'}`);
        if (result.connected) scheduleAvatarRepair(1500);
      })
      .catch((error) => startupLog('Background Tor restore failed.', error));
  } else {
    scheduleAvatarRepair(1500);
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
  });
}).catch((error) => {
  console.error(error);
  startupLog('Fatal startup error.', error);
  dialog.showErrorBox(APP_TITLE, `${error instanceof Error ? error.message : String(error)}\n\nStartup log:\n${STARTUP_LOG_PATH}`);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (managedTorProcess) { try { managedTorProcess.kill(); } catch {} managedTorProcess = null; }
  if (autoSweepTimer) clearInterval(autoSweepTimer);
  if (archiveTimer) clearInterval(archiveTimer);
  if (torStatusTimer) clearInterval(torStatusTimer);
  if (avatarRepairTimer) clearTimeout(avatarRepairTimer);
});
