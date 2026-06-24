/**
 * IPC bridge — every renderer-supplied id, name, and URL passes through validate.ts
 * before hitting storage. Handlers are wrapped so unhandled errors are surfaced
 * to the renderer with the offending channel name in the message, not silently
 * dropped into the dev-tools console.
 *
 * v1.0.1 round-3 hardening:
 *  - safeHandle preserves error name + code (renderer can disambiguate "keyring locked"
 *    from "decrypt failed" from "validation error")
 *  - Error messages are sanitised at the boundary: dataRoot() prefix stripped, UUIDs
 *    masked, so absolute filesystem paths don't leak into the renderer (or downstream
 *    AI / log destinations).
 *  - Reminder ticker now emits a structured diagnostic via channels.system.onDiagnostic
 *    for broken cases, in addition to the toast.
 */

import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron';
import { writeFile, rename, lstat, rm, readFile, stat, realpath } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { channels, BGCONN_LOCK_EXEMPT_CHANNELS } from '@shared/ipc-contracts';
import type { MailAccount, MailSendInput, SshHostProfile, AiChatRequest, MediaTrack } from '@shared/post-mvp-types';
import type { MediaUrlResult, CaseRecord } from '@shared/types';
import type { SearchlightCase } from '@shared/searchlight/types';
import {
  caseStore,
  consumeDrainDiagnostics,
  fileStore,
  noteStore,
  reminderStore,
  settingsStore,
  shredStore
} from '../storage/json-fs';
import { showNotification } from '../notifications';
import { startMailPoller } from '../services/mail-poller';
import { dataRoot, caseAttachmentsDir } from '../storage/paths';
import { isEncryptedFile } from '../storage/secure-fs';
import * as mail from '../services/mail';
import * as ssh from '../services/ssh';
import * as shellSvc from '../services/shell';
import * as streams from '../services/streams';
import * as satellites from '../services/satellites';
import { streamsToMasterTree } from '../services/cctv-export';
import { detectStream } from '../services/stream-detect';
import * as walls from '../services/walls';
import * as sounds from '../services/sounds';
import * as ai from '../services/ai';
import * as localAi from '../services/local-ai';
import * as chat from '../services/chat';
import * as piperTts from '../services/piper-tts';
import { listUserVoices, listBundledVoices } from '../services/piper-voices';
import * as bookmarks from '../storage/bookmarks';
import * as history from '../storage/history';
import * as firefox from '../services/firefox';
import * as bookmarksBoard from '../storage/bookmarks-board';
import * as stickyNotesStore from '../storage/sticky-notes';
import * as aiConvos from '../storage/ai-conversations';
import * as briefcase from '../storage/briefcase';
import * as journal from '../storage/journal';
import * as voiceModel from '../voice/model-protocol';
import { ensureUuid, ensureFileName, validateExternalUrl, validateBookmarkUrl, validatePickFilters, sanitiseSaveDefault, validateByteRange, ensureEntityId, ensureEntityInput, ensureEntityPatch, ensureRelationship, ensureLinkOpts, ensureTimelineEvent, ensureBioId, ensureBioInput, ensureSearchQuery, ensureFtpName, ensureFtpPath, ensureSessionId, ensureShellProgram, ensureWhiteboard, ensurePassword, ensureNewPassword, ensureRecoveryKey, ensureLocalAiSetupOpts, ensureMediaRoot, ensureStationInput, ensureFeedUrl, ensureGeoSource, ensureLatLon, ensureSaveToCaseOpts, ensureGeoItem, ensureThreatLayerId, ensureKeyedLayerId, ensureLayerKey, isKeyedLayerId, ensureBookmarkBoard, ensureMarketsSettings, ensureStickyNotes, ensureAiConversation, ensureBriefcaseNote, ensureJournalEntry, ensurePin, ensureUid, ensureMailFlag, stripProtectedSettings, ensureBounds } from '../security/validate';
import * as entities from '../storage/entities';
import * as bioStore from '../storage/bio-images';
import * as ftp from '../services/ftp';
import * as backup from '../services/backup';
import * as exiftool from '../services/exiftool';
import * as whiteboard from '../storage/whiteboard';
import * as mediaLib from '../media/library';
import { adHocAllowlist } from '../media/protocol';
import { parseM3u, toM3u } from '../media/m3u';
import { parseFeedList, feedToUpsert } from '../services/feed-import';
import * as geoint from '../geoint/sources';
import { fetchThreatLayer } from '../geoint/threat-layers';
import { fetchKev } from '../geoint/kev';
import { parseOpml } from '../geoint/feeds';
import { saveToCase as geoSaveToCase } from '../geoint/save-to-case';
import * as geoCaseEvents from '../geoint/case-events';
import * as markets from '../markets/providers';
import * as vault from '../services/vault';
import { encryptAll, decryptAll } from '../storage/encryption-migrate';
import { buildSummaryHtml, renderCasePdf, type ReportImages } from '../services/export';
import { timelineCsv, linksCsv, entitiesCsv, attachmentsCsv } from '../services/csv';
import * as search from '../services/search';
import * as memory from '../services/memory';
import { markConsented, assertAllConsented } from '../security/consent';
import { getVerified, getStatus } from '../plugins/loader';
import { invokePluginHandler } from '../plugins/invoke';
import { getSecretBackend, rewrapSecretsForVault } from '../secrets';
import { getEngagementController } from '../offensive/controller';
import { getBgConnManager } from '../bgconn/singleton';
import { makeBgConnSecrets, type SecretBackend } from '../bgconn/secrets';
import { secretStore } from '../secrets/index';
import { homedir } from 'node:os';
import { hostInfoService } from '../services/hostinfo/index';
import * as adsb from '../services/livefeeds/adsb';
import * as ais from '../services/livefeeds/ais-stream';
import * as slSiteDb from '../searchlight/site-db';
import * as slStore from '../searchlight/store';
import { startSweep, cancelSweep } from '../searchlight/sweep';
import { getBgTor } from '../bgconn/tor-singleton';

const MAX_SAVE_ATTACHMENT_BYTES = 64 * 1024 * 1024; // 64 MB cap on base64 decoded payload
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

/** Shared save-to-disk: native dialog, symlink refusal, atomic temp+rename. Renderer never
 *  supplies a destination path (the dialog does), so there is no path-traversal surface. */
async function saveBufferWithDialog(win: BrowserWindow | null, defaultName: string, data: Buffer): Promise<string | null> {
  const safeDefault = sanitiseSaveDefault(defaultName);
  const result = win
    ? await dialog.showSaveDialog(win, { defaultPath: safeDefault })
    : await dialog.showSaveDialog({ defaultPath: safeDefault });
  if (result.canceled || !result.filePath) return null;
  try {
    const st = await lstat(result.filePath);
    if (st.isSymbolicLink()) throw new Error('Refusing to save to a symbolic link — choose a different filename.');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const tmp = `${result.filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, result.filePath);
  } catch (err) {
    try { await rm(tmp, { force: true }); } catch { /* nothing */ }
    throw err;
  }
  return basename(result.filePath);
}

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const HOME_PATTERNS = [
  /\/home\/[^/\s]+/g,
  /\/Users\/[^/\s]+/g,
  /[Cc]:\\\\Users\\\\[^\\\s]+/g
];

function sanitiseMessage(msg: string): string {
  let out = msg;
  const root = dataRoot();
  if (root) out = out.split(root).join('<userData>');
  // Strip the user's home directory in any of its OS-specific shapes.
  const home = homedir();
  if (home) out = out.split(home).join('<home>');
  for (const p of HOME_PATTERNS) out = out.replace(p, '<home>');
  out = out.replace(UUID_RE, '<uuid>');
  return out;
}

// Channels callable while the vault is enabled-but-locked. Everything else is refused at the
// boundary (defence-in-depth behind the renderer's lock screen + the secure-fs read guard).
// The whole auth namespace is exempt: those handlers do their own state checks (unlock/disable
// must run precisely when isUnlocked() is false). settings.read + system.appInfo let the lock
// screen render the saved theme/wallpaper and the version string.
const GATE_EXEMPT = new Set<string>([
  ...Object.values(channels.auth),
  channels.settings.read,
  channels.system.appInfo,
  ...BGCONN_LOCK_EXEMPT_CHANNELS
]);

function safeHandle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      if (!GATE_EXEMPT.has(channel) && vault.isEnabledCached() && !vault.isUnlocked()) {
        const locked = new Error('Locked — unlock Ghost Intel 98 to continue.');
        locked.name = 'VaultLocked';
        (locked as Error & { code?: string }).code = 'EVAULTLOCKED';
        throw locked;
      }
      return await fn(...args);
    } catch (err) {
      const original = err as Error & { code?: string };
      const sanitised = sanitiseMessage(original.message ?? String(err));
      // eslint-disable-next-line no-console
      console.error(`[ipc:${channel}]`, original.name, sanitised);
      const wrapped = new Error(`[${channel}] ${sanitised}`);
      wrapped.name = original.name || 'Error';
      // Preserve any code field so the renderer can disambiguate.
      if (original.code) (wrapped as Error & { code?: string }).code = original.code;
      throw wrapped;
    }
  });
}

/** Resume a crashed/partial enable: if the migrating marker is set and the DEK is now loaded,
 *  finish encrypting the tree and clear the marker. Called after every successful unlock. */
async function resumeEnableIfNeeded(): Promise<void> {
  if (!vault.isUnlocked() || !(await vault.isEnableIncomplete())) return;
  vault.beginEnable();
  try {
    const r = await encryptAll();
    if (r.failed.length === 0) {
      await vault.markEnableComplete();
      try { await rewrapSecretsForVault(); } catch { /* best-effort */ }
    }
  } finally {
    vault.endMigration();
  }
}

// Photos embedded into a case report (summary HTML/PDF). Originals are decrypted here in main and
// handed to the pure HTML builder as data URIs — the offline PDF render can neither fetch nor
// decrypt. A total budget caps the embedded payload so a photo-heavy case can't produce a giant
// file; a per-image cap drops outsized single images. Bio thumbnails (96px) are too small to be
// useful, so bio images embed their originals, same as image attachments.
const REPORT_IMG_TOTAL_CAP = 24 * 1024 * 1024; // ~24 MiB of embedded image bytes per report
const REPORT_IMG_PER_CAP = 8 * 1024 * 1024;    // skip any single image larger than this
const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif'
};

async function gatherReportImages(caseId: string, rec: CaseRecord): Promise<ReportImages> {
  const bio: ReportImages['bio'] = [];
  const attachments: ReportImages['attachments'] = [];
  let budget = REPORT_IMG_TOTAL_CAP;
  let omitted = 0;

  let bioList: Awaited<ReturnType<typeof bioStore.listResolved>> = [];
  try { bioList = await bioStore.listResolved(caseId); } catch { /* no bio index / locked → none */ }
  for (const img of bioList) {
    if (img.size > REPORT_IMG_PER_CAP || img.size > budget) { omitted++; continue; }
    try {
      const dataUri = await bioStore.readOriginalDataUri(caseId, img.id);
      if (!dataUri) { omitted++; continue; }
      bio.push({ caption: img.caption || img.originalName, dataUri });
      budget -= img.size;
    } catch { omitted++; } // one corrupt/missing original must not abort the whole report
  }

  for (const a of rec.attachments) {
    const ext = a.originalName.split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_EXT_MIME[ext];
    if (!mime) continue; // non-image attachment: stays in the name list, not embedded
    if (a.size > REPORT_IMG_PER_CAP || a.size > budget) { omitted++; continue; }
    try {
      const res = await fileStore.readAttachmentBytes(caseId, a.fileName, 0, REPORT_IMG_PER_CAP);
      if (!res.base64) { omitted++; continue; }
      attachments.push({ caption: a.originalName, dataUri: `data:${mime};base64,${res.base64}` });
      budget -= a.size;
    } catch { omitted++; }
  }

  return {
    bio,
    attachments,
    omittedNote: omitted ? `${omitted} image${omitted === 1 ? '' : 's'} not embedded (too large for the report).` : undefined
  };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // ---- system ----
  safeHandle(channels.system.appInfo, () => ({
    version: app.getVersion(),
    userData: dataRoot(),
    platform: process.platform,
    secretBackend: getSecretBackend()
  }));
  safeHandle(channels.system.openExternal, async (...args) => {
    const url = validateExternalUrl(args[0] as string);
    await shell.openExternal(url);
  });
  // Renderer-initiated quit (Access → Shut Down). app.quit() runs the before-quit cleanup
  // (drains SSH sessions, cancels AI streams) rather than killing the process abruptly.
  safeHandle(channels.system.quit, () => { app.quit(); });

  // ---- chat (P2P over Tor) — NOT in GATE_EXEMPT (requires an unlocked vault) ----
  const ensureContactId = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v)) throw new Error('Invalid contactId');
    return v;
  };
  const ensureChatText = (v: unknown): string => {
    if (typeof v !== 'string' || v.length === 0) throw new Error('Empty message');
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 16 * 1024);
  };
  const ensureInviteLink = (v: unknown): string => {
    if (typeof v !== 'string' || v.length > 8192 || !v.startsWith('dcs98chat://invite/')) throw new Error('Invalid invite link');
    return v;
  };
  const ensureTransferId = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[0-9a-f]{32}$/.test(v)) throw new Error('Invalid transferId');
    return v;
  };
  const ensureGroupId = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[0-9a-f]{32}$/.test(v)) throw new Error('Invalid groupId');
    return v;
  };
  const ensureGroupName = (v: unknown): string => {
    if (typeof v !== 'string' || v.trim().length === 0) throw new Error('Group name required');
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 128);
  };
  const ensureMemberIds = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length === 0 || v.length > 64) throw new Error('Invalid member list');
    return v.map((x) => ensureContactId(x));
  };
  // Defense-in-depth: a non-finite or out-of-range cols/rows must never reach pty.resize.
  const ensureDim = (v: unknown): number => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 1000);
  };
  safeHandle(channels.chat.status, () => chat.status());
  safeHandle(channels.chat.enable, () => chat.enable(getWindow));
  safeHandle(channels.chat.disable, () => chat.disable());
  safeHandle(channels.chat.createInvite, () => chat.createInvite());
  safeHandle(channels.chat.acceptInvite, (...a) => chat.acceptInvite(ensureInviteLink(a[0])));
  safeHandle(channels.chat.listContacts, () => chat.listContacts());
  safeHandle(channels.chat.setVerified, (...a) => chat.setVerified(ensureContactId(a[0]), a[1] === true));
  safeHandle(channels.chat.send, (...a) => chat.send(ensureContactId(a[0]), ensureChatText(a[1])));
  safeHandle(channels.chat.sendFile, (...a) => chat.sendFile(ensureContactId(a[0]), getWindow));
  safeHandle(channels.chat.shareAttachment, (...a) => chat.shareAttachment(ensureContactId(a[0]), ensureUuid(a[1], 'caseId'), ensureFileName(a[2], 'fileName')));
  safeHandle(channels.chat.saveFile, async (...a) => {
    const cid = ensureContactId(a[0]);
    const transferId = ensureTransferId(a[1]);
    // Decrypt from quarantine, then write through the SAME hardened path as every other save:
    // sanitiseSaveDefault + symlink refusal + atomic temp→rename. The peer-supplied name is NEVER
    // used as a path without sanitisation.
    const { name, data } = await chat.getQuarantinedFile(cid, transferId);
    const saved = await saveBufferWithDialog(getWindow(), name, data);
    if (saved) await chat.deleteQuarantine(transferId); // don't retain received material past the save
    return saved;
  });
  safeHandle(channels.chat.history, (...a) => chat.history(ensureContactId(a[0])));
  safeHandle(channels.chat.createGroup, (...a) => chat.createGroup(ensureGroupName(a[0]), ensureMemberIds(a[1])));
  safeHandle(channels.chat.listGroups, () => chat.listGroups());
  safeHandle(channels.chat.groupHistory, (...a) => chat.groupHistory(ensureGroupId(a[0])));
  safeHandle(channels.chat.sendGroup, (...a) => chat.sendGroup(ensureGroupId(a[0]), ensureChatText(a[1])));

  // ---- TTS (Piper neural voice — fully offline, no egress) ----
  const ensureTtsText = (v: unknown): string => {
    if (typeof v !== 'string' || v.trim().length === 0) throw new Error('Empty TTS text');
    return v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 4000);
  };
  const ensureRate = (v: unknown): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Math.min(2, Math.max(0.5, v));
  };
  safeHandle(channels.tts.piperStatus, () => piperTts.piperStatus());
  safeHandle(channels.tts.synthesize, (...a) => piperTts.synthesize(ensureTtsText(a[0]), ensureRate(a[1]), typeof a[2] === 'string' ? a[2] : undefined));
  safeHandle(channels.tts.cancel, () => { piperTts.cancelActive(); });
  safeHandle(channels.tts.listVoices, async () => [...await listBundledVoices(), ...await listUserVoices()]);
  safeHandle(channels.tts.revealVoicesFolder, () => piperTts.revealVoicesFolder());

  // ---- auth (login / encrypt-at-rest) ----
  safeHandle(channels.auth.status, async () => ({
    enabled: await vault.refreshEnabled(),
    unlocked: vault.isUnlocked()
  }));
  safeHandle(channels.auth.setup, async (...args) => {
    const password = ensureNewPassword(args[0]); // enforce the 12-char minimum in main, not just UI
    const result = await vault.setup(password); // writes auth.json (migrating marker) + unlocks
    vault.beginEnable();                         // pause the reminder ticker during the sweep
    try {
      const r = await encryptAll();              // purge orphan temps + encrypt plaintext in place
      if (r.failed.length === 0) {
        await vault.markEnableComplete();        // whole tree confirmed encrypted → clear the marker
        // On a weak keyring, add the vault DEK layer to existing stored credentials too (#11).
        try { await rewrapSecretsForVault(); } catch { /* best-effort; credentials still keyring-protected */ }
      } else {
        // Partial: the vault IS enabled and the recovery key MUST still reach the user, so don't
        // throw (that would lose the key). Leave the marker set — the next unlock resumes the
        // sweep — and surface the incomplete state as a non-fatal diagnostic.
        getWindow()?.webContents.send(channels.system.onDiagnostic, {
          kind: 'main-error',
          message: `Encryption is still finishing: ${r.failed.length} file(s) pending (retried on next unlock). Check file permissions.`
        });
      }
    } finally {
      vault.endMigration();
    }
    return result;                               // { recoveryKey } — shown to the user once
  });
  safeHandle(channels.auth.unlock, async (...args) => {
    await vault.unlock(ensurePassword(args[0]));
    await resumeEnableIfNeeded();                // finish a crashed/partial enable now that the DEK is back
  });
  safeHandle(channels.auth.unlockRecovery, async (...args) => {
    await vault.unlockWithRecovery(ensureRecoveryKey(args[0]));
    await resumeEnableIfNeeded();
  });
  safeHandle(channels.auth.changePassword, (...args) => vault.changePassword(ensureNewPassword(args[0])));
  safeHandle(channels.auth.disable, async (...args) => {
    const password = ensurePassword(args[0]);
    await vault.unlock(password); // verify the password (throws on mismatch) + ensure the DEK is loaded
    vault.beginDisable();         // stop NEW writes from encrypting + pause the ticker BEFORE decrypt
    try {
      const r = await decryptAll(); // decrypt every blob while the DEK is still available
      if (r.failed.length > 0) {
        // Do NOT removeAuth: a still-encrypted file would orphan under the destroyed DEK. Leave
        // the vault enabled + unlocked (no data lost) and surface the failure for retry.
        throw new Error(`Could not decrypt ${r.failed.length} file(s); login left enabled so nothing is lost. Resolve the error (e.g. file permissions) and try again.`);
      }
      await rewrapSecretsForVault(); // strip the secrets DEK layer NOW, while the DEK still exists
      await vault.removeAuth();   // delete auth.json + zeroize the DEK (also ends the migration)
    } finally {
      vault.endMigration();       // belt-and-suspenders: clear transition state on any failure path
    }
  });
  safeHandle(channels.auth.lock, () => {
    vault.lock();
    // Revoke any ga98media:// authorizations minted this session so locking the vault also
    // stops media streaming (the protocol isn't behind the IPC vault gate) — red-team C1.
    adHocAllowlist.clear();
  });

  // ---- settings ----
  safeHandle(channels.settings.read, () => settingsStore.read());
  safeHandle(channels.settings.update, (...args) => {
    // Strip the shell-enable keys: enabling the DialTerm local shell grants local code execution,
    // so it must go through the dedicated, native-dialog-confirmed shell:requestEnable path. A
    // bulk patch (renderer/plugin/XSS) must never be able to set localShellEnabled/localShellProgram.
    const patch = stripProtectedSettings(args[0] as Parameters<typeof settingsStore.update>[0]);
    // Bound + sanitize renderer-supplied market settings before they're persisted (the rest of
    // the settings patch is shipped by trusted in-app UI; markets carries user URLs + lists).
    if (patch && typeof patch === 'object' && (patch as { markets?: unknown }).markets) {
      (patch as { markets: unknown }).markets = ensureMarketsSettings((patch as { markets: unknown }).markets);
    }
    return settingsStore.update(patch);
  });
  safeHandle(channels.settings.pickWallpaper, async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const p = result.filePaths[0];
    const ext = (p.split('.').pop() ?? '').toLowerCase();
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[ext];
    if (!mime) throw new Error('Unsupported image type (PNG, JPG, WEBP, GIF).');
    const st = await stat(p);
    if (st.size > 8 * 1024 * 1024) throw new Error('Image too large — max 8 MB for a wallpaper.');
    const buf = await readFile(p);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  // ---- cases ----
  safeHandle(channels.cases.list, () => caseStore.list());
  safeHandle(channels.cases.create, (...args) => caseStore.create(args[0] as Parameters<typeof caseStore.create>[0]));
  safeHandle(channels.cases.read, (...args) => caseStore.read(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.cases.rename, (...args) => caseStore.rename(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.update, (...args) => caseStore.update(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof caseStore.update>[1]));
  safeHandle(channels.cases.archive, (...args) => caseStore.archive(ensureUuid(args[0], 'caseId'), args[1] as boolean));
  safeHandle(channels.cases.delete, (...args) => caseStore.softDelete(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.cases.addTimeline, (...args) => caseStore.addTimeline(ensureUuid(args[0], 'caseId'), ensureTimelineEvent(args[1])));
  safeHandle(channels.cases.addTask, (...args) => caseStore.addTask(ensureUuid(args[0], 'caseId'), args[1] as string, args[2] as string | undefined));
  safeHandle(channels.cases.toggleTask, (...args) => caseStore.toggleTask(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.deleteTask, (...args) => caseStore.deleteTask(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.addLink, (...args) => caseStore.addLink(ensureUuid(args[0], 'caseId'), validateBookmarkUrl(args[1] as string), args[2] as string));
  safeHandle(channels.cases.deleteLink, (...args) => caseStore.deleteLink(ensureUuid(args[0], 'caseId'), args[1] as string));
  safeHandle(channels.cases.addReminder, (...args) => caseStore.addReminder(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof caseStore.addReminder>[1]));
  safeHandle(channels.cases.deleteReminder, (...args) => caseStore.deleteReminder(ensureUuid(args[0], 'caseId'), args[1] as string));

  // ---- files ----
  safeHandle(channels.files.importDropped, (...args) => fileStore.importDropped(ensureUuid(args[0], 'caseId'), args[1] as Parameters<typeof fileStore.importDropped>[1]));
  safeHandle(channels.files.listAttachments, (...args) => fileStore.listAttachments(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.files.deleteAttachment, (...args) => fileStore.deleteAttachment(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.revealAttachment, (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    const path = fileStore.attachmentAbsolutePath(id, name);
    shell.showItemInFolder(path);
  });
  safeHandle(channels.files.readAttachmentText, (...args) =>
    fileStore.readAttachmentText(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.readAttachmentBytes, (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    const { offset, length } = validateByteRange(args[2], args[3]);
    return fileStore.readAttachmentBytes(id, name, offset, length);
  });
  safeHandle(channels.files.readEml, (...args) =>
    fileStore.readEmlPreview(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  // Stream a large video/audio attachment through the path-confined ga98media:// protocol
  // instead of base64-loading it (which the 64 MB viewer cap rejects). Confinement: realpath
  // must resolve inside the case's own attachments dir; the realpath is then allowlisted for
  // the protocol handler. Encrypted-at-rest files are refused — whole-file GCM can't be
  // range-streamed, so the viewer falls back to Reveal rather than serving ciphertext.
  safeHandle(channels.files.mediaUrl, async (...args): Promise<MediaUrlResult> => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    // Only ever mint a streaming URL for an actual media extension — the protocol derives its
    // Content-Type from the extension, so without this an attacker-named in-case file could be
    // served under a chosen media MIME (red-team H3). Mirrors the viewer's VIDEO_EXT/AUDIO_EXT.
    if (!/\.(mp4|m4v|webm|ogv|mov|mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i.test(name)) {
      return { url: null, reason: 'forbidden' };
    }
    const candidate = fileStore.attachmentAbsolutePath(id, name);
    let real: string;
    let realDir: string;
    try {
      real = await realpath(candidate);
      realDir = await realpath(caseAttachmentsDir(id));
    } catch {
      return { url: null, reason: 'missing' };
    }
    const prefix = realDir.endsWith(sep) ? realDir : realDir + sep;
    if (real !== realDir && !real.startsWith(prefix)) return { url: null, reason: 'forbidden' };
    if (await isEncryptedFile(real)) return { url: null, reason: 'encrypted' };
    adHocAllowlist.add(real);
    return { url: `ga98media://track/${encodeURIComponent(real)}` };
  });
  safeHandle(channels.files.extractAttachmentMeta, (...args) =>
    fileStore.extractAttachmentMeta(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.exif, (...args) =>
    exiftool.readExif(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName')));
  safeHandle(channels.files.renameAttachment, (...args) =>
    fileStore.renameAttachment(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'fileName'), ensureFileName(args[2], 'newName')));

  // ---- entities (cross-case registry) ----
  safeHandle(channels.entities.listAll, () => entities.listAll());
  safeHandle(channels.entities.create, (...args) => entities.create(ensureEntityInput(args[0])));
  safeHandle(channels.entities.update, (...args) => entities.update(ensureEntityId(args[0]), ensureEntityPatch(args[1])));
  safeHandle(channels.entities.delete, (...args) => entities.remove(ensureEntityId(args[0])));
  safeHandle(channels.entities.merge, (...args) => entities.merge(ensureEntityId(args[0]), ensureEntityId(args[1])));
  safeHandle(channels.entities.linkToCase, (...args) => entities.linkToCase(ensureUuid(args[0], 'caseId'), ensureEntityId(args[1]), ensureLinkOpts(args[2])));
  safeHandle(channels.entities.unlinkFromCase, (...args) => entities.unlinkFromCase(ensureUuid(args[0], 'caseId'), ensureEntityId(args[1])));
  safeHandle(channels.entities.setRelationship, (...args) => entities.setRelationship(ensureUuid(args[0], 'caseId'), ensureEntityId(args[1]), ensureRelationship(args[2])));
  safeHandle(channels.entities.casesForEntity, (...args) => entities.casesForEntity(ensureEntityId(args[0])));

  // ---- bio images ----
  safeHandle(channels.bioImages.add, (...args) => bioStore.add(ensureUuid(args[0], 'caseId'), ensureBioInput(args[1])));
  safeHandle(channels.bioImages.delete, (...args) => bioStore.remove(ensureUuid(args[0], 'caseId'), ensureBioId(args[1])));
  safeHandle(channels.bioImages.setPrimary, (...args) => bioStore.setPrimary(ensureUuid(args[0], 'caseId'), ensureBioId(args[1])));
  safeHandle(channels.bioImages.updateCaption, (...args) => bioStore.updateCaption(ensureUuid(args[0], 'caseId'), ensureBioId(args[1]), args[2] as string));
  safeHandle(channels.bioImages.readOriginal, (...args) => bioStore.readOriginalDataUri(ensureUuid(args[0], 'caseId'), ensureBioId(args[1])));
  safeHandle(channels.bioImages.reveal, (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const name = ensureFileName(args[1], 'fileName');
    shell.showItemInFolder(bioStore.originalAbsolutePath(id, name));
  });

  // ---- export ----
  safeHandle(channels.export.summaryHtml, async (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const rec = await caseStore.read(id);
    return saveBufferWithDialog(getWindow(), `${rec.title}.html`, Buffer.from(buildSummaryHtml(rec, await gatherReportImages(id, rec)), 'utf8'));
  });
  safeHandle(channels.export.summaryPdf, async (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const rec = await caseStore.read(id);
    return saveBufferWithDialog(getWindow(), `${rec.title}.pdf`, await renderCasePdf(rec, await gatherReportImages(id, rec)));
  });
  safeHandle(channels.export.timelineCsv, async (...args) => {
    const rec = await caseStore.read(ensureUuid(args[0], 'caseId'));
    return saveBufferWithDialog(getWindow(), `${rec.title}-timeline.csv`, Buffer.from(timelineCsv(rec), 'utf8'));
  });
  safeHandle(channels.export.linksCsv, async (...args) => {
    const rec = await caseStore.read(ensureUuid(args[0], 'caseId'));
    return saveBufferWithDialog(getWindow(), `${rec.title}-links.csv`, Buffer.from(linksCsv(rec), 'utf8'));
  });
  safeHandle(channels.export.entitiesCsv, async (...args) => {
    const rec = await caseStore.read(ensureUuid(args[0], 'caseId'));
    return saveBufferWithDialog(getWindow(), `${rec.title}-entities.csv`, Buffer.from(entitiesCsv(rec), 'utf8'));
  });
  safeHandle(channels.export.attachmentsCsv, async (...args) => {
    const rec = await caseStore.read(ensureUuid(args[0], 'caseId'));
    return saveBufferWithDialog(getWindow(), `${rec.title}-attachments.csv`, Buffer.from(attachmentsCsv(rec), 'utf8'));
  });
  safeHandle(channels.export.text, async (...args) => {
    const defaultName = args[0] as string;
    const content = args[1] as string;
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (content.length > MAX_EXPORT_BYTES) throw new Error('Export content too large');
    return saveBufferWithDialog(getWindow(), defaultName, Buffer.from(content, 'utf8'));
  });

  // ---- search (cross-case) ----
  safeHandle(channels.search.query, (...args) => search.query(ensureSearchQuery(args[0])));

  // ---- FTP file client ----
  safeHandle(channels.ftp.connect, (...args) => ftp.connect(args[0] as string));
  safeHandle(channels.ftp.list, (...args) => ftp.list(ensureSessionId(args[0])));
  safeHandle(channels.ftp.cd, (...args) => ftp.cd(ensureSessionId(args[0]), ensureFtpPath(args[1])));
  safeHandle(channels.ftp.disconnect, (...args) => ftp.disconnect(ensureSessionId(args[0])));
  safeHandle(channels.ftp.download, async (...args) => {
    const sessionId = ensureSessionId(args[0]);
    const name = ensureFtpName(args[1]);
    const win = getWindow();
    const safeDefault = sanitiseSaveDefault(name);
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: safeDefault })
      : await dialog.showSaveDialog({ defaultPath: safeDefault });
    if (result.canceled || !result.filePath) return null;
    try {
      const st = await lstat(result.filePath);
      if (st.isSymbolicLink()) throw new Error('Refusing to save to a symbolic link — choose a different filename.');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await ftp.downloadToPath(sessionId, name, result.filePath);
    return basename(result.filePath);
  });
  safeHandle(channels.ftp.upload, async (...args) => {
    const sessionId = ensureSessionId(args[0]);
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const localPath = result.filePaths[0];
    return ftp.uploadFromPath(sessionId, localPath, basename(localPath));
  });

  // ---- full backup / restore ----
  safeHandle(channels.backup.create, async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: 'ghost-access-98-backup.ga98' })
      : await dialog.showSaveDialog({ defaultPath: 'ghost-access-98-backup.ga98' });
    if (result.canceled || !result.filePath) return null;
    try {
      const st = await lstat(result.filePath);
      if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.');
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await backup.createBackup(result.filePath);
    return basename(result.filePath);
  });
  safeHandle(channels.backup.restore, async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ghost Intel 98 backup', extensions: ['ga98', 'zip'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return backup.restoreBackup(result.filePaths[0]);
  });

  // ---- per-case share bundle ----
  safeHandle(channels.cases.exportBundle, async (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const rec = await caseStore.read(id);
    const win = getWindow();
    // User-facing extension is .ghost; the bundle's internal manifest kind stays
    // 'ga98case' for backward/forward compatibility (old .ga98case files still import).
    // Prefix with the case reference when set, e.g. "0001-John Smith.ghost".
    const stem = rec.reference?.trim() ? `${rec.reference.trim()}-${rec.title}` : rec.title;
    const def = sanitiseSaveDefault(`${stem}.ghost`);
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: def })
      : await dialog.showSaveDialog({ defaultPath: def });
    if (result.canceled || !result.filePath) return null;
    try {
      const st = await lstat(result.filePath);
      if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.');
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await backup.exportCase(id, result.filePath);
    return basename(result.filePath);
  });
  safeHandle(channels.cases.importBundle, async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ghost Intel 98 case', extensions: ['ghost', 'ga98case', 'zip'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return backup.importCase(result.filePaths[0]);
  });
  // Copy evidence files from their original locations into this case (the Ghost Intel 98 case folder).
  safeHandle(channels.cases.stageEvidence, async (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: 'Add evidence files to this case' })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const list = result.filePaths.map((p) => ({ sourcePath: p, originalName: basename(p) }));
    const added = await fileStore.importDropped(id, list);
    return added.length;
  });
  // One-click: export the case bundle (.ghost, includes all evidence) straight to the Desktop.
  safeHandle(channels.cases.exportToDesktop, async (...args) => {
    const id = ensureUuid(args[0], 'caseId');
    const rec = await caseStore.read(id);
    const stem = rec.reference?.trim() ? `${rec.reference.trim()}-${rec.title}` : rec.title;
    const dest = join(app.getPath('desktop'), sanitiseSaveDefault(`${stem}.ghost`));
    try {
      const st = await lstat(dest);
      if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.');
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await backup.exportCase(id, dest);
    return basename(dest);
  });

  // ---- whiteboard ----
  safeHandle(channels.whiteboard.read, (...args) => whiteboard.read(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.whiteboard.write, (...args) => whiteboard.write(ensureUuid(args[0], 'caseId'), ensureWhiteboard(args[1])));
  safeHandle(channels.files.pickOpen, async (...args) => {
    const opts = (args[0] as { multi?: boolean; filters?: unknown }) ?? {};
    const filters = validatePickFilters(opts.filters);
    const win = getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters })
      : await dialog.showOpenDialog({ properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], filters });
    if (result.canceled) return [];
    // Mark paths as consented for downstream IPC (mail.send) — user picked these via the dialog.
    markConsented(result.filePaths);
    return result.filePaths;
  });
  safeHandle(channels.files.pickSave, async (...args) => {
    const opts = (args[0] as { defaultName?: string; filters?: unknown }) ?? {};
    const filters = validatePickFilters(opts.filters);
    const win = getWindow();
    const safeDefault = opts.defaultName ? sanitiseSaveDefault(opts.defaultName) : undefined;
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: safeDefault, filters })
      : await dialog.showSaveDialog({ defaultPath: safeDefault, filters });
    return result.canceled ? null : (result.filePath ?? null);
  });

  // ---- notes ----
  safeHandle(channels.notes.list, (...args) => noteStore.list(ensureUuid(args[0], 'caseId')));
  safeHandle(channels.notes.read, (...args) => noteStore.read(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName')));
  safeHandle(channels.notes.write, (...args) => noteStore.write(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName'), args[2] as string));
  safeHandle(channels.notes.delete, (...args) => noteStore.delete(ensureUuid(args[0], 'caseId'), ensureFileName(args[1], 'noteName')));

  // ---- reminders ----
  safeHandle(channels.reminders.listGlobal, () => reminderStore.listGlobal());
  safeHandle(channels.reminders.upsertGlobal, (...args) => reminderStore.upsertGlobal(args[0] as Parameters<typeof reminderStore.upsertGlobal>[0]));
  safeHandle(channels.reminders.deleteGlobal, (...args) => reminderStore.deleteGlobal(args[0] as string));

  // ---- shred ----
  safeHandle(channels.shred.list, () => shredStore.list());
  safeHandle(channels.shred.restore, (...args) => shredStore.restore(args[0] as string));
  safeHandle(channels.shred.purge, (...args) => shredStore.purge(args[0] as string));
  safeHandle(channels.shred.purgeAll, () => shredStore.purgeAll());

  // ---- mail ----
  safeHandle(channels.mail.listAccounts, () => mail.listAccounts());
  safeHandle(channels.mail.upsertAccount, (...args) => mail.upsertAccount(args[0] as MailAccount & { password?: string }));
  safeHandle(channels.mail.deleteAccount, (...args) => mail.deleteAccount(args[0] as string));
  safeHandle(channels.mail.testAccount, (...args) => mail.testAccount(args[0] as MailAccount & { password: string }));
  safeHandle(channels.mail.fetchInbox, (...args) => mail.fetchInbox(args[0] as string, args[1] as number | undefined));
  safeHandle(channels.mail.fetchMessage, (...args) => mail.fetchMessage(args[0] as string, args[1] as number));
  safeHandle(channels.mail.send, (...args) => mail.sendMail(args[0] as MailSendInput));
  safeHandle(channels.mail.listDrafts, (...args) => mail.listDrafts(args[0] as string | undefined));
  safeHandle(channels.mail.upsertDraft, (...args) => {
    // CRITICAL: validate attachment paths at draft-write time, not just send time.
    // Without this, a compromised renderer can upsertDraft({path:'/etc/shadow'}) →
    // listDrafts auto-consents → send exfils. Round-3 audit Critical N1.
    const input = args[0] as Parameters<typeof mail.upsertDraft>[0];
    const paths = (input.attachments ?? []).map((a) => a.path);
    assertAllConsented(paths, 'draft attachment');
    return mail.upsertDraft(input);
  });
  safeHandle(channels.mail.deleteDraft, (...args) => mail.deleteDraft(args[0] as string));
  safeHandle(channels.mail.saveAttachment, async (...args) => {
    const { filename, contentBase64 } = args[0] as { filename: string; contentBase64: string };
    if (typeof contentBase64 !== 'string') throw new Error('contentBase64 must be a string');
    // Cap before Buffer allocation — protects main from OOM via crafted oversize payloads.
    // Base64 inflates by ~4/3; the decoded byte limit is the inflated string limit / 4 * 3.
    if (contentBase64.length > Math.ceil(MAX_SAVE_ATTACHMENT_BYTES * 4 / 3)) {
      throw new Error(`Attachment exceeds the ${MAX_SAVE_ATTACHMENT_BYTES} byte download limit`);
    }
    const safeDefault = sanitiseSaveDefault(filename || 'attachment');
    const win = getWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: safeDefault })
      : await dialog.showSaveDialog({ defaultPath: safeDefault });
    if (result.canceled || !result.filePath) return null;
    // Symlink guard: if the destination exists as a symlink, refuse — the user
    // could be tricked into overwriting a planted target outside their intent.
    try {
      const st = await lstat(result.filePath);
      if (st.isSymbolicLink()) {
        throw new Error('Refusing to save to a symbolic link — choose a different filename.');
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
    }
    // Atomic write via temp + rename so a crash doesn't leave a truncated file.
    const tmp = `${result.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, Buffer.from(contentBase64, 'base64'));
      await rename(tmp, result.filePath);
    } catch (err) {
      try { await rm(tmp, { force: true }); } catch { /* nothing */ }
      throw err;
    }
    return basename(result.filePath);
  });
  safeHandle(channels.mail.deleteMessage, (...a) => mail.deleteMessage(a[0] as string, ensureUid(a[1])));
  safeHandle(channels.mail.setFlag, (...a) => mail.setFlag(a[0] as string, ensureUid(a[1]), ensureMailFlag(a[2]), a[3] === true));
  safeHandle(channels.mail.printMessage, (...a) => mail.printMessage(a[0] as string, ensureUid(a[1])));

  // ---- browser (bookmarks + history) ----
  // Re-validate every bookmark URL on read — defends against legacy entries persisted
  // before v2.0.1 hardening, and against direct edits of bookmarks.json. Round-3 audit N2.
  safeHandle(channels.browser.listBookmarks, async () => {
    const all = await bookmarks.list();
    const out: typeof all = [];
    for (const bm of all) {
      try {
        validateBookmarkUrl(bm.url);
        out.push(bm);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[bookmarks.list] dropping invalid', bm.id, bm.url);
      }
    }
    return out;
  });
  safeHandle(channels.browser.addBookmark, (...args) => {
    const title = (args[0] as string ?? '').slice(0, 200).trim() || '(untitled)';
    const url = validateBookmarkUrl(args[1] as string);
    return bookmarks.add(title, url);
  });
  safeHandle(channels.browser.deleteBookmark, (...args) => bookmarks.remove(args[0] as string));
  safeHandle(channels.browser.listHistory, (...args) => history.list(args[0] as number | undefined));
  safeHandle(channels.browser.addHistory, (...args) => {
    let url = String(args[0] ?? '').slice(0, 2048);
    const title = String(args[1] ?? '').slice(0, 256);
    if (!url || url === 'about:blank' || url.startsWith('chrome-error://') || url.startsWith('chrome://')) return;
    return history.add(url, title);
  });
  safeHandle(channels.browser.clearHistory, () => history.clear());
  // Firefox Portable launcher (the in-app webview was swapped for an external bundled Firefox).
  safeHandle(channels.browser.firefoxStatus, () => firefox.status());
  safeHandle(channels.browser.launchFirefox, async (...args) => {
    // URL is validated (http/https only) inside firefox.launch. Await the spawn so a failed
    // launch surfaces to the renderer, and record history only once it actually launched.
    const url = String(args[0] ?? '');
    await firefox.launch(url);
    void history.add(url.slice(0, 2048), String(args[1] ?? '').slice(0, 256)).catch(() => {});
  });
  // Opens resources/firefox/ in the OS file manager so the user can drop the payload in place.
  // Takes no renderer input — the path is computed entirely in main.
  safeHandle(channels.browser.revealFirefoxDir, () => firefox.revealFirefoxDir());

  // ---- voice (offline STT model status) ----
  safeHandle(channels.voice.modelStatus, () => voiceModel.status());

  // ---- bookmarks dashboard (offline start.me-style board) ----
  // Re-validate on READ too (not just write): the board file can be edited directly when the
  // vault is off, and may predate a future hardening — mirror browser.listBookmarks's posture.
  safeHandle(channels.bookmarks.get, async () => ensureBookmarkBoard(await bookmarksBoard.read()));
  safeHandle(channels.bookmarks.save, (...args) => bookmarksBoard.write(ensureBookmarkBoard(args[0])));

  // ---- sticky notes (Win95-style desktop note layer; whole-state read/write, zero egress) ----
  // Validate on read too: the file can be edited directly when the vault is off.
  safeHandle(channels.stickyNotes.get, async () => ensureStickyNotes(await stickyNotesStore.read()));
  safeHandle(channels.stickyNotes.save, (...args) => stickyNotesStore.write(ensureStickyNotes(args[0])));

  // ---- AI conversations (ChatGPT-style saved chats; encrypted at rest, zero egress) ----
  safeHandle(channels.aiConvos.list, () => aiConvos.list());
  safeHandle(channels.aiConvos.get, (...args) => aiConvos.get(ensureUuid(args[0], 'conversation id')));
  safeHandle(channels.aiConvos.save, (...args) => aiConvos.save(ensureAiConversation(args[0])));
  safeHandle(channels.aiConvos.delete, (...args) => aiConvos.remove(ensureUuid(args[0], 'conversation id')));

  // ---- briefcase (standalone notes not tied to a case; encrypted at rest, zero egress) ----
  safeHandle(channels.briefcase.list, () => briefcase.list());
  safeHandle(channels.briefcase.read, (...args) => briefcase.read(ensureUuid(args[0], 'briefcase note id')));
  safeHandle(channels.briefcase.save, (...args) => briefcase.save(ensureBriefcaseNote(args[0])));
  safeHandle(channels.briefcase.delete, (...args) => briefcase.remove(ensureUuid(args[0], 'briefcase note id')));

  // ---- journal (PIN-gated personal journal; entries stay INSIDE the journal store — never a
  //      case or the briefcase; encrypted at rest, zero egress). The PIN is a rate-limited UI
  //      gate over already-vault-encrypted storage, NOT the encryption key (see storage/journal.ts).
  safeHandle(channels.journal.list, () => journal.list());
  safeHandle(channels.journal.read, (...args) => journal.read(ensureUuid(args[0], 'journal entry id')));
  safeHandle(channels.journal.save, (...args) => journal.save(ensureJournalEntry(args[0])));
  safeHandle(channels.journal.delete, (...args) => journal.remove(ensureUuid(args[0], 'journal entry id')));
  safeHandle(channels.journal.hasPin, () => journal.hasPin());
  safeHandle(channels.journal.setPin, (...args) => journal.setPin(ensurePin(args[0])));
  safeHandle(channels.journal.verifyPin, (...args) => journal.verifyPin(ensurePin(args[0])));
  safeHandle(channels.journal.changePin, (...args) => journal.changePin(ensurePin(args[0], 'old PIN'), ensurePin(args[1], 'new PIN')));
  safeHandle(channels.bookmarks.fetchFavicon, (...args) =>
    bookmarksBoard.fetchFavicon(validateExternalUrl(String(args[0] ?? ''))));
  safeHandle(channels.bookmarks.exportBoard, async () => {
    const res = await dialog.showSaveDialog({
      defaultPath: 'bookmarks.ghostbookmarks',
      filters: [{ name: 'Ghost Bookmarks', extensions: ['ghostbookmarks'] }]
    });
    if (res.canceled || !res.filePath) return null;
    const board = await bookmarksBoard.read();
    await writeFile(res.filePath, JSON.stringify({ kind: 'ga98bookmarks', version: 1, board }, null, 2), 'utf8');
    return res.filePath;
  });
  safeHandle(channels.bookmarks.importBoard, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Ghost Bookmarks', extensions: ['ghostbookmarks', 'json'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    // Cap before reading — a hostile shared .ghostbookmarks file must not OOM the main process.
    const st = await stat(res.filePaths[0]);
    if (st.size > 16 * 1024 * 1024) throw new Error('Bookmarks file too large (over 16 MB).');
    const raw = await readFile(res.filePaths[0], 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Accept either a bare board or the {kind,version,board} envelope. Validate before returning.
    const boardRaw = parsed && typeof parsed === 'object' && 'board' in parsed ? parsed['board'] : parsed;
    return ensureBookmarkBoard(boardRaw);
  });

  // ---- ssh ----
  safeHandle(channels.ssh.listHosts, () => ssh.listHosts());
  safeHandle(channels.ssh.upsertHost, (...args) => ssh.upsertHost(args[0] as SshHostProfile & { secret?: string }));
  safeHandle(channels.ssh.deleteHost, (...args) => ssh.deleteHost(args[0] as string));
  safeHandle(channels.ssh.connect, (...args) => ssh.connect(args[0] as string, getWindow));
  safeHandle(channels.ssh.write, (...args) => ssh.write(args[0] as string, args[1] as string));
  safeHandle(channels.ssh.resize, (...args) => ssh.resize(args[0] as string, args[1] as number, args[2] as number));
  safeHandle(channels.ssh.disconnect, (...args) => ssh.disconnect(args[0] as string));

  // ---- shell (DialTerm local shell) — connect handler is the AUTHORITATIVE opt-in gate ----
  // Enabling the shell is gated behind a NATIVE confirmation dialog (shell:requestEnable), NOT a
  // renderer-writable setting — settings.update strips localShellEnabled/localShellProgram. A
  // plugin/XSS calling requestEnable just pops a dialog the user can reject; no silent enable.
  safeHandle(channels.shell.requestEnable, async (...args) => {
    const win = getWindow();
    const { response } = win
      ? await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', 'Enable'],
          defaultId: 0,
          cancelId: 0,
          message: 'Enable the DialTerm local shell?',
          detail: "This lets Ghost Intel 98 run commands on your computer with your account's privileges. Only enable it if you understand the risk."
        })
      : await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Enable'],
          defaultId: 0,
          cancelId: 0,
          message: 'Enable the DialTerm local shell?',
          detail: "This lets Ghost Intel 98 run commands on your computer with your account's privileges. Only enable it if you understand the risk."
        });
    if (response !== 1) return false; // anything but the explicit 'Enable' button → no-op
    // Persist main-side (settings.update can't reach these keys). Validate the optional program.
    const program = ensureShellProgram(args[0] ?? (await settingsStore.read()).localShellProgram);
    await settingsStore.update({ localShellEnabled: true, localShellProgram: program });
    return true;
  });
  // Disabling is safe — no confirmation needed.
  safeHandle(channels.shell.disable, async () => {
    await settingsStore.update({ localShellEnabled: false });
    return false;
  });
  safeHandle(channels.shell.connect, async (...args) => {
    const settings = await settingsStore.read();
    if (!settings.localShellEnabled) {
      throw new Error('Local shell is disabled. Enable it in Settings → Terminal.');
    }
    const program = ensureShellProgram(args[0] ?? settings.localShellProgram);
    return shellSvc.connect(program, getWindow);
  });
  safeHandle(channels.shell.write, (...args) => shellSvc.write(ensureSessionId(args[0]), args[1] as string));
  safeHandle(channels.shell.resize, (...args) => shellSvc.resize(ensureSessionId(args[0]), ensureDim(args[1]), ensureDim(args[2])));
  safeHandle(channels.shell.disconnect, (...args) => shellSvc.disconnect(ensureSessionId(args[0])));

  // ---- streams (EyeSpy) ----
  safeHandle(channels.streams.list, () => streams.list());
  safeHandle(channels.streams.upsert, (...args) => {
    const input = args[0] as Parameters<typeof streams.upsert>[0];
    // EyeSpy renders the URL straight into <img>/<video>/hls — a hostile renderer must not
    // add arbitrary egress URLs. Enforce http/https/rtsp (loopback/LAN allowed: own cameras).
    if (typeof input?.url !== 'string' || !ensureFeedUrl(input.url)) throw new Error('Stream URL must be http(s) or rtsp.');
    return streams.upsert(input);
  });
  safeHandle(channels.streams.delete, (...args) => streams.remove(args[0] as string));
  safeHandle(channels.streams.clear, () => streams.clear());
  safeHandle(channels.streams.import, async (...args) => {
    const stamp = (args[0] ?? undefined) as { country?: string; region?: string; city?: string } | undefined;
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Camera feed list', extensions: ['csv', 'json', 'txt', 'm3u', 'm3u8'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { added: 0, skipped: 0, total: 0 };
    const feeds = parseFeedList(await readFile(r.filePaths[0], 'utf8'));
    const seen = new Set((await streams.list()).map((s) => s.url.toLowerCase()));
    let added = 0;
    let skipped = 0;
    for (const f of feeds) {
      if (!ensureFeedUrl(f.url) || seen.has(f.url.toLowerCase())) { skipped++; continue; }
      await streams.upsert(feedToUpsert(f, stamp));
      seen.add(f.url.toLowerCase());
      added++;
    }
    return { added, skipped, total: feeds.length };
  });
  safeHandle(channels.streams.detect, (...args) => {
    const url = args[0] as string;
    // http(s) only. Deliberately allows LAN/loopback (the user's own cameras) — see stream-detect.ts
    // for the bounded-egress rationale. rtsp can't be probed over HTTP, so it's rejected here.
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Detect needs an http(s) URL.');
    return detectStream(url);
  });
  safeHandle(channels.streams.exportCctv, async () => {
    const tree = streamsToMasterTree(await streams.list());
    const win = getWindow();
    const r = win
      ? await dialog.showSaveDialog(win, { defaultPath: 'master_CCTV.json' })
      : await dialog.showSaveDialog({ defaultPath: 'master_CCTV.json' });
    if (r.canceled || !r.filePath) return null;
    // Refuse a symlink target so an export can't be redirected to overwrite another file.
    try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await writeFile(r.filePath, JSON.stringify(tree, null, 2), 'utf8');
    return basename(r.filePath);
  });

  // ---- satellites (GeoINT) ----
  safeHandle(channels.satellites.list, () => satellites.list());
  safeHandle(channels.satellites.upsert, (...args) => satellites.upsert(args[0] as Parameters<typeof satellites.upsert>[0]));
  safeHandle(channels.satellites.remove, (...args) => satellites.remove(String(args[0])));
  safeHandle(channels.satellites.fetchGroup, (...args) => satellites.fetchGroup(String(args[0])));
  safeHandle(channels.satellites.snapshot, () => satellites.snapshot());

  // ---- walls (EyeSpy) ----
  safeHandle(channels.walls.list, () => walls.list());
  safeHandle(channels.walls.get, (...args) => walls.get(args[0] as string));
  safeHandle(channels.walls.save, (...args) => walls.save(args[0] as Parameters<typeof walls.save>[0]));
  safeHandle(channels.walls.delete, (...args) => walls.remove(args[0] as string));

  // ---- sounds (user-replaceable mail chime) ----
  safeHandle(channels.sounds.mailChime, () => sounds.readMailChime());
  safeHandle(channels.sounds.openFolder, () => sounds.openSoundsFolder());

  // ---- media (Jukebox; vault-gated like everything else — NOT in GATE_EXEMPT) ----
  safeHandle(channels.media.getSnapshot, () => mediaLib.getSnapshot());
  safeHandle(channels.media.refresh, () => mediaLib.refresh());
  safeHandle(channels.media.removeRoot, (...args) => mediaLib.removeRoot(ensureMediaRoot(args[0])));
  safeHandle(channels.media.addRoot, async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return mediaLib.getSnapshot();
    await mediaLib.addRoot(r.filePaths[0]);
    return mediaLib.refresh();
  });
  safeHandle(channels.media.openFiles, async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    const out: MediaTrack[] = [];
    for (const p of r.filePaths) {
      adHocAllowlist.add(await realpath(p)); // authorize this ad-hoc file for ga98media://
      const st = await stat(p);
      out.push({ path: p, mtime: st.mtimeMs, size: st.size, title: basename(p) });
    }
    return out;
  });
  safeHandle(channels.media.loadPlaylist, async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Playlist', extensions: ['m3u', 'm3u8'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return [];
    const playlist = r.filePaths[0];
    const items = parseM3u(await readFile(playlist, 'utf8'), dirname(playlist));
    // Only authorize audio files for ga98media:// — a malicious playlist must NOT be able to
    // allowlist arbitrary local paths (e.g. /etc/passwd, ~/.ssh/id_ed25519) for renderer read.
    const AUDIO_RE = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i;
    for (const it of items) {
      if (it.path && AUDIO_RE.test(it.path)) { try { adHocAllowlist.add(await realpath(it.path)); } catch { /* missing file — listed, won't play */ } }
    }
    return items;
  });
  safeHandle(channels.media.savePlaylist, async (...args) => {
    const queue = args[0] as { title: string; path?: string; url?: string }[];
    const win = getWindow();
    const r = win
      ? await dialog.showSaveDialog(win, { defaultPath: 'playlist.m3u' })
      : await dialog.showSaveDialog({ defaultPath: 'playlist.m3u' });
    if (r.canceled || !r.filePath) return null;
    try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await writeFile(r.filePath, toM3u(queue), 'utf8');
    return basename(r.filePath);
  });
  safeHandle(channels.media.upsertStation, (...args) => mediaLib.upsertStation(ensureStationInput(args[0])));
  safeHandle(channels.media.deleteStation, (...args) => mediaLib.deleteStation(args[0] as string));

  // ---- GeoINT (vault-gated; network is app-layer gated by settings.geoint.networkEnabled) ----
  safeHandle(channels.geoint.snapshot, () => geoint.snapshot());
  safeHandle(channels.geoint.addSource, (...a) => geoint.addSource(ensureGeoSource(a[0])));
  safeHandle(channels.geoint.updateSource, (...a) => geoint.updateSource(ensureUuid(a[0], 'sourceId'), a[1] as object));
  safeHandle(channels.geoint.removeSource, (...a) => geoint.removeSource(ensureUuid(a[0], 'sourceId')));
  safeHandle(channels.geoint.setItemLocation, (...a) => geoint.setItemLocation(ensureUuid(a[0], 'itemId'), ensureLatLon(a[1])));
  safeHandle(channels.geoint.importOpml, async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return 0;
    return geoint.importSources(parseOpml(await readFile(r.filePaths[0], 'utf8')));
  });
  safeHandle(channels.geoint.refresh, async (...a) => {
    // EGRESS GATE: do not fetch anything unless the operator has enabled GeoINT network.
    if (!(await settingsStore.read()).geoint.networkEnabled) return { fetched: 0, failed: 0 };
    const targetId = a[0] as string | undefined;
    const sources = (await geoint.listSources()).filter((s) => s.enabled && (!targetId || s.id === targetId));
    let fetched = 0;
    let failed = 0;
    for (const s of sources) { const res = await geoint.fetchSource(s.id, true); if (res.ok) fetched++; else failed++; }
    return { fetched, failed };
  });
  safeHandle(channels.geoint.geocode, async (...a) => {
    // EGRESS GATE: no outbound geocode request unless GeoINT network is enabled.
    if (!(await settingsStore.read()).geoint.networkEnabled) return null;
    const query = typeof a[0] === 'string' ? a[0] : '';
    return geoint.geocode(query, true);
  });
  safeHandle(channels.geoint.saveToCase, (...a) => geoSaveToCase(ensureUuid(a[0], 'caseId'), ensureGeoItem(a[1]), ensureSaveToCaseOpts(a[2])));
  safeHandle(channels.geoint.listCaseEvents, (...a) => geoCaseEvents.listCaseEvents(ensureUuid(a[0], 'caseId')));
  safeHandle(channels.geoint.removeCaseEvent, (...a) => geoCaseEvents.removeCaseEvent(ensureUuid(a[0], 'caseId'), ensureUuid(a[1], 'eventId')));
  safeHandle(channels.geoint.purgeCache, () => geoint.purgeAll());
  safeHandle(channels.geoint.fetchThreatLayer, async (...a) => {
    // EGRESS GATE: threat layers are on-demand network fetches — no egress unless GeoINT network is on.
    if (!(await settingsStore.read()).geoint.networkEnabled) return [];
    const layerId = ensureThreatLayerId(a[0]);
    // Pass only a validated/bounded opts shape. Each layer module re-validates its own param before
    // it touches the URL (USGS allowlists `feed`; war-tracker bounds `country` to ISO2; GDELT
    // encodeURIComponents + length-bounds `query`), so an unknown/hostile value can't inject a path
    // or extra query. We still bound here at the boundary (defense in depth).
    const o = (a[1] ?? {}) as { feed?: unknown; country?: unknown; query?: unknown };
    const feed = typeof o.feed === 'string' ? o.feed.slice(0, 64) : undefined;
    const country = typeof o.country === 'string' ? o.country.slice(0, 8) : undefined;
    const query = typeof o.query === 'string' ? o.query.slice(0, 256) : undefined;
    // KEY GATE: for keyed layers (firms/gdeltcloud/ucdp) read the API key main-side from secretStore
    // and refuse (return []) if absent. The renderer never holds the key — it travels only in the
    // provider header/path inside the layer module. A missing key is a no-op, not an error.
    let key: string | undefined;
    if (isKeyedLayerId(layerId)) {
      key = (await secretStore.get(`geoint.${layerId}.key`)) ?? '';
      if (!key) return [];
    }
    return fetchThreatLayer(layerId, { feed, country, query, key });
  });
  safeHandle(channels.geoint.setLayerKey, async (...a) => {
    // Store a keyed-layer API key in the OS-encrypted secret store (NOT settings.json, which is read
    // pre-unlock). layerId is allowlisted to the keyed set; the key is validated/bounded.
    const layerId = ensureKeyedLayerId(a[0]);
    const key = ensureLayerKey(a[1]);
    await secretStore.set(`geoint.${layerId}.key`, key);
  });
  safeHandle(channels.geoint.hasLayerKey, async (...a) => {
    const layerId = ensureKeyedLayerId(a[0]);
    try {
      const v = await secretStore.get(`geoint.${layerId}.key`);
      return typeof v === 'string' && v.length > 0;
    } catch {
      // Keyring locked/unavailable → treat as "no usable key" rather than surfacing a hard error to
      // the toggle's needs-key check (the actual fetch will surface the keyring error if attempted).
      return false;
    }
  });
  safeHandle(channels.geoint.fetchKev, async () => {
    // EGRESS GATE: the CISA KEV catalog is an on-demand network fetch — no egress unless GeoINT
    // network is on. KEV is an advisory list with no coordinates; it never touches the map.
    if (!(await settingsStore.read()).geoint.networkEnabled) return [];
    return fetchKev();
  });

  // ---- Markets (vault-gated; network app-layer gated by settings.markets.networkEnabled) ----
  safeHandle(channels.markets.fetch, async () => {
    const m = (await settingsStore.read()).markets;
    // EGRESS GATE: no quote request unless the operator has enabled Markets network.
    if (!m?.networkEnabled) return { quotes: [], errors: ['Markets network is off — enable it to fetch quotes.'], fetchedAt: new Date().toISOString() };
    return markets.fetchSnapshot({ watchlist: m.watchlist, customFeeds: m.customFeeds });
  });

  // ---- ai ----
  safeHandle(channels.ai.chatStream, (...args) => ai.chat(args[0] as string, args[1] as AiChatRequest, getWindow));
  safeHandle(channels.ai.chat, (...args) => ai.cancel(args[0] as string));
  safeHandle(channels.ai.setApiKey, (...args) => ai.setApiKey(args[0] as string));

  // ---- local AI (consent-gated: vault lock gate applies by default — NOT in GATE_EXEMPT) ----
  safeHandle(channels.localAi.status, () => localAi.detect());
  safeHandle(channels.localAi.setup, async (...args) => {
    const { mode } = ensureLocalAiSetupOpts(args[0]);
    // NOTE (provisional, pending Phase 0.1 pin): the ONLINE track must first fetch the Ollama
    // runtime binary (via local-ai-fetch.downloadVerified with the pinned URL+sha256 from
    // ci/pins.json) into the fetched runtime dir before ensureRuntime() can spawn it. That pin
    // is produced by Phase 0.1 and is not yet available, so online provisioning of the *binary*
    // is wired in a later task. For 'bundled', the installer already placed the binary+model.
    void mode; // mode is read above for validation; runtime/model path selection is inside the service
    await localAi.ensureRuntime();
    await localAi.ensureModel((p) => {
      const win = getWindow();
      if (win) win.webContents.send(channels.localAi.onProgress, { phase: 'import', message: p.message, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes });
    });
    await localAi.autoConfigure();
    return localAi.detect();
  });
  safeHandle(channels.localAi.start, () => localAi.ensureRuntime());
  safeHandle(channels.localAi.stop, () => { localAi.stop(); });

  safeHandle(channels.memory.status, () => memory.status());
  safeHandle(channels.memory.reindexAll, () => memory.reindexAll((p) => {
    const win = getWindow();
    if (win) win.webContents.send(channels.memory.onProgress, p);
  }));

  // ---- plugins ----
  safeHandle(channels.plugins.listVerified, async () => getVerified());
  safeHandle(channels.plugins.status, async () => getStatus());
  safeHandle(channels.plugins.invoke, async (id: unknown, name: unknown, args: unknown) =>
    invokePluginHandler(String(id), String(name), Array.isArray(args) ? args : []));

  // ---- offensive (authorized-target-egress) ----
  // The singleton EngagementController is initialised in index.ts (before loadPlugins) so that
  // ctx.attackEgress is live from first plugin load. Here we wire IPC handlers that
  // delegate to the already-initialised singleton via the statically-imported getEngagementController().
  const requireController = () => {
    const ctl = getEngagementController();
    if (!ctl) throw new Error('EngagementController not initialised');
    return ctl;
  };

  safeHandle(channels.offensive.loadScope, (...args) => {
    const ctl = requireController();
    ctl.loadScope(args[0], args[1] as Parameters<typeof ctl.loadScope>[1]);
  });
  safeHandle(channels.offensive.confirm, () => { requireController().confirm(); });
  safeHandle(channels.offensive.startScan, () => requireController().startScan());
  safeHandle(channels.offensive.stopScan, () => requireController().stopScan());
  safeHandle(channels.offensive.status, () => {
    const surface = requireController().attackEgressSurface();
    return {
      proxyPort: surface ? Number(surface.proxyUrl().split(':')[2]) : null,
      hasScope: true,
      canScan: surface !== null
    };
  });

  // ---- bgconn (persistent-background-connection) ----
  const bgSecretBackend: SecretBackend = {
    get: (k) => secretStore.get(k),
    set: (k, v) => secretStore.set(k, v),
    delete: (k) => secretStore.delete(k)
  };
  const bgSecrets = makeBgConnSecrets(bgSecretBackend);
  // 'session' is the canonical secret field (the Telethon session string written post-auth by subsystem 2).
  const BGCONN_SECRET_FIELDS = ['session'];

  // Runtime guards on renderer-supplied bgconn inputs: a garbage `routing` must NOT fall through to a
  // DIRECT (clearnet) lane, and `configure` must not persist a 0/negative bound (feature DoS).
  const isBgRouting = (v: unknown): v is 'tor' | 'direct' => v === 'tor' || v === 'direct';
  const inRange = (v: unknown, min: number, max: number): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

  safeHandle(channels.bgconn.status, () => getBgConnManager()?.list() ?? []);
  safeHandle(channels.bgconn.list, () => getBgConnManager()?.list() ?? []);
  safeHandle(channels.bgconn.start, async (...a) => {
    const connId = String(a[0]);
    const p = a[1] as { phone?: unknown; routing?: unknown; channelSetHash?: unknown };
    if (!connId) throw new Error('bgconn: connId required');
    if (typeof p?.phone !== 'string' || typeof p?.channelSetHash !== 'string' || !isBgRouting(p?.routing)) {
      throw new Error('bgconn: invalid start params (phone/channelSetHash strings, routing tor|direct)');
    }
    const confirmed = a[2] === true;
    const mgr = getBgConnManager();
    if (!mgr) throw new Error('bgconn manager not initialised');
    await mgr.start(connId, { phone: p.phone, routing: p.routing, channelSetHash: p.channelSetHash }, { confirmed });
  });
  safeHandle(channels.bgconn.stop, async (...a) => {
    const connId = String(a[0]);
    await getBgConnManager()?.stop(connId);
  });
  safeHandle(channels.bgconn.configure, async (...a) => {
    const cfg = a[0] as { idleTeardownAfterMinutes?: unknown; defaultRouting?: unknown; maxReconnects?: unknown; maxSessionAgeMinutes?: unknown };
    // Whole-replace the bgconn block (mergeSettings whole-replaces bgconn, like offensive/chat) — so
    // ALL four fields must be present + valid before we persist (a partial would clobber good policy).
    if (!(cfg?.idleTeardownAfterMinutes === null || inRange(cfg?.idleTeardownAfterMinutes, 0, 10_080))) {
      throw new Error('bgconn: idleTeardownAfterMinutes must be null or an integer 0..10080');
    }
    if (!isBgRouting(cfg?.defaultRouting)) throw new Error('bgconn: invalid defaultRouting');
    if (!inRange(cfg?.maxReconnects, 1, 100_000)) throw new Error('bgconn: maxReconnects must be an integer 1..100000');
    if (!inRange(cfg?.maxSessionAgeMinutes, 1, 10_080)) throw new Error('bgconn: maxSessionAgeMinutes must be an integer 1..10080');
    // NOTE: a live manager captured its policy at construction; bgconn policy changes apply on next
    // app start (same snapshot semantics as the plugin-net snapshot). Emergency-stop is the live control.
    settingsStore.update({ bgconn: {
      idleTeardownAfterMinutes: cfg.idleTeardownAfterMinutes as number | null,
      defaultRouting: cfg.defaultRouting,
      maxReconnects: cfg.maxReconnects as number,
      maxSessionAgeMinutes: cfg.maxSessionAgeMinutes as number
    } });
  });
  safeHandle(channels.bgconn.clearCredentials, async (...a) => {
    const pluginId = String(a[0]);
    const connId = String(a[1]);
    await bgSecrets.clear(pluginId, connId, BGCONN_SECRET_FIELDS);
  });

  // ---- hostinfo (camera host resolution — Tor-only DNS/RDAP recon) ----
  safeHandle(channels.hostinfo.resolve, async (...args) => {
    const url = String(args[0] ?? '');
    const force = !!(args[1] as { force?: boolean } | undefined)?.force;
    return hostInfoService.resolve(url, { force });
  });

  // ---- livefeeds (ADS-B + AIS; egress gated by settings.geoint.networkEnabled) ----
  safeHandle(channels.livefeeds.fetchAdsb, (...a) => adsb.fetchAdsb(ensureBounds(a[0])));
  safeHandle(channels.livefeeds.aisStart, (...a) => ais.startAis(ensureBounds(a[0]), (positions) => {
    getWindow()?.webContents.send(channels.livefeeds.onAisPositions, { positions });
  }));
  safeHandle(channels.livefeeds.aisStop, () => { ais.stopAis(); });
  safeHandle(channels.livefeeds.aisSetBbox, (...a) => { ais.setAisBbox(ensureBounds(a[0])); });

  // ---- Searchlight (OSINT username sweep; egress gated by settings.searchlight.networkEnabled) ----
  // Resolve the live bgconn Tor SOCKS port. Returns null when Tor isn't bootstrapped yet —
  // a Tor sweep with a null port will stall in the probe and surface TOR_UNAVAILABLE per site.
  // Never silently fall back to clearnet.
  function searchlightSocksPort(): number | null {
    const t = getBgTor();
    return t && t.isBootstrapped() ? t.socksPort() : null;
  }

  safeHandle(channels.searchlight.catalog, async () => slSiteDb.catalog());
  safeHandle(channels.searchlight.importSites, async (...a) => slSiteDb.importCustomSites(String(a[0] ?? '')));
  safeHandle(channels.searchlight.startSweep, async (...a) => {
    const req = a[0] as { username?: unknown; siteIds?: unknown; useTor?: unknown };
    const username = String(req?.username ?? '').trim();
    if (!username) return { jobId: '', total: 0 };
    const siteIds = Array.isArray(req?.siteIds) ? req.siteIds.filter((x): x is string => typeof x === 'string') : [];
    const useTor = req?.useTor !== false; // default true
    const s = (await settingsStore.read()).searchlight;
    const win = getWindow();
    return startSweep({ username, siteIds, useTor }, {
      loadSites: (ids) => slSiteDb.sitesByName(ids),
      networkEnabled: async () => (await settingsStore.read()).searchlight.networkEnabled,
      torSocksPort: searchlightSocksPort,
      defaultConcurrency: (tor) => (tor ? s.torConcurrency : s.clearnetConcurrency),
      emit: (r) => win?.webContents.send(channels.searchlight.onSweepResult, r),
      onDone: (f) => win?.webContents.send(channels.searchlight.onSweepDone, f)
    });
  });
  safeHandle(channels.searchlight.cancelSweep, async (...a) => { cancelSweep(ensureUuid(a[0], 'jobId')); });
  safeHandle(channels.searchlight.listCases, async () => slStore.listCases());
  safeHandle(channels.searchlight.saveCase, async (...a) => {
    const c = a[0];
    if (!c || typeof c !== 'object'
        || typeof (c as { id?: unknown }).id !== 'string'
        || typeof (c as { name?: unknown }).name !== 'string') {
      throw new Error('invalid searchlight case payload');
    }
    return slStore.saveCase(c as SearchlightCase);
  });
  safeHandle(channels.searchlight.loadCase, async (...a) => slStore.loadCase(ensureUuid(a[0], 'caseId')));
  safeHandle(channels.searchlight.deleteCase, async (...a) => slStore.deleteCase(ensureUuid(a[0], 'caseId')));
  safeHandle(channels.searchlight.exportCase, async (...a) => slStore.exportCase(ensureUuid(a[0], 'caseId')));
  safeHandle(channels.searchlight.importCase, async (...a) => slStore.importCase(String(a[0] ?? '')));
  safeHandle(channels.searchlight.favicon, async (...a) =>
    typeof a[0] === 'string' ? slSiteDb.faviconFor(a[0]) : null);
  safeHandle(channels.searchlight.addCustomSite, async (...a) => {
    const o = ((a[0] ?? {}) as Record<string, unknown>);
    return slSiteDb.addCustomSite({ name: String(o.name ?? ''), url: String(o.url ?? ''), category: o.category ? String(o.category) : undefined });
  });
  safeHandle(channels.searchlight.exportSites, async () => slSiteDb.exportCustomSitesJson());

  startMailPoller(getWindow);
}

/** Reminder tick: every 30s, pull due reminders, fire notifications + emit IPC to renderer.
 *  Guarded so an overlapping tick (slow disk, many cases) doesn't double-fire reminders.
 *  Per-case errors are surfaced as a structured diagnostic event so the user sees which
 *  case is broken, not just "reminders failed". */
export function startReminderTicker(getWindow: () => BrowserWindow | null): NodeJS.Timeout {
  let running = false;
  let lastBrokenSummary = '';
  const interval = setInterval(async () => {
    if (running) return;
    // While the vault is enabled-but-locked, reminder data is encrypted and unreadable —
    // skip the tick entirely rather than reading (which would throw) and spamming failures.
    if (vault.isEnabledCached() && !vault.isUnlocked()) return;
    // During an enable/disable sweep, stay out of the tree entirely — a concurrent reminder
    // write would race the migration walker (orphan temps / re-encryption).
    if (vault.isMigrating()) return;
    running = true;
    try {
      const due = await reminderStore.drainDue(new Date());
      const win = getWindow();
      for (const r of due) {
        showNotification(r.title, r.body);
        if (win) win.webContents.send(channels.system.onReminderFired, { reminder: r });
      }
      const broken = consumeDrainDiagnostics();
      if (broken.length > 0) {
        const summary = broken.map((b) => `${b.caseId.slice(0, 8)}:${b.reason}`).join(';');
        if (summary !== lastBrokenSummary) {
          lastBrokenSummary = summary;
          showNotification('Ghost Intel 98', `Reminders failed for ${broken.length} case${broken.length === 1 ? '' : 's'}. See Settings → diagnostics.`);
          if (win) win.webContents.send(channels.system.onDiagnostic, { kind: 'reminders-broken', cases: broken });
        }
      } else {
        lastBrokenSummary = '';
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reminder-ticker]', err);
      showNotification('Ghost Intel 98', 'Reminders failed to fire — see Settings → About → diagnostics');
    } finally {
      running = false;
    }
  }, 30_000);
  return interval;
}
