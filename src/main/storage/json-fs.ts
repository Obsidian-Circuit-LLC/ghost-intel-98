/**
 * MVP storage implementation: JSON files on disk.
 *
 * v1.0.1 hardening: per-case async mutex around every read-modify-write,
 * separate mutexes for global reminders + the shred bucket, ENOENT-only swallow
 * (other errors propagate so the UI can surface them), randomUUID stamps so
 * sub-millisecond bursts don't collide.
 */

import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  AppSettings,
  AttachmentBytesResult,
  AttachmentMeta,
  AttachmentTextResult,
  CaseId,
  CaseRecord,
  CaseSummary,
  CaseStatus,
  CasePriority,
  CreateCaseInput,
  EmlPreview,
  ExtractedAttachmentMeta,
  Reminder,
  TimelineEvent,
  TaskItem,
  WebLink
} from '@shared/types';
import exifr from 'exifr';
import { simpleParser, type AddressObject } from 'mailparser';
import { defaultSettings } from '@shared/types';
import type { CaseStore, FileStore, NoteStore, ReminderStore, SettingsStore, ShredStore } from './interface';
import {
  caseAttachmentsDir,
  caseDir,
  caseFile,
  caseLinksFile,
  caseNotesDir,
  caseRemindersFile,
  caseTasksFile,
  caseTimelineFile,
  casesDir,
  ensureCaseLayout,
  ensureDataLayout,
  globalRemindersFile,
  settingsFile,
  shredDir
} from './paths';
import { withLock } from '../util/mutex';

// ---------- low-level helpers ----------

/** Reads JSON, returning `fallback` ONLY when the file does not exist.
 *  Other errors (EACCES, parse failure, etc.) propagate so the caller can surface them. */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  let buf: string;
  try {
    buf = await readFile(path, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return fallback;
    throw err;
  }
  return JSON.parse(buf) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, path);
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID();
}

/** Filename sanitiser. Positive whitelist + bounded length. */
function safeFileName(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9._\- ]/g, '_').slice(0, 200).trim();
  return cleaned || 'untitled';
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return h.digest('hex');
}

function caseLockKey(id: CaseId): string {
  return `case:${id}`;
}

// ---------- CaseStore ----------

interface OnDiskCase {
  id: CaseId;
  title: string;
  reference: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

async function readCaseMeta(id: CaseId): Promise<OnDiskCase> {
  const meta = await readJson<OnDiskCase | null>(caseFile(id), null);
  if (!meta) throw new Error(`Case not found: ${id}`);
  return meta;
}

async function writeCaseMeta(meta: OnDiskCase): Promise<void> {
  await ensureCaseLayout(meta.id);
  await writeJson(caseFile(meta.id), meta);
}

async function loadFullCase(id: CaseId): Promise<CaseRecord> {
  const meta = await readCaseMeta(id);
  const [timeline, tasks, links, reminders, notes, attachments] = await Promise.all([
    readJson<TimelineEvent[]>(caseTimelineFile(id), []),
    readJson<TaskItem[]>(caseTasksFile(id), []),
    readJson<WebLink[]>(caseLinksFile(id), []),
    readJson<Reminder[]>(caseRemindersFile(id), []),
    listNotes(id),
    listAttachmentsImpl(id)
  ]);
  return { ...meta, notes, attachments, links, timeline, tasks, reminders };
}

export const caseStore: CaseStore = {
  async list(): Promise<CaseSummary[]> {
    await ensureDataLayout();
    let entries: string[];
    try {
      entries = await readdir(casesDir());
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return [];
      throw err;
    }
    const summaries: CaseSummary[] = [];
    for (const id of entries) {
      try {
        const meta = await readCaseMeta(id);
        summaries.push({
          id: meta.id,
          title: meta.title,
          reference: meta.reference,
          status: meta.status,
          priority: meta.priority,
          tags: meta.tags,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          archived: meta.archived
        });
      } catch (err) {
        // surface a placeholder so the UI can see something is wrong with this case dir,
        // rather than silently dropping the row
        const e = err as Error;
        summaries.push({
          id,
          title: `(unreadable: ${e.message})`,
          reference: '',
          status: 'open',
          priority: 'low',
          tags: ['__unreadable__'],
          createdAt: '',
          updatedAt: '',
          archived: false
        });
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  },

  async create(input: CreateCaseInput): Promise<CaseSummary> {
    await ensureDataLayout();
    const id = newId();
    return withLock(caseLockKey(id), async () => {
      const ts = nowIso();
      const meta: OnDiskCase = {
        id,
        title: input.title.trim() || 'Untitled Case',
        reference: (input.reference ?? '').trim(),
        description: input.description ?? '',
        status: input.status ?? 'new',
        priority: input.priority ?? 'medium',
        tags: input.tags ?? [],
        createdAt: ts,
        updatedAt: ts,
        archived: false
      };
      await writeCaseMeta(meta);
      const seedEvent: TimelineEvent = { id: newId(), at: ts, kind: 'created', message: 'Case opened.' };
      await writeJson(caseTimelineFile(id), [seedEvent]);
      return {
        id: meta.id,
        title: meta.title,
        reference: meta.reference,
        status: meta.status,
        priority: meta.priority,
        tags: meta.tags,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        archived: meta.archived
      };
    });
  },

  async read(id: CaseId): Promise<CaseRecord> {
    return loadFullCase(id);
  },

  async update(id: CaseId, patch: Partial<CaseRecord>): Promise<CaseRecord> {
    return withLock(caseLockKey(id), async () => {
      const meta = await readCaseMeta(id);
      const next: OnDiskCase = {
        ...meta,
        title: patch.title ?? meta.title,
        reference: patch.reference ?? meta.reference,
        description: patch.description ?? meta.description,
        status: patch.status ?? meta.status,
        priority: patch.priority ?? meta.priority,
        tags: patch.tags ?? meta.tags,
        updatedAt: nowIso()
      };
      await writeCaseMeta(next);
      return loadFullCase(id);
    });
  },

  async rename(id: CaseId, title: string): Promise<void> {
    return withLock(caseLockKey(id), async () => {
      const meta = await readCaseMeta(id);
      meta.title = title.trim() || meta.title;
      meta.updatedAt = nowIso();
      await writeCaseMeta(meta);
    });
  },

  async archive(id: CaseId, archived: boolean): Promise<void> {
    return withLock(caseLockKey(id), async () => {
      const meta = await readCaseMeta(id);
      meta.archived = archived;
      meta.updatedAt = nowIso();
      await writeCaseMeta(meta);
    });
  },

  async softDelete(id: CaseId): Promise<void> {
    return withLock(caseLockKey(id), async () => {
      const src = caseDir(id);
      const stamp = randomUUID().slice(0, 12);
      const dest = join(shredDir(), `case-${id}-${stamp}`);
      await mkdir(shredDir(), { recursive: true });
      await rename(src, dest);
    });
  },

  async addTimeline(id, ev) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<TimelineEvent[]>(caseTimelineFile(id), []);
      const created: TimelineEvent = { id: newId(), at: nowIso(), ...ev };
      list.push(created);
      await writeJson(caseTimelineFile(id), list);
      await touchUnlocked(id);
      return created;
    });
  },

  async addTask(id, text, dueAt) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<TaskItem[]>(caseTasksFile(id), []);
      const created: TaskItem = { id: newId(), text, done: false, createdAt: nowIso(), dueAt };
      list.push(created);
      await writeJson(caseTasksFile(id), list);
      await touchUnlocked(id);
      return created;
    });
  },

  async toggleTask(id, taskId) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<TaskItem[]>(caseTasksFile(id), []);
      const t = list.find((x) => x.id === taskId);
      if (!t) throw new Error(`Task not found: ${taskId}`);
      t.done = !t.done;
      await writeJson(caseTasksFile(id), list);
      await touchUnlocked(id);
      return t;
    });
  },

  async deleteTask(id, taskId) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<TaskItem[]>(caseTasksFile(id), []);
      const next = list.filter((x) => x.id !== taskId);
      await writeJson(caseTasksFile(id), next);
      await touchUnlocked(id);
    });
  },

  async addLink(id, url, title) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<WebLink[]>(caseLinksFile(id), []);
      const link: WebLink = { id: newId(), url, title: title || url, addedAt: nowIso() };
      list.push(link);
      await writeJson(caseLinksFile(id), list);
      await touchUnlocked(id);
      return link;
    });
  },

  async deleteLink(id, linkId) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<WebLink[]>(caseLinksFile(id), []);
      const next = list.filter((x) => x.id !== linkId);
      await writeJson(caseLinksFile(id), next);
      await touchUnlocked(id);
    });
  },

  async addReminder(id, r) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<Reminder[]>(caseRemindersFile(id), []);
      const created: Reminder = { id: newId(), caseId: id, fired: false, ...r };
      list.push(created);
      await writeJson(caseRemindersFile(id), list);
      await touchUnlocked(id);
      return created;
    });
  },

  async deleteReminder(id, reminderId) {
    return withLock(caseLockKey(id), async () => {
      const list = await readJson<Reminder[]>(caseRemindersFile(id), []);
      const next = list.filter((x) => x.id !== reminderId);
      await writeJson(caseRemindersFile(id), next);
      await touchUnlocked(id);
    });
  }
};

/** Like touch() but assumed to already hold the case lock. ENOENT means the case
 *  was deleted concurrently — silent. Other errors propagate. */
async function touchUnlocked(id: CaseId): Promise<void> {
  try {
    const meta = await readCaseMeta(id);
    meta.updatedAt = nowIso();
    await writeCaseMeta(meta);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || (e as unknown as Error).message?.startsWith('Case not found')) return;
    throw err;
  }
}

// ---------- FileStore ----------

async function listAttachmentsImpl(id: CaseId): Promise<AttachmentMeta[]> {
  let entries: string[];
  try {
    entries = await readdir(caseAttachmentsDir(id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
  const out: AttachmentMeta[] = [];
  for (const entry of entries) {
    // Sidecars (.meta.json) and the metadata-extraction cache (.extracted.json) are not
    // attachments — skip both or they list as phantom files and pollute AI/search context.
    if (entry.endsWith('.meta.json') || entry.endsWith('.extracted.json')) continue;
    const meta = await readJson<AttachmentMeta | null>(join(caseAttachmentsDir(id), `${entry}.meta.json`), null);
    if (meta) {
      out.push(meta);
    } else {
      try {
        const s = await stat(join(caseAttachmentsDir(id), entry));
        out.push({
          fileName: entry,
          originalName: entry,
          importedAt: s.mtime.toISOString(),
          size: s.size,
          sourcePath: null
        });
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') {
          out.push({
            fileName: entry,
            originalName: `(unreadable: ${e.code ?? 'error'})`,
            importedAt: '',
            size: -1,
            sourcePath: null
          });
        }
      }
    }
  }
  out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return out;
}

export const fileStore: FileStore = {
  async importDropped(id, files) {
    return withLock(caseLockKey(id), async () => {
      await ensureCaseLayout(id);
      const out: AttachmentMeta[] = [];
      const failures: { originalName: string; error: string }[] = [];
      for (const f of files) {
        try {
          const safeName = await uniqueAttachmentName(id, f.originalName);
          const dest = join(caseAttachmentsDir(id), safeName);
          await copyFile(f.sourcePath, dest);
          let sha: string | undefined;
          try { sha = await sha256File(dest); } catch { sha = undefined; }
          const s = await stat(dest);
          const meta: AttachmentMeta = {
            fileName: safeName,
            originalName: f.originalName,
            importedAt: nowIso(),
            size: s.size,
            sourcePath: f.sourcePath,
            sha256: sha
          };
          await writeJson(`${dest}.meta.json`, meta);
          out.push(meta);
        } catch (err) {
          failures.push({ originalName: f.originalName, error: (err as Error).message });
        }
      }
      // Write timeline entries for both successes and failures, while we still hold the lock.
      if (out.length > 0) {
        await appendTimelineUnlocked(id, {
          kind: 'file',
          message: `Imported ${out.length} file${out.length === 1 ? '' : 's'}: ${out.map((m) => m.originalName).join(', ')}`
        });
      }
      if (failures.length > 0) {
        await appendTimelineUnlocked(id, {
          kind: 'file',
          message: `Import failed for ${failures.length} file${failures.length === 1 ? '' : 's'}: ${failures.map((f) => `${f.originalName} (${f.error})`).join('; ')}`
        });
      }
      await touchUnlocked(id);
      return out;
    });
  },

  async listAttachments(id) {
    return listAttachmentsImpl(id);
  },

  async deleteAttachment(id, fileName) {
    return withLock(caseLockKey(id), async () => {
      const path = join(caseAttachmentsDir(id), fileName);
      const metaPath = `${path}.meta.json`;
      const stamp = randomUUID().slice(0, 12);
      const safe = safeFileName(fileName);
      const destBase = join(shredDir(), `attachment-${id}-${stamp}-${safe}`);
      await mkdir(shredDir(), { recursive: true });
      try {
        await rename(path, destBase);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') throw err;
      }
      try {
        await rename(metaPath, `${destBase}.meta.json`);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') throw err;
      }
    });
  },

  attachmentAbsolutePath(id, fileName) {
    return join(caseAttachmentsDir(id), fileName);
  },

  async readAttachmentText(id, fileName): Promise<AttachmentTextResult> {
    // fileName is validated by ensureFileName at the IPC boundary (no separators /
    // traversal), and joined under the per-case attachments dir — same confinement
    // as reveal/delete. We never read outside caseAttachmentsDir(id).
    const path = join(caseAttachmentsDir(id), fileName);
    let size = 0;
    try {
      const s = await stat(path);
      size = s.size;
      if (!s.isFile()) {
        return { fileName, text: null, size, bytesRead: 0, truncated: false, reason: 'read-error' };
      }
      if (size === 0) {
        return { fileName, text: null, size: 0, bytesRead: 0, truncated: false, reason: 'empty' };
      }
      const cap = Math.min(size, ATTACHMENT_TEXT_CAP_BYTES);
      const fh = await open(path, 'r');
      try {
        const buf = Buffer.alloc(cap);
        const { bytesRead } = await fh.read(buf, 0, cap, 0);
        const slice = buf.subarray(0, bytesRead);
        if (looksBinary(slice)) {
          return { fileName, text: null, size, bytesRead, truncated: size > bytesRead, reason: 'binary' };
        }
        return { fileName, text: slice.toString('utf8'), size, bytesRead, truncated: size > bytesRead };
      } finally {
        await fh.close();
      }
    } catch {
      return { fileName, text: null, size, bytesRead: 0, truncated: false, reason: 'read-error' };
    }
  },

  async readAttachmentBytes(id, fileName, offset, length): Promise<AttachmentBytesResult> {
    // fileName validated by ensureFileName + range by validateByteRange at the IPC boundary.
    const path = join(caseAttachmentsDir(id), fileName);
    let size = 0;
    try {
      const s = await stat(path);
      size = s.size;
      if (!s.isFile()) return { fileName, base64: null, size, offset, length: 0, hasMore: false, reason: 'read-error' };
      if (offset >= size) return { fileName, base64: null, size, offset, length: 0, hasMore: false, reason: 'out-of-range' };
      const want = Math.min(length, size - offset);
      const fh = await open(path, 'r');
      try {
        const buf = Buffer.alloc(want);
        const { bytesRead } = await fh.read(buf, 0, want, offset);
        const slice = buf.subarray(0, bytesRead);
        return { fileName, base64: slice.toString('base64'), size, offset, length: bytesRead, hasMore: offset + bytesRead < size };
      } finally {
        await fh.close();
      }
    } catch {
      return { fileName, base64: null, size, offset, length: 0, hasMore: false, reason: 'read-error' };
    }
  },

  async readEmlPreview(id, fileName): Promise<EmlPreview> {
    const path = join(caseAttachmentsDir(id), fileName);
    const raw = await readFile(path);
    if (raw.length > EML_MAX_BYTES) throw new Error(`EML exceeds the ${EML_MAX_BYTES} byte preview limit`);
    const parsed = await simpleParser(raw);
    const headers = (parsed.headerLines ?? []).map((h) => {
      const i = h.line.indexOf(':');
      return { key: h.key, value: i >= 0 ? h.line.slice(i + 1).trim() : '' };
    });
    const addrText = (v: AddressObject | AddressObject[] | undefined): string =>
      !v ? '' : Array.isArray(v) ? v.map((a) => a.text).join(', ') : v.text;
    return {
      from: parsed.from?.text ?? '',
      to: addrText(parsed.to),
      cc: addrText(parsed.cc),
      subject: parsed.subject ?? '(no subject)',
      date: parsed.date ? parsed.date.toISOString() : '',
      headers,
      text: parsed.text ?? '',
      html: typeof parsed.html === 'string' ? parsed.html : null,
      attachments: (parsed.attachments ?? []).map((a) => ({
        filename: a.filename ?? 'attachment',
        contentType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? a.content?.length ?? 0
      }))
    };
  },

  async extractAttachmentMeta(id, fileName): Promise<ExtractedAttachmentMeta> {
    const dir = caseAttachmentsDir(id);
    const path = join(dir, fileName);
    const cachePath = join(dir, `${fileName}.extracted.json`);
    const cached = await readJson<ExtractedAttachmentMeta | null>(cachePath, null);
    if (cached) return cached;

    const ext = extname(fileName).toLowerCase();
    const result: ExtractedAttachmentMeta = { fileName, fileType: ext.replace(/^\./, '') || 'unknown', size: 0 };
    try {
      const s = await stat(path);
      result.size = s.size;
      result.modifiedAt = s.mtime.toISOString();
      if (s.birthtimeMs > 0) result.createdAt = s.birthtime.toISOString();
    } catch { /* leave size 0 */ }

    const sidecar = await readJson<AttachmentMeta | null>(`${path}.meta.json`, null);
    if (sidecar) {
      result.importedAt = sidecar.importedAt;
      result.originalPath = sidecar.sourcePath;
    }

    const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.avif']);
    if (IMAGE_EXT.has(ext)) {
      try {
        const exif = await exifr.parse(path);
        if (exif && typeof exif === 'object') {
          const keep = ['Make', 'Model', 'Software', 'Orientation', 'DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight', 'LensModel'];
          const picked: Record<string, string> = {};
          for (const k of keep) {
            const v = (exif as Record<string, unknown>)[k];
            if (v != null) picked[k] = String(v instanceof Date ? v.toISOString() : v);
          }
          if (Object.keys(picked).length) result.exif = picked;
        }
        const gps = await exifr.gps(path);
        if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
          result.gps = { lat: gps.latitude, lon: gps.longitude };
        }
      } catch { /* EXIF is best-effort */ }
    } else if (ext === '.eml') {
      try {
        const raw = await readFile(path);
        if (raw.length <= EML_MAX_BYTES) {
          const parsed = await simpleParser(raw);
          result.emlHeaders = (parsed.headerLines ?? []).map((h) => {
            const i = h.line.indexOf(':');
            return { key: h.key, value: i >= 0 ? h.line.slice(i + 1).trim() : '' };
          });
        }
      } catch { /* EML headers best-effort */ }
    }

    try { await writeJson(cachePath, result); } catch { /* cache is best-effort */ }
    return result;
  }
};

/** Per-file cap on attachment text pulled into AI context. Keeps a single giant log
 *  from blowing the model's context window; the renderer enforces a separate total budget. */
const ATTACHMENT_TEXT_CAP_BYTES = 64 * 1024;

/** Refuse to parse a .eml larger than this in the viewer (multipart-bomb guard). */
const EML_MAX_BYTES = 25 * 1024 * 1024;

/** Heuristic binary sniff over the read buffer: a NUL byte, or >15% control chars
 *  (excluding tab/newline/CR/FF), means "not text" — don't ship it to the model. */
function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let control = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) return true;
    // Allow \t(9) \n(10) \r(13) \f(12); count other sub-0x20 + DEL as control.
    if ((b < 0x09 || (b > 0x0d && b < 0x20)) || b === 0x7f) control++;
  }
  return control / buf.length > 0.15;
}

async function uniqueAttachmentName(id: CaseId, originalName: string): Promise<string> {
  const safe = safeFileName(originalName);
  const stem = safe.replace(/\.[^.]+$/, '');
  const ext = extname(safe);
  let candidate = safe;
  let n = 1;
  while (true) {
    const path = join(caseAttachmentsDir(id), candidate);
    try {
      await stat(path);
      candidate = `${stem} (${n})${ext}`;
      n += 1;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return candidate;
      throw err;
    }
  }
}

async function appendTimelineUnlocked(id: CaseId, ev: Omit<TimelineEvent, 'id' | 'at'>): Promise<void> {
  const list = await readJson<TimelineEvent[]>(caseTimelineFile(id), []);
  list.push({ id: newId(), at: nowIso(), ...ev });
  await writeJson(caseTimelineFile(id), list);
}

// ---------- NoteStore ----------

async function listNotes(id: CaseId): Promise<{ name: string; updatedAt: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(caseNotesDir(id));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
  const out: { name: string; updatedAt: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.txt')) continue;
    try {
      const s = await stat(join(caseNotesDir(id), entry));
      out.push({ name: basename(entry, '.txt'), updatedAt: s.mtime.toISOString() });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        out.push({ name: basename(entry, '.txt'), updatedAt: '' });
      }
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export const noteStore: NoteStore = {
  async list(id) {
    return listNotes(id);
  },

  async read(id, name) {
    const safe = safeFileName(name);
    return readFile(join(caseNotesDir(id), `${safe}.txt`), 'utf8');
  },

  async write(id, name, body) {
    return withLock(caseLockKey(id), async () => {
      await ensureCaseLayout(id);
      const safe = safeFileName(name);
      const path = join(caseNotesDir(id), `${safe}.txt`);
      const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, body, 'utf8');
      await rename(tmp, path);
      await touchUnlocked(id);
    });
  },

  async delete(id, name) {
    return withLock(caseLockKey(id), async () => {
      const safe = safeFileName(name);
      await rm(join(caseNotesDir(id), `${safe}.txt`), { force: true });
      await touchUnlocked(id);
    });
  }
};

// ---------- SettingsStore ----------

export const settingsStore: SettingsStore = {
  async read(): Promise<AppSettings> {
    return withLock('settings', async () => {
      await ensureDataLayout();
      const onDisk = await readJson<Partial<AppSettings> | null>(settingsFile(), null);
      if (!onDisk) {
        await writeJson(settingsFile(), defaultSettings);
        return defaultSettings;
      }
      return mergeSettings(defaultSettings, onDisk);
    });
  },

  async update(patch): Promise<AppSettings> {
    return withLock('settings', async () => {
      await ensureDataLayout();
      const onDisk = await readJson<Partial<AppSettings> | null>(settingsFile(), null);
      const cur = onDisk ? mergeSettings(defaultSettings, onDisk) : defaultSettings;
      const next = mergeSettings(cur, patch);
      await writeJson(settingsFile(), next);
      return next;
    });
  }
};

function mergeSettings(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...base,
    ...patch,
    ai: { ...base.ai, ...(patch.ai ?? {}) },
    mail: { ...base.mail, ...(patch.mail ?? {}) },
    browser: { ...base.browser, ...(patch.browser ?? {}) },
    shortcuts: patch.shortcuts ?? base.shortcuts,
    hasSeenWelcome: patch.hasSeenWelcome ?? base.hasSeenWelcome,
    caseSortBy: patch.caseSortBy ?? base.caseSortBy,
    caseSortDir: patch.caseSortDir ?? base.caseSortDir
  };
}

// ---------- ReminderStore ----------

export const reminderStore: ReminderStore = {
  async listGlobal(): Promise<Reminder[]> {
    return withLock('reminders-global', () => readJson<Reminder[]>(globalRemindersFile(), []));
  },

  async upsertGlobal(r: Reminder): Promise<Reminder> {
    return withLock('reminders-global', async () => {
      const list = await readJson<Reminder[]>(globalRemindersFile(), []);
      const idx = list.findIndex((x) => x.id === r.id);
      const stored = { ...r, id: r.id || newId() };
      if (idx >= 0) list[idx] = stored;
      else list.push(stored);
      await writeJson(globalRemindersFile(), list);
      return stored;
    });
  },

  async deleteGlobal(id: string): Promise<void> {
    return withLock('reminders-global', async () => {
      const list = await readJson<Reminder[]>(globalRemindersFile(), []);
      const next = list.filter((x) => x.id !== id);
      await writeJson(globalRemindersFile(), next);
    });
  },

  async drainDue(now: Date): Promise<Reminder[]> {
    const due: Reminder[] = [];
    await withLock('reminders-global', async () => {
      const globals = await readJson<Reminder[]>(globalRemindersFile(), []);
      let changed = false;
      for (const r of globals) {
        if (!r.fired && new Date(r.fireAt) <= now) {
          due.push(r);
          r.fired = true;
          changed = true;
        }
      }
      if (changed) await writeJson(globalRemindersFile(), globals);
    });

    let caseIds: string[];
    try {
      caseIds = await readdir(casesDir());
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') caseIds = [];
      else throw err;
    }
    const broken: { caseId: string; reason: string }[] = [];
    for (const cid of caseIds) {
      try {
        await withLock(caseLockKey(cid), async () => {
          const path = caseRemindersFile(cid);
          const list = await readJson<Reminder[]>(path, []);
          let changed = false;
          for (const r of list) {
            if (!r.fired && new Date(r.fireAt) <= now) {
              due.push({ ...r, caseId: cid });
              r.fired = true;
              changed = true;
            }
          }
          if (changed) await writeJson(path, list);
        });
      } catch (err) {
        broken.push({ caseId: cid, reason: (err as Error).message });
      }
    }
    // Stash broken-case info on a module-global so the ticker can surface it once per tick
    // rather than per-case (would otherwise notification-spam the user).
    lastDrainBroken = broken;
    return due;
  }
};

let lastDrainBroken: { caseId: string; reason: string }[] = [];
export function consumeDrainDiagnostics(): { caseId: string; reason: string }[] {
  const out = lastDrainBroken;
  lastDrainBroken = [];
  return out;
}

// ---------- ShredStore ----------

export const shredStore: ShredStore = {
  async list() {
    return withLock('shred', async () => {
      let entries: string[];
      try {
        entries = await readdir(shredDir());
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return [];
        throw err;
      }
      const out: { id: string; kind: 'case' | 'attachment'; label: string; deletedAt: string }[] = [];
      for (const e of entries) {
        if (e.endsWith('.meta.json')) continue;
        try {
          const s = await stat(join(shredDir(), e));
          if (e.startsWith('case-')) {
            const meta = await readJson<OnDiskCase | null>(join(shredDir(), e, 'case.json'), null);
            out.push({
              id: e,
              kind: 'case',
              label: meta?.title ?? e,
              deletedAt: s.mtime.toISOString()
            });
          } else if (e.startsWith('attachment-')) {
            out.push({
              id: e,
              kind: 'attachment',
              label: e.replace(/^attachment-[^-]+(?:-[^-]+){4}-[^-]+-/, ''),
              deletedAt: s.mtime.toISOString()
            });
          }
        } catch (err) {
          const ee = err as NodeJS.ErrnoException;
          if (ee.code !== 'ENOENT') {
            out.push({ id: e, kind: e.startsWith('case-') ? 'case' : 'attachment', label: `(unreadable: ${ee.code ?? 'error'})`, deletedAt: '' });
          }
        }
      }
      out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return out;
    });
  },

  async restore(id) {
    return withLock('shred', async () => {
      if (id.startsWith('case-')) {
        const m = id.match(/^case-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-[a-f0-9]+$/i);
        if (!m) throw new Error(`Cannot parse shred id: ${id}`);
        const caseId = m[1];
        await rename(join(shredDir(), id), caseDir(caseId));
        return;
      }
      if (id.startsWith('attachment-')) {
        const m = id.match(/^attachment-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-[a-f0-9]+-(.+)$/i);
        if (!m) throw new Error(`Cannot parse shred id: ${id}`);
        const caseId = m[1];
        const fileName = m[2];
        await ensureCaseLayout(caseId);
        await rename(join(shredDir(), id), join(caseAttachmentsDir(caseId), fileName));
        try {
          await rename(join(shredDir(), `${id}.meta.json`), join(caseAttachmentsDir(caseId), `${fileName}.meta.json`));
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code !== 'ENOENT') throw err;
        }
      }
    });
  },

  async purge(id) {
    return withLock('shred', async () => {
      await rm(join(shredDir(), id), { recursive: true, force: true });
      await rm(join(shredDir(), `${id}.meta.json`), { force: true });
    });
  },

  async purgeAll() {
    return withLock('shred', async () => {
      let entries: string[];
      try {
        entries = await readdir(shredDir());
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return;
        throw err;
      }
      await Promise.all(entries.map((e) => rm(join(shredDir(), e), { recursive: true, force: true })));
    });
  }
};
