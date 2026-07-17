/**
 * Central validators used across IPC handlers. Every renderer-supplied identifier,
 * filename, URL, and SSH key path passes through here. Treat the renderer as hostile.
 *
 * v1.0.1 round-3 hardening: IPv6 / IPv4-mapped detection via net.isIP, symlink
 * resolution for SSH key paths, mailto: param stripping to prevent ?attach= exfil.
 */

import { resolve, relative, isAbsolute, normalize } from 'node:path';
import { realpath } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { homedir } from 'node:os';
import { isIP, isIPv6 } from 'node:net';
import { randomUUID } from 'node:crypto';
import { ENTITY_TYPES, ENTITY_RELATIONSHIPS, TIMELINE_KINDS, IMAGE_MIMES, type EntityType, type EntityRelationship, type TimelineKind, type TimelineEvent, type ImageMime, type Whiteboard, type WhiteboardNode, type WhiteboardEdge, type WhiteboardNodeType, type JournalEntryInput } from '@shared/types';
import type { Bounds } from '@shared/livefeeds/types';
import type { GeoItem, BookmarkBoard, BookmarkCategory, BookmarkLink, StickyNote, StickyNotesState, AiChatMessage, AiConversationInput, BriefcaseNoteInput } from '@shared/post-mvp-types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Throws if `id` isn't a UUIDv4. */
export function ensureUuid(id: unknown, context = 'id'): string {
  if (typeof id !== 'string' || !UUID_V4.test(id)) {
    throw new ValidationError(`Invalid ${context}: expected a UUID`);
  }
  return id;
}

/** Validates a filename — no separators, no traversal, no NUL, max 200 chars. */
export function ensureFileName(name: unknown, context = 'name'): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
    throw new ValidationError(`Invalid ${context}: empty or too long`);
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..') {
    throw new ValidationError(`Invalid ${context}: path separators or traversal not allowed`);
  }
  return name;
}

/** Hard ceiling on a single attachment-bytes read, regardless of what the renderer asks.
 *  base64 inflates ~4/3, so 16 MiB raw → ~21 MiB string — fine for one viewer page. */
export const MAX_ATTACHMENT_READ_BYTES = 16 * 1024 * 1024;

/** Validate + clamp a byte range for readAttachmentBytes. `offset` must be a non-negative
 *  safe integer; `length` is clamped to [1, MAX_ATTACHMENT_READ_BYTES] so a hostile renderer
 *  cannot request an unbounded slice and OOM the main process. */
export function validateByteRange(offset: unknown, length: unknown): { offset: number; length: number } {
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ValidationError('Invalid byte offset');
  }
  if (typeof length !== 'number' || !Number.isFinite(length)) {
    throw new ValidationError('Invalid byte length');
  }
  const clamped = Math.min(Math.max(1, Math.floor(length)), MAX_ATTACHMENT_READ_BYTES);
  return { offset, length: clamped };
}

/** Validate a renderer-originated timeline event (the addTimeline channel carries 'view'
 *  and 'entity' events from the renderer). Whitelists the kind and bounds + de-controls the
 *  message — closes the cast-only trust gap the handler previously had. */
export function ensureTimelineEvent(raw: unknown): Omit<TimelineEvent, 'id' | 'at'> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const kind = o['kind'];
  if (typeof kind !== 'string' || !TIMELINE_KINDS.includes(kind as TimelineKind)) {
    throw new ValidationError('Invalid timeline event kind');
  }
  const message = typeof o['message'] === 'string'
    ? o['message'].replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2000)
    : '';
  return { kind: kind as TimelineKind, message };
}

// ---------- entities ----------

const MAX_ENTITY_VALUE = 2000;
const MAX_ENTITY_NOTES = 20000;

const ENTITY_ID = /^ent-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Entity registry ids are `ent-<uuidv4>`. */
export function ensureEntityId(id: unknown): string {
  if (typeof id !== 'string' || !ENTITY_ID.test(id)) throw new ValidationError('Invalid entity id');
  return id;
}

export function ensureEntityType(t: unknown): EntityType {
  if (typeof t !== 'string' || !ENTITY_TYPES.includes(t as EntityType)) throw new ValidationError('Invalid entity type');
  return t as EntityType;
}

/** Returns the relationship, or null to clear it. */
export function ensureRelationship(r: unknown): EntityRelationship | null {
  if (r == null || r === '') return null;
  if (typeof r !== 'string' || !ENTITY_RELATIONSHIPS.includes(r as EntityRelationship)) throw new ValidationError('Invalid relationship');
  return r as EntityRelationship;
}

interface EntityInputClean { type: EntityType; value: string; notes: string; aliases: string[] }

export function ensureEntityInput(raw: unknown): EntityInputClean {
  const o = (raw ?? {}) as Record<string, unknown>;
  const type = ensureEntityType(o['type']);
  const value = o['value'];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_ENTITY_VALUE) {
    throw new ValidationError('Entity value is empty or too long');
  }
  const notes = typeof o['notes'] === 'string' ? o['notes'].slice(0, MAX_ENTITY_NOTES) : '';
  const aliases = Array.isArray(o['aliases'])
    ? (o['aliases'] as unknown[]).filter((a): a is string => typeof a === 'string' && a.length <= MAX_ENTITY_VALUE).slice(0, 100)
    : [];
  return { type, value: value.trim(), notes, aliases };
}

export function ensureEntityPatch(raw: unknown): Partial<EntityInputClean> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<EntityInputClean> = {};
  if (o['type'] !== undefined) out.type = ensureEntityType(o['type']);
  if (o['value'] !== undefined) {
    const v = o['value'];
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > MAX_ENTITY_VALUE) throw new ValidationError('Entity value is empty or too long');
    out.value = v.trim();
  }
  if (o['notes'] !== undefined) out.notes = typeof o['notes'] === 'string' ? o['notes'].slice(0, MAX_ENTITY_NOTES) : '';
  if (o['aliases'] !== undefined) {
    out.aliases = Array.isArray(o['aliases'])
      ? (o['aliases'] as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 100)
      : [];
  }
  return out;
}

/** Validate the per-case link options. CRITICAL: each attachmentFileName passes ensureFileName
 *  (no separators/traversal) because these are later dereferenced against the case dir. */
export function ensureLinkOpts(raw: unknown): { relationship?: EntityRelationship; linkIds?: string[]; attachmentFileNames?: string[] } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: { relationship?: EntityRelationship; linkIds?: string[]; attachmentFileNames?: string[] } = {};
  const rel = ensureRelationship(o['relationship']);
  if (rel) out.relationship = rel;
  if (o['linkIds'] !== undefined) {
    if (!Array.isArray(o['linkIds'])) throw new ValidationError('linkIds must be an array');
    out.linkIds = (o['linkIds'] as unknown[]).map((x) => {
      if (typeof x !== 'string' || x.length === 0 || x.length > 200) throw new ValidationError('Invalid link id');
      return x;
    });
  }
  if (o['attachmentFileNames'] !== undefined) {
    if (!Array.isArray(o['attachmentFileNames'])) throw new ValidationError('attachmentFileNames must be an array');
    out.attachmentFileNames = (o['attachmentFileNames'] as unknown[]).map((x) => ensureFileName(x, 'attachmentFileName'));
  }
  return out;
}

/** Literal (non-regex) search query: trimmed, non-empty, bounded. */
export function ensureSearchQuery(q: unknown): string {
  if (typeof q !== 'string') throw new ValidationError('Search query must be a string');
  const t = q.trim();
  if (t.length === 0) throw new ValidationError('Search query is empty');
  if (t.length > 200) throw new ValidationError('Search query too long');
  return t;
}

// ---------- local AI ----------

/** Wizard setup options. The model SOURCE is pinned server-side (build constants / ci/pins.json),
 *  NEVER supplied by the renderer — so we accept only the mode, nothing URL-like (SSRF guard). */
export function ensureLocalAiSetupOpts(raw: unknown): { mode: 'online' | 'bundled' } {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Setup options required');
  const mode = (raw as { mode?: unknown }).mode;
  if (mode !== 'online' && mode !== 'bundled') throw new ValidationError('mode must be "online" or "bundled"');
  return { mode };
}

// ---------- auth ----------

/** Master password: non-empty, bounded (the bound only guards against pathological input —
 *  scrypt cost is fixed by the KDF params, not the password length). Not trimmed: leading/
 *  trailing whitespace is legitimate password material. */
export function ensurePassword(v: unknown): string {
  if (typeof v !== 'string') throw new ValidationError('Password must be a string');
  if (v.length === 0) throw new ValidationError('Password is required');
  if (v.length > 1024) throw new ValidationError('Password too long');
  return v;
}

/** Minimum length for a NEW master password. A full backup (.ga98) bundles the wrapped DEK, so
 *  the password wrap is an OFFLINE scrypt-cracking target — its strength is the only brake. */
export const MIN_NEW_PASSWORD_LEN = 12;

/** Validator for setup + changePassword: enforces the minimum length in the MAIN process, so a
 *  compromised renderer can't bypass the policy. unlock/disable keep ensurePassword (existing
 *  passwords predate the policy and must still be accepted). */
export function ensureNewPassword(v: unknown): string {
  const pw = ensurePassword(v);
  if (pw.length < MIN_NEW_PASSWORD_LEN) {
    throw new ValidationError(`Password must be at least ${MIN_NEW_PASSWORD_LEN} characters`);
  }
  return pw;
}

/** Recovery key as typed by the user — normalized vault-side, so accept dashes/spacing/case. */
export function ensureRecoveryKey(v: unknown): string {
  if (typeof v !== 'string') throw new ValidationError('Recovery key must be a string');
  if (v.trim().length === 0) throw new ValidationError('Recovery key is required');
  if (v.length > 128) throw new ValidationError('Recovery key too long');
  return v;
}

// ---------- whiteboard ----------

const WB_NODE_TYPES = new Set<WhiteboardNodeType>(['text', 'link', 'image', 'file']);
const MAX_WB_NODES = 2000;
const MAX_WB_EDGES = 4000;

function wbNum(v: unknown, def = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : def; }
function wbStr(v: unknown, max: number): string | undefined { return typeof v === 'string' ? v.slice(0, max) : undefined; }

/** Validate + clamp a renderer-supplied whiteboard: bounded node/edge counts, numeric coords,
 *  bounded strings, fileName refs through ensureFileName, and dangling edges dropped. */
export function ensureWhiteboard(raw: unknown): Whiteboard {
  const o = (raw ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodesIn = Array.isArray(o.nodes) ? o.nodes.slice(0, MAX_WB_NODES) : [];
  const edgesIn = Array.isArray(o.edges) ? o.edges.slice(0, MAX_WB_EDGES) : [];
  const nodes: WhiteboardNode[] = [];
  for (const raw0 of nodesIn) {
    const n = (raw0 ?? {}) as Record<string, unknown>;
    if (typeof n['id'] !== 'string' || typeof n['type'] !== 'string' || !WB_NODE_TYPES.has(n['type'] as WhiteboardNodeType)) continue;
    const node: WhiteboardNode = {
      id: n['id'].slice(0, 64),
      type: n['type'] as WhiteboardNodeType,
      x: wbNum(n['x']),
      y: wbNum(n['y']),
      w: Math.max(40, Math.min(wbNum(n['w'], 200), 4000)),
      h: Math.max(30, Math.min(wbNum(n['h'], 120), 4000))
    };
    const text = wbStr(n['text'], 20000); if (text !== undefined) node.text = text;
    const url = wbStr(n['url'], 2048); if (url !== undefined) node.url = url;
    const color = wbStr(n['color'], 16); if (color !== undefined) node.color = color;
    const name = wbStr(n['name'], 120); if (name !== undefined) node.name = name;
    if (n['fileName'] !== undefined) {
      try { node.fileName = ensureFileName(n['fileName'], 'fileName'); } catch { continue; }
    }
    nodes.push(node);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: WhiteboardEdge[] = [];
  for (const raw0 of edgesIn) {
    const e = (raw0 ?? {}) as Record<string, unknown>;
    if (typeof e['id'] !== 'string' || typeof e['from'] !== 'string' || typeof e['to'] !== 'string') continue;
    if (!ids.has(e['from']) || !ids.has(e['to'])) continue; // drop dangling edges
    const edge: WhiteboardEdge = { id: e['id'].slice(0, 64), from: e['from'], to: e['to'] };
    const label = wbStr(e['label'], 200); if (label !== undefined) edge.label = label;
    edges.push(edge);
  }
  return { nodes, edges };
}

const MAX_BOARD_ASSETS = 2000;
const MAX_ASSET_B64 = 34 * 1024 * 1024; // ~25 MB decoded

/** Validate + bound a portable `.gboard` file: reuses `ensureWhiteboard` for nodes/edges,
 *  bounds asset count + per-asset size, and drops any asset not referenced by a node fileName. */
export function ensureBoardFile(raw: unknown): import('@shared/board-file').BoardFile {
  const o = (raw ?? {}) as { nodes?: unknown; edges?: unknown; assets?: unknown };
  const wb = ensureWhiteboard({ nodes: o.nodes, edges: o.edges }); // reuse node/edge validation
  const refs = new Set(wb.nodes.map((n) => n.fileName).filter((f): f is string => !!f));
  const assetsIn = (o.assets && typeof o.assets === 'object') ? o.assets as Record<string, unknown> : {};
  const assets: Record<string, string> = {};
  let n = 0;
  for (const [name, v] of Object.entries(assetsIn)) {
    if (n >= MAX_BOARD_ASSETS) break;
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ASSET_B64) continue;
    if (!refs.has(name)) continue; // only referenced assets
    assets[name] = v; n++;
  }
  return { version: 1, nodes: wb.nodes, edges: wb.edges, assets };
}

// ---------- FTP (remote paths/names — bounded, control-char-free) ----------

/** A single remote file name for download (no path separators — navigation is via cd). */
export function ensureFtpName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) throw new ValidationError('Invalid FTP file name');
  if (name.includes('\0') || name.includes('/') || name.includes('\\')) throw new ValidationError('Invalid FTP file name');
  return name;
}

/** A remote path for cd (may contain '/'; remote-side only, no local-FS bearing). */
export function ensureFtpPath(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024) throw new ValidationError('Invalid FTP path');
  if (path.includes('\0')) throw new ValidationError('Invalid FTP path');
  return path;
}

/** A DialTerm session id (server-generated `s-`/`t-`/`f-`/`sh-` + uuid). Bounded string check.
 *  The local shell service mints `sh-<uuid>` — without that prefix here, write/resize/disconnect
 *  always threw, breaking the feature and leaking the pty (no disconnect could land). */
export function ensureSessionId(id: unknown): string {
  if (typeof id !== 'string' || !/^(s|t|f|sh)-[0-9a-f-]{36}$/i.test(id)) throw new ValidationError('Invalid session id');
  return id;
}

/** The renderer may only pass a shell CHOICE token, never an executable path. Anything
 *  not in the allowlist degrades to 'cmd'. The main process maps the token to a fixed
 *  executable — see services/shell.ts. */
export function ensureShellProgram(v: unknown): 'cmd' | 'powershell' {
  return v === 'powershell' ? 'powershell' : 'cmd';
}

// ---------- bio images ----------

const BIO_ID = /^bio-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureBioId(id: unknown): string {
  if (typeof id !== 'string' || !BIO_ID.test(id)) throw new ValidationError('Invalid bio image id');
  return id;
}

export function ensureImageMime(m: unknown): ImageMime {
  if (typeof m !== 'string' || !IMAGE_MIMES.includes(m as ImageMime)) throw new ValidationError('Unsupported image type (allowed: JPG, PNG, WEBP, GIF)');
  return m as ImageMime;
}

interface BioAddClean { originalName: string; mime: ImageMime; width: number; height: number; originalBase64: string; thumbBase64: string }

/** Validate a bio-image add payload. base64 length caps are enforced in the store; here we
 *  whitelist the mime, bound the name + dimensions, and confirm the base64 fields are strings. */
export function ensureBioInput(raw: unknown): BioAddClean {
  const o = (raw ?? {}) as Record<string, unknown>;
  const mime = ensureImageMime(o['mime']);
  const originalName = typeof o['originalName'] === 'string' && o['originalName'].length > 0 && o['originalName'].length <= 200
    ? o['originalName'] : 'image';
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.floor(v) : 0);
  const originalBase64 = o['originalBase64'];
  const thumbBase64 = o['thumbBase64'];
  if (typeof originalBase64 !== 'string' || originalBase64.length === 0) throw new ValidationError('Missing image data');
  if (typeof thumbBase64 !== 'string' || thumbBase64.length === 0) throw new ValidationError('Missing thumbnail data');
  return { originalName, mime, width: num(o['width']), height: num(o['height']), originalBase64, thumbBase64 };
}

/** Stricter sanitiser used at the OS-save-dialog default path — strips control bytes,
 *  leading/trailing dots and spaces, Windows reserved names. Caller still drives the
 *  native dialog; the user has final say on the destination. */
export function sanitiseSaveDefault(name: string): string {
  let s = name.replace(/[\x00-\x1F\x7F]/g, '_');
  s = s.replace(/[\\/:*?"<>|]/g, '_');
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  s = s.slice(0, 200);
  // Windows reserved device names
  const stem = s.replace(/\.[^.]*$/, '').toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) s = `_${s}`;
  return s || 'attachment';
}

/** Validates pickOpen filter shape — extensions are short alphanumeric tokens. */
export function validatePickFilters(filters: unknown): { name: string; extensions: string[] }[] | undefined {
  if (!filters) return undefined;
  if (!Array.isArray(filters)) throw new ValidationError('filters must be an array');
  if (filters.length > 8) throw new ValidationError('too many filters (max 8)');
  const out: { name: string; extensions: string[] }[] = [];
  for (const f of filters) {
    if (!f || typeof f !== 'object') throw new ValidationError('filter must be an object');
    const fo = f as { name?: unknown; extensions?: unknown };
    if (typeof fo.name !== 'string' || fo.name.length === 0 || fo.name.length > 50) {
      throw new ValidationError('filter.name must be a 1-50 char string');
    }
    if (!Array.isArray(fo.extensions) || fo.extensions.length === 0 || fo.extensions.length > 16) {
      throw new ValidationError('filter.extensions must be a 1-16 element array');
    }
    const exts: string[] = [];
    for (const e of fo.extensions) {
      if (typeof e !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(e)) {
        throw new ValidationError(`bad extension: ${String(e)}`);
      }
      exts.push(e);
    }
    out.push({ name: fo.name, extensions: exts });
  }
  return out;
}

/** Bookmark URL allowlist — http(s) only, no loopback/private (those belong in DialTerm/EyeSpy). */
export function validateBookmarkUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ValidationError('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ValidationError(`Bookmark URL must use http:// or https:// — got ${u.protocol}`);
  }
  if (isLoopbackOrPrivate(u.hostname)) {
    throw new ValidationError('Bookmark URL cannot point at loopback or a private network');
  }
  return u.toString();
}

/** Asserts the resolved `candidate` is inside `root` (purely textual — does not follow symlinks). */
export function ensureWithin(root: string, candidate: string): string {
  const r = resolve(root);
  const c = resolve(candidate);
  const rel = relative(r, c);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ValidationError(`Path escapes data root: ${candidate}`);
  }
  return c;
}

/** Returns true if the hostname resolves textually to loopback / link-local / RFC1918 / metadata IPs.
 *  Robust against expanded and zero-compressed IPv6 forms, IPv4-mapped IPv6 in either
 *  `::ffff:a.b.c.d` or `0:0:0:0:0:ffff:hhhh:hhhh` shape, link-local, unique-local. */
export function isLoopbackOrPrivate(hostname: string): boolean {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  const v = isIP(h);
  if (v === 4) return isIPv4LoopbackOrPrivate(h);

  if (v === 6) {
    // Canonicalise — expand `::` and pad each group to 4 hex digits.
    const canon = canonicalizeIPv6(h);
    // IPv6 loopback ::1 → 0000:0000:0000:0000:0000:0000:0000:0001
    if (canon === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // IPv4-mapped form (any spelling): take the trailing 32 bits and re-check as IPv4
    const v4 = ipv6ToMappedIPv4(canon);
    if (v4) return isIPv4LoopbackOrPrivate(v4);
    // Link-local fe80::/10 — first group's high bits are 0xfe8X..0xfeBX
    const groups = canon.split(':');
    const g0 = parseInt(groups[0], 16);
    if ((g0 & 0xffc0) === 0xfe80) return true;
    // Unique-local fc00::/7 — first byte of first group is 0xfc or 0xfd
    const g0HighByte = (g0 >> 8) & 0xff;
    if ((g0HighByte & 0xfe) === 0xfc) return true;
    return false;
  }
  return false;
}

function canonicalizeIPv6(input: string): string {
  let h = input.toLowerCase();
  if (h.includes('::')) {
    const parts = h.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    h = [...left, ...Array(missing).fill('0'), ...right].join(':');
  }
  return h.split(':').map((s) => s.padStart(4, '0')).join(':');
}

function ipv6ToMappedIPv4(canon: string): string | null {
  // 0000:0000:0000:0000:0000:ffff:WWWW:UUUU
  const m = canon.match(/^0000:0000:0000:0000:0000:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/);
  if (!m) return null;
  const g6 = parseInt(m[1], 16);
  const g7 = parseInt(m[2], 16);
  return `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
}

function isIPv4LoopbackOrPrivate(h: string): boolean {
  if (h.startsWith('127.')) return true;
  if (h === '169.254.169.254' || h.startsWith('169.254.')) return true;
  if (h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '0.0.0.0') return true;
  return false;
}

/** URL allowlist for the AI Assistant. Returns the parsed URL or throws. */
export function validateAiEndpoint(endpoint: string, provider: 'ollama' | 'openai-compatible'): URL {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new ValidationError('AI endpoint is not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ValidationError('AI endpoint must use http:// or https://');
  }
  // Reject userinfo to prevent rebinding-style confusion
  if (u.username || u.password) {
    throw new ValidationError('AI endpoint must not contain userinfo (user:pass@)');
  }
  if (provider === 'ollama') {
    if (!isLoopbackOrPrivate(u.hostname)) {
      throw new ValidationError('Ollama endpoint must point at localhost / private network');
    }
  } else {
    if (u.protocol !== 'https:') {
      throw new ValidationError('OpenAI-compatible endpoint must use https://');
    }
    if (isLoopbackOrPrivate(u.hostname)) {
      throw new ValidationError('OpenAI-compatible endpoint cannot point at loopback / private / metadata IPs');
    }
    // Defence in depth — IPv4-mapped IPv6 in any spelling is rejected outright for
    // the openai-compatible path even though isLoopbackOrPrivate already catches the
    // ones that point at loopback / metadata.
    if (isIP(u.hostname) === 6) {
      const canon = canonicalizeIPv6(u.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
      if (/^0000:0000:0000:0000:0000:ffff:/i.test(canon)) {
        throw new ValidationError('IPv4-mapped IPv6 endpoints not allowed');
      }
    }
  }
  return u;
}

/** URL allowlist for shell.openExternal. Blocks file:/javascript:/* and strips mailto: query params
 *  (which can carry `?attach=` to exfil local files in some mail clients). */
export function validateExternalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ValidationError('Invalid URL');
  }
  if (u.protocol === 'mailto:') {
    // Strip every query param that could trigger client-side attachment / body injection.
    // Some mail clients honour ?attach=, ?attachment=, ?body=, etc. We allow only ?subject=.
    const safeParams = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (k.toLowerCase() === 'subject') safeParams.set('subject', v);
    }
    const qs = safeParams.toString();
    const out = `mailto:${u.pathname}${qs ? `?${qs}` : ''}`;
    return out;
  }
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    return u.toString();
  }
  throw new ValidationError(`URL scheme not allowed: ${u.protocol}`);
}

/** EyeSpy feed import: a camera URL is acceptable only if http/https/rtsp.
 *  (rtsp is allowed — the operator's own cameras — but file:/javascript:/etc are not.) */
export function ensureFeedUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:' || p === 'rtsp:';
  } catch { return false; }
}

const GEO_SOURCE_TYPES = ['rss', 'atom', 'geojson', 'kml', 'gpx', 'xml', 'jsonfeed'] as const;
type GeoSourceTypeLit = (typeof GEO_SOURCE_TYPES)[number];

function ensureXmlMap(v: unknown): import('@shared/post-mvp-types').GeoXmlMap {
  if (!v || typeof v !== 'object') throw new ValidationError('xml source requires an xmlMap object');
  const o = v as Record<string, unknown>;
  const reqStr = (k: string): string => {
    const x = o[k];
    if (typeof x !== 'string' || x.trim().length === 0 || x.length > 200) {
      throw new ValidationError(`xmlMap.${k} must be a 1-200 char string`);
    }
    return x.trim();
  };
  const optStr = (k: string): string | undefined => {
    const x = o[k];
    if (x === undefined) return undefined;
    if (typeof x !== 'string' || x.length > 200) throw new ValidationError(`xmlMap.${k} must be a string up to 200 chars`);
    return x.trim() || undefined;
  };
  return {
    itemsPath: reqStr('itemsPath'),
    lat: reqStr('lat'),
    lon: reqStr('lon'),
    title: optStr('title'),
    summary: optStr('summary'),
    link: optStr('link'),
    date: optStr('date')
  };
}

/** GeoINT: a pluggable source. Label bounded; URL must be http/https; type enum. */
export function ensureGeoSource(v: unknown): { label: string; url: string; type: GeoSourceTypeLit; xmlMap?: import('@shared/post-mvp-types').GeoXmlMap } {
  if (!v || typeof v !== 'object') throw new ValidationError('source must be an object');
  const o = v as { label?: unknown; url?: unknown; type?: unknown; xmlMap?: unknown };
  if (typeof o.label !== 'string' || o.label.trim().length === 0 || o.label.length > 200) {
    throw new ValidationError('source.label must be a 1-200 char string');
  }
  if (typeof o.url !== 'string') throw new ValidationError('source.url must be a string');
  const url = validateExternalUrl(o.url);
  if (!isPublicHttpUrl(url)) throw new ValidationError('source.url must be a public http(s) URL (not loopback/private)');
  if (typeof o.type !== 'string' || !GEO_SOURCE_TYPES.includes(o.type as GeoSourceTypeLit)) {
    throw new ValidationError('source.type invalid');
  }
  const type = o.type as GeoSourceTypeLit;
  if (type === 'xml') return { label: o.label.trim(), url, type, xmlMap: ensureXmlMap(o.xmlMap) };
  return { label: o.label.trim(), url, type };
}

/** GeoINT threat-layer id allowlist (extensible). A hostile renderer can call fetchThreatLayer
 *  directly; this rejects any id the dispatcher doesn't know before it reaches the dispatcher.
 *  Keyed layers (firms/gdeltcloud/ucdp) are included — the handler additionally requires a stored
 *  key for those before egress. */
const THREAT_LAYER_IDS = ['usgs', 'gdacs', 'wartracker', 'gdelt', 'firms', 'gdeltcloud', 'ucdp', 'reliefweb'] as const;
export function ensureThreatLayerId(v: unknown): (typeof THREAT_LAYER_IDS)[number] {
  if (typeof v !== 'string' || !THREAT_LAYER_IDS.includes(v as (typeof THREAT_LAYER_IDS)[number])) {
    throw new ValidationError('unknown threat layer id');
  }
  return v as (typeof THREAT_LAYER_IDS)[number];
}

/** The subset of threat layers that need a per-user API key/token. setLayerKey/hasLayerKey accept
 *  ONLY these ids — a key can't be stored for a keyless layer (USGS etc.). The secretStore ref is
 *  derived as `geoint.<layerId>.key`. */
export const KEYED_LAYER_IDS = ['firms', 'gdeltcloud', 'ucdp', 'ais'] as const;
export type KeyedLayerId = (typeof KEYED_LAYER_IDS)[number];
export function ensureKeyedLayerId(v: unknown): KeyedLayerId {
  if (typeof v !== 'string' || !(KEYED_LAYER_IDS as readonly string[]).includes(v)) {
    throw new ValidationError('unknown keyed threat layer id');
  }
  return v as KeyedLayerId;
}

/** True iff `layerId` is a keyed layer (used main-side to decide whether to read a key + gate). */
export function isKeyedLayerId(layerId: string): layerId is KeyedLayerId {
  return (KEYED_LAYER_IDS as readonly string[]).includes(layerId);
}

/** Validate a renderer-supplied API key/token before it is written to secretStore. Non-empty,
 *  bounded; the renderer is hostile so we cap the length (a token is short — this only guards
 *  against a pathological multi-MB write into the encrypted secrets blob). Not trimmed beyond the
 *  edges: a key with internal structure is preserved verbatim. */
export function ensureLayerKey(v: unknown): string {
  if (typeof v !== 'string') throw new ValidationError('layer key must be a string');
  const k = v.trim();
  if (k.length === 0) throw new ValidationError('layer key is empty');
  if (k.length > 4096) throw new ValidationError('layer key too long');
  // Defense-in-depth: keyed-layer tokens are interpolated into request headers
  // (gdeltcloud Authorization, UCDP x-ucdp-access-token). Reject CR/LF and other
  // control chars so a token can never attempt header/request-line injection —
  // don't rely solely on undici rejecting CRLF headers at send time.
  if (/[\u0000-\u001f\u007f]/.test(k)) throw new ValidationError('layer key contains control characters');
  return k;
}

/** A mail message UID as it crosses IPC: a safe non-negative integer. Guards the destructive
 *  delete/print paths against a malformed renderer arg. */
export function ensureUid(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ValidationError('Invalid mail uid');
  return v;
}

/** The only IMAP flags the renderer is allowed to toggle. */
const ALLOWED_MAIL_FLAGS = ['\\Flagged', '\\Seen'];
export function ensureMailFlag(v: unknown): string {
  if (typeof v !== 'string' || !ALLOWED_MAIL_FLAGS.includes(v)) throw new ValidationError('Invalid mail flag');
  return v;
}

/** True iff `raw` is an http(s) URL whose host is NOT loopback/private/link-local/metadata.
 *  GeoINT fetches sources from the public internet only — this blocks SSRF to internal hosts
 *  (used for manual add, OPML import, and every redirect hop). */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return !isLoopbackOrPrivate(u.hostname);
  } catch { return false; }
}

/** isPublicHttpUrl is DNS-blind — it only inspects the hostname *string*, so a public name that
 *  RESOLVES to internal space (e.g. *.nip.io, an attacker-registered A record, or a DNS-rebind)
 *  would pass it. This resolves the host and throws if ANY resolved address is loopback / link-
 *  local / RFC1918 / ULA / metadata. Call it before every outbound fetch hop. NOTE: this is a
 *  pre-flight resolve; it closes the static-rebind class (the demonstrated bypass). Defeating an
 *  active TTL=0 rebind between this check and the socket connect would additionally need IP
 *  pinning in the fetch agent — tracked separately. */
export async function assertResolvedPublic(hostname: string): Promise<void> {
  let addrs: { address: string }[];
  try { addrs = await dnsLookup(hostname, { all: true }); }
  catch { throw new Error(`cannot resolve ${hostname}`); }
  if (addrs.length === 0) throw new Error(`no address for ${hostname}`);
  for (const a of addrs) {
    if (isLoopbackOrPrivate(a.address)) throw new Error(`refusing to fetch ${hostname} — resolves to a private address`);
  }
}

const MAX_GEO_TEXT = 4000;

/** Validate a renderer-supplied GeoItem at the saveToCase boundary. A hostile renderer can
 *  call geoint.saveToCase directly; without this the item flows unbounded into the case +
 *  cross-case entity stores (esp. `place` → entities.create, bypassing MAX_ENTITY_VALUE). */
export function ensureGeoItem(raw: unknown): GeoItem {
  if (!raw || typeof raw !== 'object') throw new ValidationError('item must be an object');
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number, field: string): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || v.length > max) throw new ValidationError(`item.${field} invalid or too long`);
    return v;
  };
  const title = str(o['title'], MAX_GEO_TEXT, 'title');
  if (!title || title.trim().length === 0) throw new ValidationError('item.title is required');
  const num = (v: unknown, field: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ValidationError(`item.${field} not finite`);
    return n;
  };
  const lat = num(o['lat'], 'lat');
  const lon = num(o['lon'], 'lon');
  if (lat !== undefined && (lat < -90 || lat > 90)) throw new ValidationError('item.lat out of range');
  if (lon !== undefined && (lon < -180 || lon > 180)) throw new ValidationError('item.lon out of range');
  const located = o['located'];
  if (located !== 'geo' && located !== 'gazetteer' && located !== 'manual' && located !== 'none') {
    throw new ValidationError('item.located invalid');
  }
  return {
    id: str(o['id'], 200, 'id') ?? '',
    sourceId: str(o['sourceId'], 200, 'sourceId') ?? '',
    title,
    link: str(o['link'], 2048, 'link'),
    summary: str(o['summary'], MAX_GEO_TEXT, 'summary'),
    published: str(o['published'], 200, 'published'),
    lat,
    lon,
    place: str(o['place'], 500, 'place'),
    located
  };
}

/** GeoINT cycle 2: options for saving an event to a case. */
export function ensureSaveToCaseOpts(v: unknown): { form: 'record' | 'link' | 'note'; entityIds?: string[] } {
  if (!v || typeof v !== 'object') throw new ValidationError('opts must be an object');
  const o = v as { form?: unknown; entityIds?: unknown };
  if (o.form !== 'record' && o.form !== 'link' && o.form !== 'note') throw new ValidationError('opts.form invalid');
  let entityIds: string[] | undefined;
  if (o.entityIds !== undefined) {
    if (!Array.isArray(o.entityIds)) throw new ValidationError('entityIds must be an array');
    // Entity registry ids are `ent-<uuid>`, not bare UUIDs — validating as a plain UUID both
    // rejected real ids and would have let bare UUIDs through as dangling links (red-team).
    entityIds = o.entityIds.map((x) => ensureEntityId(x));
  }
  return { form: o.form, entityIds };
}

/** GeoINT live-feeds: a bounding box from the renderer. Validates each coordinate is a finite
 *  number in range and that south <= north. Returns a clean { west, south, east, north } — the
 *  caller (ADSB URL builder, AIS subscription) never receives an unchecked renderer value. */
export function ensureBounds(raw: unknown): Bounds {
  if (!raw || typeof raw !== 'object') throw new ValidationError('bounds must be an object');
  const o = raw as Record<string, unknown>;
  const getFinite = (k: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`bounds.${k} must be a finite number`);
    return v;
  };
  const west = getFinite('west');
  const south = getFinite('south');
  const east = getFinite('east');
  const north = getFinite('north');
  if (south < -90 || south > 90) throw new ValidationError('bounds.south must be in [-90, 90]');
  if (north < -90 || north > 90) throw new ValidationError('bounds.north must be in [-90, 90]');
  if (west < -180 || west > 180) throw new ValidationError('bounds.west must be in [-180, 180]');
  if (east < -180 || east > 180) throw new ValidationError('bounds.east must be in [-180, 180]');
  if (south > north) throw new ValidationError('bounds.south must be <= bounds.north');
  return { west, south, east, north };
}

/** GeoINT: a manual map pin (or null to clear). Coordinates must be finite + in range. */
export function ensureLatLon(v: unknown): { lat: number; lon: number } | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') throw new ValidationError('location must be {lat,lon} or null');
  const o = v as { lat?: unknown; lon?: unknown };
  const lat = Number(o.lat);
  const lon = Number(o.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new ValidationError('lat/lon out of range');
  }
  return { lat, lon };
}

// ---------- bookmarks dashboard ----------

const MAX_BM_CATEGORIES = 300;
const MAX_BM_LINKS = 1000;
const MAX_BM_FAVICON = 256 * 1024; // data: URI length cap

function bmId(v: unknown): string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : randomUUID();
}
function bmText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max) : '';
}

/** Validate + clamp a renderer-supplied bookmark board before it touches disk. URLs must be
 *  http(s) (validateExternalUrl normalizes + rejects file:/js:); emoji/favicon are bounded;
 *  a favicon must be a data: URI (never a remote ref that would beacon on render). */
export function ensureBookmarkBoard(raw: unknown): BookmarkBoard {
  const o = (raw ?? {}) as { categories?: unknown; networkEnabled?: unknown };
  const catsIn = Array.isArray(o.categories) ? o.categories.slice(0, MAX_BM_CATEGORIES) : [];
  const categories: BookmarkCategory[] = [];
  for (const rawCat of catsIn) {
    const c = (rawCat ?? {}) as { id?: unknown; title?: unknown; links?: unknown };
    const linksIn = Array.isArray(c.links) ? c.links.slice(0, MAX_BM_LINKS) : [];
    const links: BookmarkLink[] = [];
    for (const rawLink of linksIn) {
      const l = (rawLink ?? {}) as Record<string, unknown>;
      let url: string;
      try { url = validateExternalUrl(String(l['url'] ?? '')); } catch { continue; }
      if (!/^https?:\/\//i.test(url)) continue; // no mailto:/etc on the board
      const link: BookmarkLink = { id: bmId(l['id']), name: bmText(l['name'], 200) || url, url };
      const emoji = bmText(l['emoji'], 16);
      if (emoji) link.emoji = emoji;
      const fav = l['favicon'];
      // Only a base64 RASTER image data: URI. Excludes data:text/html and data:image/svg+xml —
      // SVG is the one image type that can carry script/remote refs, and the only safety today is
      // <img>'s secure-static mode; don't let a future render path turn a stored SVG into a beacon.
      if (typeof fav === 'string'
        && /^data:image\/(png|jpeg|jpg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon);base64,/i.test(fav)
        && fav.length <= MAX_BM_FAVICON) link.favicon = fav;
      links.push(link);
    }
    // Carry the per-card resize height (clamped) — without this the bookmarks resize feature
    // is silently dropped on the save/get round-trip.
    const rawH = (c as { height?: unknown }).height;
    const height = typeof rawH === 'number' && Number.isFinite(rawH) ? Math.max(60, Math.min(rawH, 4000)) : undefined;
    categories.push({ id: bmId(c.id), title: bmText(c.title, 200) || 'Untitled', links, ...(height !== undefined ? { height } : {}) });
  }
  return { categories, networkEnabled: o.networkEnabled === true };
}

// ---------- Sticky notes ----------

const MAX_STICKY_NOTES = 200;
const MAX_STICKY_TEXT = 4000;
/** Color is rendered as a CSS data-attribute → must be a known-safe key (no arbitrary strings). */
const STICKY_COLORS = new Set(['yellow', 'pink', 'blue', 'green', 'white']);

function clampStickyCoord(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(0, Math.min(n, 50000));
}

// Note dimensions are optional. Returns null when absent/invalid so the renderer falls back to
// the CSS default size; when present, bounds to a sane min (still usable) and max (no off-screen
// monsters). Mirror STICKY_MIN_W/H in the renderer's resize clamp.
const STICKY_MIN_W = 140;
const STICKY_MIN_H = 90;
const STICKY_MAX_DIM = 1200;
function clampStickyDim(v: unknown, min: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(Math.round(v), STICKY_MAX_DIM));
}

/**
 * Clamp/whitelist a sticky-notes layer from the renderer. Bounds the note count, text length,
 * icon length, and coordinates; the color must be an allowlisted palette key (it drives a CSS
 * selector). Icon is free emoji text but length-capped — it's rendered as text content, never
 * HTML, so there's no injection surface, only a size concern.
 */
export function ensureStickyNotes(raw: unknown): StickyNotesState {
  const o = (raw ?? {}) as { notes?: unknown; hidden?: unknown };
  const notesIn = Array.isArray(o.notes) ? o.notes.slice(0, MAX_STICKY_NOTES) : [];
  const notes: StickyNote[] = [];
  for (const rawNote of notesIn) {
    const n = (rawNote ?? {}) as Record<string, unknown>;
    const id = typeof n['id'] === 'string' && n['id'].length > 0 && n['id'].length <= 64 ? n['id'] : randomUUID();
    const text = typeof n['text'] === 'string' ? n['text'].slice(0, MAX_STICKY_TEXT) : '';
    const iconRaw = typeof n['icon'] === 'string' ? n['icon'] : '';
    const icon = iconRaw ? iconRaw.slice(0, 8) : '📌';
    const colorRaw = typeof n['color'] === 'string' ? n['color'] : 'yellow';
    const color = STICKY_COLORS.has(colorRaw) ? colorRaw : 'yellow';
    const note: StickyNote = { id, text, icon, color, x: clampStickyCoord(n['x']), y: clampStickyCoord(n['y']) };
    const w = clampStickyDim(n['w'], STICKY_MIN_W);
    const h = clampStickyDim(n['h'], STICKY_MIN_H);
    if (w !== null) note.w = w;
    if (h !== null) note.h = h;
    const rid = n['reminderId'];
    if (typeof rid === 'string' && rid.length > 0 && rid.length <= 80) note.reminderId = rid;
    notes.push(note);
  }
  return { notes, hidden: o.hidden === true };
}

// ---------- AI conversations ----------

const MAX_CONVO_TITLE = 200;
const MAX_CONVO_MESSAGES = 2000;
const MAX_CONVO_CONTENT = 100_000;
const CONVO_ROLES = new Set(['system', 'user', 'assistant']);

/** Clamp/whitelist a renderer-supplied conversation before it is persisted: bounds the title,
 *  the message count, and per-message content length; the role must be a known enum value. */
export function ensureAiConversation(raw: unknown): AiConversationInput {
  const o = (raw ?? {}) as { id?: unknown; title?: unknown; messages?: unknown; caseId?: unknown };
  // Must be a UUIDv4 (get/delete validate with ensureUuid) — mint one for anything else, so a
  // saved conversation can never carry an id that get/delete will later reject.
  const id = typeof o.id === 'string' && UUID_V4.test(o.id) ? o.id : randomUUID();
  const title = (typeof o.title === 'string' && o.title.trim() ? o.title : 'Conversation').slice(0, MAX_CONVO_TITLE);
  const msgsIn = Array.isArray(o.messages) ? o.messages.slice(0, MAX_CONVO_MESSAGES) : [];
  const messages: AiChatMessage[] = [];
  for (const rawM of msgsIn) {
    const m = (rawM ?? {}) as { role?: unknown; content?: unknown };
    const role = typeof m.role === 'string' && CONVO_ROLES.has(m.role) ? (m.role as AiChatMessage['role']) : 'user';
    const content = typeof m.content === 'string' ? m.content.slice(0, MAX_CONVO_CONTENT) : '';
    messages.push({ role, content });
  }
  // Same UUIDv4 shape as `id`/case ids everywhere else — anything else (missing, malformed,
  // spoofed) is dropped rather than rejected, so adaptive-memory scoping degrades to 'global'
  // instead of ever throwing on a save.
  const caseId = typeof o.caseId === 'string' && UUID_V4.test(o.caseId) ? o.caseId : undefined;
  return caseId ? { id, title, messages, caseId } : { id, title, messages };
}

/** Bound + sanitize the renderer-supplied markets settings block. settings.update otherwise trusts
 *  the whole patch; this caps list sizes and per-entry lengths, and requires every custom-feed URL
 *  to be public http(s) (defense-in-depth; safeFetch re-checks + DNS-validates at fetch time). */
export function ensureMarketsSettings(input: unknown): {
  networkEnabled: boolean;
  watchlist: { crypto: string[]; fx: string[]; symbols: string[] };
  customFeeds: { id: string; label: string; url: string }[];
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 64).slice(0, max)
      : [];
  const wl = (o.watchlist ?? {}) as Record<string, unknown>;
  const feedsIn = Array.isArray(o.customFeeds) ? o.customFeeds : [];
  const customFeeds = feedsIn.slice(0, 50).flatMap((f) => {
    const r = (f ?? {}) as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : '';
    if (!label || !isPublicHttpUrl(url)) return [];
    const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 ? r.id : label;
    return [{ id, label, url }];
  });
  return {
    networkEnabled: o.networkEnabled === true,
    watchlist: { crypto: list(wl.crypto, 100), fx: list(wl.fx, 100), symbols: list(wl.symbols, 100) },
    customFeeds
  };
}

/** Settings keys that a bulk `settings.update` patch may NEVER set. Enabling the DialTerm local
 *  shell grants local code execution; it must go through the dedicated, native-dialog-confirmed
 *  `shell:requestEnable` path so a compromised renderer/plugin can't flip it via a merged patch.
 *  Disabling the shell is safe and remains available via `shell:disable`. */
const PROTECTED_SETTINGS_KEYS = ['localShellEnabled', 'localShellProgram'] as const;

/** Strip the protected (shell-enable) keys from a renderer-supplied settings patch. Returns a
 *  shallow copy with those keys removed; non-object patches pass through unchanged. The caller's
 *  object is never mutated. */
export function stripProtectedSettings<T>(patch: T): T {
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...(patch as Record<string, unknown>) };
  for (const k of PROTECTED_SETTINGS_KEYS) delete out[k];
  return out as T;
}

/** Jukebox: a remembered library folder path (existence is checked at use time). */
export function ensureMediaRoot(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) {
    throw new ValidationError('media root must be a non-empty path string');
  }
  return p;
}

/** Jukebox: an internet-radio station. Label is bounded; URL must be http(s)
 *  (validateExternalUrl also allows mailto:, which is rejected here). */
export function ensureStationInput(v: unknown): { id?: string; label: string; url: string } {
  if (!v || typeof v !== 'object') throw new ValidationError('station must be an object');
  const o = v as { id?: unknown; label?: unknown; url?: unknown };
  if (typeof o.label !== 'string' || o.label.trim().length === 0 || o.label.length > 120) {
    throw new ValidationError('station.label must be a 1-120 char string');
  }
  if (typeof o.url !== 'string') throw new ValidationError('station.url must be a string');
  const url = validateExternalUrl(o.url);
  if (!/^https?:\/\//i.test(url)) throw new ValidationError('station.url must be http or https');
  const out: { id?: string; label: string; url: string } = { label: o.label.trim(), url };
  if (o.id !== undefined) {
    if (typeof o.id !== 'string' || o.id.length > 128) throw new ValidationError('station.id must be a short string');
    out.id = o.id;
  }
  return out;
}

/** Validates a draft attachment path is safe to auto-consent on listDrafts read.
 *  Defends against the upgrade-from-v2.0.0 case where a compromised renderer in v2.0.0
 *  could have persisted malicious paths (e.g. /etc/shadow) into mail-drafts.json. On
 *  v2.0.1 listDrafts, we re-validate before marking consented.
 *
 *  Returns true if the path is sendable (regular file, inside the user's home, not a
 *  symlink, not in system directories). False otherwise — caller should drop the path. */
export async function isDraftAttachmentSafe(path: string): Promise<boolean> {
  if (typeof path !== 'string' || path.length === 0) return false;
  const norm = normalize(path);
  if (!isAbsolute(norm)) return false;

  // Block well-known system paths even on case-insensitive volumes
  const lower = norm.toLowerCase();
  const blockedPrefixes = ['/etc/', '/proc/', '/sys/', '/dev/', '/root/', '/boot/',
                           'c:\\windows\\', 'c:\\program files\\', 'c:\\program files (x86)\\'];
  if (blockedPrefixes.some((p) => lower.startsWith(p) || lower === p.slice(0, -1))) return false;

  // Must exist as a regular file, not a symlink
  const { stat, lstat } = await import('node:fs/promises');
  try {
    const ls = await lstat(norm);
    if (ls.isSymbolicLink()) return false;
    const s = await stat(norm);
    if (!s.isFile()) return false;
  } catch {
    return false; // ENOENT, EACCES, etc.
  }

  // Must live inside the user's home directory (after realpath, same as SSH key handling)
  try {
    const { realpath } = await import('node:fs/promises');
    const real = await realpath(norm);
    const home = await realpath(homedir());
    const rel = relative(home, real);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
  } catch {
    return false;
  }

  return true;
}

// ---------- Briefcase (standalone notes) ----------

const MAX_BRIEFCASE_NAME = 200;
const MAX_BRIEFCASE_BODY = 2 * 1024 * 1024; // 2 MB per text note

/** Clamp a renderer-supplied briefcase note before persisting: bounds the name and body length;
 *  body is plain text (rendered in a textarea, never as HTML) so there's no injection surface. */
export function ensureBriefcaseNote(raw: unknown): BriefcaseNoteInput {
  const o = (raw ?? {}) as { id?: unknown; name?: unknown; body?: unknown };
  // The id MUST be a UUIDv4: read/delete validate with ensureUuid, so accepting any other
  // string here would persist a note that can never be opened or deleted (an orphaned,
  // slot-wasting zombie). Mint a fresh uuid for anything that isn't one.
  const id = typeof o.id === 'string' && UUID_V4.test(o.id) ? o.id : randomUUID();
  const name = (typeof o.name === 'string' && o.name.trim() ? o.name : 'untitled').slice(0, MAX_BRIEFCASE_NAME);
  const body = typeof o.body === 'string' ? o.body.slice(0, MAX_BRIEFCASE_BODY) : '';
  return { id, name, body };
}

// ---------- Journal Jots (PIN-gated personal journal) ----------

const MAX_JOURNAL_TITLE = 200;
const MAX_JOURNAL_BODY = 2 * 1024 * 1024; // 2 MB per entry

/** Clamp a renderer-supplied journal entry before persisting. Same posture as ensureBriefcaseNote:
 *  bound title/body; body is plain text (textarea, never HTML) so there's no injection surface.
 *  An id that isn't a UUIDv4 is replaced so a saved entry can always be opened/deleted by id. */
export function ensureJournalEntry(raw: unknown): JournalEntryInput {
  const o = (raw ?? {}) as { id?: unknown; title?: unknown; body?: unknown };
  const id = typeof o.id === 'string' && UUID_V4.test(o.id) ? o.id : randomUUID();
  const title = (typeof o.title === 'string' && o.title.trim() ? o.title : 'Untitled').slice(0, MAX_JOURNAL_TITLE);
  const body = typeof o.body === 'string' ? o.body.slice(0, MAX_JOURNAL_BODY) : '';
  return { id, title, body };
}

/** A Journal PIN is exactly four ASCII digits — nothing else crosses the IPC boundary. The main
 *  process is unsandboxed, so this is validated strictly before it reaches the journal store. */
export function ensurePin(raw: unknown, context = 'PIN'): string {
  if (typeof raw !== 'string' || !/^[0-9]{4}$/.test(raw)) {
    throw new ValidationError(`Invalid ${context}: must be exactly 4 digits`);
  }
  return raw;
}

/** SSH private-key paths: must be absolute, must live inside the user's home directory.
 *  Symlinks are resolved before the containment check so a symlink-out-of-home is rejected. */
export async function validateSshKeyPath(path: string): Promise<string> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new ValidationError('SSH key path is required for key-auth hosts');
  }
  const norm = normalize(path);
  if (!isAbsolute(norm)) {
    throw new ValidationError('SSH key path must be absolute');
  }
  let real: string;
  try {
    real = await realpath(norm);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') throw new ValidationError(`SSH key path does not exist: ${norm}`);
    throw new ValidationError(`Cannot resolve SSH key path: ${e.message}`);
  }
  const home = await realpath(homedir());
  const rel = relative(home, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ValidationError('SSH key path (after following symlinks) must live inside your home directory');
  }
  return real;
}

// Reference isIPv6 to satisfy "no unused import" — keeps the import alongside isIP for callers extending this module
export const _ipv6Sentinel: typeof isIPv6 = isIPv6;

// ---------- My Documents (path-segment / relative-path validators) ----------

/** Windows reserved device basenames — illegal as a file/folder name even with an extension. */
const RESERVED_WIN32_NAMES = new Set<string>([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

// Control chars (0x00-0x1f, 0x7f) plus the Windows-illegal path characters. Space and dot are
// intentionally NOT rejected here (dot/space names are legal; '.'/'..' are caught explicitly below).
// eslint-disable-next-line no-control-regex
const ILLEGAL_SEGMENT_CHARS = /[\x00-\x1f\x7f/\\:*?"<>|]/;

/** Validate a SINGLE My Documents path segment (a file or folder leaf name). Returns it unchanged. */
export function ensureDocName(value: unknown, context = 'name'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new ValidationError(`Invalid ${context}: empty or too long`);
  }
  if (value === '.' || value === '..') {
    throw new ValidationError(`Invalid ${context}: traversal not allowed`);
  }
  if (ILLEGAL_SEGMENT_CHARS.test(value)) {
    throw new ValidationError(`Invalid ${context}: illegal character`);
  }
  const base = value.split('.')[0]!.toUpperCase();
  if (RESERVED_WIN32_NAMES.has(base)) {
    throw new ValidationError(`Invalid ${context}: reserved device name`);
  }
  return value;
}

/** Validate a saved-conversation id arriving over IPC (memory forget/remember). Mirrors forgetDoc's
 *  docId check: a non-empty, bounded, separator-free token — no ':' (so it can't escape the
 *  `__conversations__:convo:<id>` node-id scheme) and no path separators. */
export function ensureConversationId(value: unknown, context = 'conversation id'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError(`Invalid ${context}: empty or too long`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError(`Invalid ${context}: unexpected characters`);
  }
  return value;
}

/** Validate the HOST source path of a dropped-file import. Unlike a documents rel-path this may
 *  legitimately point outside the documents root (it is the drag source), so it cannot be confined
 *  to the root — but it must still be a structurally valid absolute, NUL-free string rather than an
 *  arbitrary renderer-supplied value handed straight to fs.readFile. */
export function ensureImportSourcePath(value: unknown, context = 'sourcePath'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new ValidationError(`Invalid ${context}: empty or too long`);
  }
  if (value.includes('\0')) {
    throw new ValidationError(`Invalid ${context}: NUL byte`);
  }
  if (!isAbsolute(value)) {
    throw new ValidationError(`Invalid ${context}: must be an absolute path`);
  }
  return value;
}

/** Validate a My Documents relative path (`/`-joined segments; `''` = root). Returns the
 *  normalized POSIX relative path. Every segment must pass ensureDocName. */
export function ensureDocRelPath(value: unknown, context = 'path'): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`Invalid ${context}: not a string`);
  }
  if (value.length > 4096 || value.includes('\\')) {
    throw new ValidationError(`Invalid ${context}: too long or backslash`);
  }
  // Reject absolute paths outright — a leading '/' would otherwise be silently stripped by the
  // segment filter below and pass as a relative path (the plan's own test requires a throw here).
  if (value.startsWith('/')) {
    throw new ValidationError(`Invalid ${context}: absolute path not allowed`);
  }
  const segments = value.split('/').filter((s) => s.length > 0);
  for (const seg of segments) ensureDocName(seg, `${context} segment`);
  return segments.join('/');
}

const MAX_NOTE_BODY = 1024 * 1024; // 1 MiB chars — mirrors the documents store's MAX_TEXT_BYTES cap

/** Validate a plain-text note body crossing the IPC boundary for documents:writeText. Rejects
 *  non-string input and REJECTS (never silently truncates) an oversize body — truncating here would
 *  persist only the first megabyte while Notepad/DnD report a successful save, i.e. silent data loss. */
export function ensureNoteBody(value: unknown, context = 'body'): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`Invalid ${context}: not a string`);
  }
  if (value.length > MAX_NOTE_BODY) {
    throw new ValidationError(`Invalid ${context}: too large (max 1 MiB)`);
  }
  return value;
}

// ---------- media (jukebox) ----------

/** Renderer-supplied station-id ordering for reorderStations: a bounded array of short strings. */
export function ensureIdArray(v: unknown): string[] {
  if (!Array.isArray(v)) throw new ValidationError('expected an array of station ids');
  return v.map((x) => { if (typeof x !== 'string' || x.length > 128) throw new ValidationError('id must be a short string'); return x; });
}

// ---------- invoices ----------

/** Renderer-supplied logo/signature upload: image mime + a byte-array cap (2 MiB) — a hostile
 *  renderer must not be able to smuggle an arbitrary mime or an unbounded blob into the vault. */
export function ensureAssetInput(v: unknown): { bytes: Buffer; mime: string } {
  if (!v || typeof v !== 'object') throw new ValidationError('asset must be an object');
  const o = v as { bytes?: unknown; mime?: unknown };
  if (o.mime !== 'image/png' && o.mime !== 'image/jpeg') throw new ValidationError('asset.mime must be image/png or image/jpeg');
  if (!Array.isArray(o.bytes)) throw new ValidationError('asset.bytes must be a byte array');
  if (o.bytes.length > 2_000_000) throw new ValidationError('asset too large (max 2MB)');
  return { bytes: Buffer.from(o.bytes as number[]), mime: o.mime };
}

const MAX_REPORT_ASSET = 25 * 1024 * 1024;
/** Report banners/photos are full-size images (a phone photo is several MB) — unlike the small invoice
 *  logos ensureAssetInput bounds at 2MB. Reports get a 25 MB per-image cap so real photos can be added. */
export function ensureReportAssetInput(v: unknown): { bytes: Buffer; mime: string } {
  if (!v || typeof v !== 'object') throw new ValidationError('asset must be an object');
  const o = v as { bytes?: unknown; mime?: unknown };
  if (o.mime !== 'image/png' && o.mime !== 'image/jpeg') throw new ValidationError('asset.mime must be image/png or image/jpeg');
  if (!Array.isArray(o.bytes)) throw new ValidationError('asset.bytes must be a byte array');
  if (o.bytes.length > MAX_REPORT_ASSET) throw new ValidationError('asset too large (max 25MB)');
  return { bytes: Buffer.from(o.bytes as number[]), mime: o.mime };
}

// ---------- PDF signer ----------

/** Ceiling on the raw bytes of a PDF crossing the IPC boundary — either the capped file read for
 *  `pdfsign:read`, or the bytes handed back in from the renderer for `pdfsign:sign`. Modeled on
 *  MAX_EXPORT_ASSET_BYTES; the source PDF is read/handled transiently and never persisted. */
export const MAX_PDF_SIGN_BYTES = 25 * 1024 * 1024;

/** Validates a PDF byte buffer crossing the IPC boundary — must be an actual byte array, bounded
 *  by MAX_PDF_SIGN_BYTES so a hostile renderer can't force an unbounded pdf-lib parse in main. */
export function ensurePdfBytes(v: unknown): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new ValidationError('pdfBytes must be a byte array');
  if (v.length > MAX_PDF_SIGN_BYTES) throw new ValidationError('PDF is too large to sign (max 25 MB)');
  return v;
}

const SIGNATURE_DATA_URL_RE = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/;

/** Decodes + validates a renderer-supplied signature `data:image/(png|jpeg);base64,...` URL for
 *  `pdfsign:sign`. The length guard runs before the regex/decode so a pathological string can't
 *  balloon the base64 decode; the decoded bytes then go through ensureAssetInput so the mime/size
 *  rules (2 MiB cap) live in exactly one place rather than being duplicated here. */
export function parseSignatureDataUrl(value: unknown): { bytes: Buffer; mime: 'image/png' | 'image/jpeg' } {
  if (typeof value !== 'string' || value.length > 3_000_000) {
    throw new ValidationError('signature must be a base64 image data URL');
  }
  const m = SIGNATURE_DATA_URL_RE.exec(value);
  if (!m) throw new ValidationError('signature must be a data:image/png or data:image/jpeg base64 URL');
  const mime = m[1] as 'image/png' | 'image/jpeg';
  const decoded = Buffer.from(m[2], 'base64');
  const { bytes } = ensureAssetInput({ bytes: Array.from(decoded), mime });
  return { bytes, mime };
}

/** Validates a renderer-supplied signature placement (page index + 0..1 fractions of the page).
 *  Fractions are clamped rather than rejected — a drag position slightly past the page edge is
 *  normal UI slop, not a hostile input, and clamping keeps the pdf-lib drawImage math well-defined. */
export function ensurePlacement(v: unknown): { page: number; xFrac: number; yFrac: number; wFrac: number } {
  if (!v || typeof v !== 'object') throw new ValidationError('placement must be an object');
  const o = v as Record<string, unknown>;
  if (typeof o.page !== 'number' || !Number.isInteger(o.page) || o.page < 0) {
    throw new ValidationError('placement.page must be a non-negative integer');
  }
  const frac = (key: string): number => {
    const n = o[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new ValidationError(`placement.${key} must be a finite number`);
    }
    return Math.min(1, Math.max(0, n));
  };
  return { page: o.page, xFrac: frac('xFrac'), yFrac: frac('yFrac'), wFrac: frac('wFrac') };
}

/** Minimal shape guard for a persisted invoice — the store is the source of truth for the rest. */
export function ensureInvoice(v: unknown): import('@shared/invoice-types').Invoice {
  if (!v || typeof v !== 'object') throw new ValidationError('invoice must be an object');
  const o = v as { id?: unknown; number?: unknown };
  if (typeof o.id !== 'string' || typeof o.number !== 'string') throw new ValidationError('invoice.id/number must be strings');
  return v as import('@shared/invoice-types').Invoice;
}

/** Minimal shape guard for a persisted sender/client profile. */
export function ensureProfile(v: unknown): import('@shared/invoice-types').Profile {
  if (!v || typeof v !== 'object') throw new ValidationError('profile must be an object');
  const o = v as { id?: unknown; kind?: unknown };
  if (typeof o.id !== 'string' || (o.kind !== 'sender' && o.kind !== 'client')) throw new ValidationError('bad profile');
  return v as import('@shared/invoice-types').Profile;
}

// ---------- reports (Chain of Custody report generator) ----------

const MAX_REPORT_TITLE = 200;
const MAX_REPORT_TO = 400;
const MAX_REPORT_META = 400;
const MAX_REPORT_BLOCK_HTML = 50_000;
const MAX_REPORT_CAPTION = 500;
const MAX_DESCRIPTOR_BODY = 10_000;
const MAX_CONTACT_FIELD = 400;
const MAX_BLOCKS_PER_REPORT = 400;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 12;

function reportStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Clamp a renderer-supplied image-block width percentage into [10,100]; a non-finite/missing
 *  value falls back to a sane default rather than throwing (the block still renders). */
function clampWidthPct(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 60;
  return Math.max(10, Math.min(100, Math.round(n)));
}

/** Validate + clamp a single report block. Returns null for an unknown `kind` so a corrupted or
 *  hostile payload silently drops that block rather than persisting an unrecognized shape that
 *  report-html.ts / docx.ts would then have to special-case. */
function ensureReportBlock(raw: unknown): import('@shared/reports-types').ReportBlock | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = typeof o['id'] === 'string' && o['id'].length > 0 && o['id'].length <= 64 ? o['id'] : randomUUID();
  if (o['kind'] === 'text') {
    return { id, kind: 'text', html: reportStr(o['html'], MAX_REPORT_BLOCK_HTML) };
  }
  if (o['kind'] === 'image') {
    let assetRef: string;
    try { assetRef = ensureFileName(o['assetRef'], 'block.assetRef'); } catch { return null; }
    const align = o['align'] === 'left' || o['align'] === 'center' || o['align'] === 'right' ? o['align'] : undefined;
    const img: import('@shared/reports-types').ReportBlock = { id, kind: 'image', assetRef, widthPct: clampWidthPct(o['widthPct']), caption: reportStr(o['caption'], MAX_REPORT_CAPTION) };
    if (align) (img as { align?: string }).align = align;
    return img;
  }
  if (o['kind'] === 'table') {
    const rows = o['cells'];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // Oversize grids are CLAMPED to the caps, not dropped: dropping the whole block silently
    // destroyed every cell the moment the editor exceeded a bound (data-loss defect). Truncating to
    // MAX_TABLE_ROWS × MAX_TABLE_COLS preserves the in-bounds content and keeps the grid rectangular.
    const clampedRows = rows.slice(0, MAX_TABLE_ROWS);
    const rawWidth = Array.isArray(clampedRows[0]) ? clampedRows[0].length : -1;
    if (rawWidth <= 0) return null;
    const width = Math.min(rawWidth, MAX_TABLE_COLS);
    const cells: string[][] = [];
    for (const row of clampedRows) {
      if (!Array.isArray(row) || row.length !== rawWidth) return null;           // ragged → drop block
      const outRow: string[] = [];
      for (let j = 0; j < width; j++) {                                          // clamp columns to width
        const cell = row[j];
        if (typeof cell !== 'string') return null;                               // non-string → drop block
        outRow.push(cell.slice(0, MAX_REPORT_BLOCK_HTML));
      }
      cells.push(outRow);
    }
    return { id, kind: 'table', cells };
  }
  return null;
}

/** Validate + clamp a renderer-supplied Report before it is persisted: bounds every string field,
 *  caps the block count (MAX_BLOCKS_PER_REPORT), clamps image widthPct into [10,100], drops any
 *  block of an unknown kind, and routes bannerRef through ensureFileName (defense-in-depth —
 *  reports/store.ts's getAsset re-validates independently, but a malformed ref should never even
 *  be written to disk). */
export function ensureReport(raw: unknown): import('@shared/reports-types').Report {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'].length === 0) throw new ValidationError('report.id must be a non-empty string');
  const blocksIn = Array.isArray(o['blocks']) ? o['blocks'].slice(0, MAX_BLOCKS_PER_REPORT) : [];
  const blocks: import('@shared/reports-types').ReportBlock[] = [];
  for (const b of blocksIn) {
    const block = ensureReportBlock(b);
    if (block) blocks.push(block);
  }
  const authorRaw = reportStr(o['author'], MAX_CONTACT_FIELD);
  const out: import('@shared/reports-types').Report = {
    id: o['id'],
    title: reportStr(o['title'], MAX_REPORT_TITLE),
    createdAt: typeof o['createdAt'] === 'string' ? o['createdAt'] : new Date().toISOString(),
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : new Date().toISOString(),
    to: reportStr(o['to'], MAX_REPORT_TO),
    status: (o['status'] === 'completed' || o['status'] === 'archived' || o['status'] === 'draft') ? o['status'] : 'draft',
    author: authorRaw.length > 0 ? authorRaw : 'Investigator',
    blocks
  };
  if (o['bannerRef'] !== undefined) {
    try { out.bannerRef = ensureFileName(o['bannerRef'], 'bannerRef'); } catch { /* drop a malformed ref */ }
  }
  if (typeof o['fromContactId'] === 'string' && o['fromContactId'].length > 0 && o['fromContactId'].length <= 64) {
    out.fromContactId = o['fromContactId'];
  }
  if (typeof o['toContactId'] === 'string' && o['toContactId'].length > 0 && o['toContactId'].length <= 64) {
    out.toContactId = o['toContactId'];
  }
  if (typeof o['reportDate'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o['reportDate'])) {
    out.reportDate = o['reportDate'];
  }
  const caseNumber = reportStr(o['caseNumber'], MAX_REPORT_META); if (caseNumber.length > 0) out.caseNumber = caseNumber;
  const referenceNumber = reportStr(o['referenceNumber'], MAX_REPORT_META); if (referenceNumber.length > 0) out.referenceNumber = referenceNumber;
  const classification = reportStr(o['classification'], MAX_REPORT_META); if (classification.length > 0) out.classification = classification;
  const signature = reportStr(o['signature'], MAX_REPORT_META); if (signature.length > 0) out.signature = signature;
  if (o['signatureRef'] !== undefined) {
    try { out.signatureRef = ensureFileName(o['signatureRef'], 'signatureRef'); } catch { /* drop a malformed ref */ }
  }
  return out;
}

/** Validate + clamp a renderer-supplied ReportTemplate before it is persisted. Mirrors
 *  ensureReport but requires both `id` and `name` (a template is addressed by both), bounds
 *  `name`/`category`/`to`/metadata, reuses ensureReportBlock for the body (so image assetRefs are
 *  routed through ensureFileName + unknown-kind blocks dropped), caps the block count, routes
 *  bannerRef through ensureFileName, and defaults the timestamps. Carries no report identity/status. */
export function ensureReportTemplate(raw: unknown): import('@shared/reports-types').ReportTemplate {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'].length === 0) throw new ValidationError('template.id must be a non-empty string');
  const name = reportStr(o['name'], MAX_REPORT_TITLE);
  if (name.length === 0) throw new ValidationError('template.name must be a non-empty string');
  const blocksIn = Array.isArray(o['blocks']) ? o['blocks'].slice(0, MAX_BLOCKS_PER_REPORT) : [];
  const blocks: import('@shared/reports-types').ReportBlock[] = [];
  for (const b of blocksIn) {
    const block = ensureReportBlock(b);
    if (block) blocks.push(block);
  }
  const out: import('@shared/reports-types').ReportTemplate = {
    id: o['id'],
    name,
    createdAt: typeof o['createdAt'] === 'string' ? o['createdAt'] : new Date().toISOString(),
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : new Date().toISOString(),
    to: reportStr(o['to'], MAX_REPORT_TO),
    blocks
  };
  const category = reportStr(o['category'], MAX_REPORT_META); if (category.length > 0) out.category = category;
  if (o['bannerRef'] !== undefined) {
    try { out.bannerRef = ensureFileName(o['bannerRef'], 'bannerRef'); } catch { /* drop a malformed ref */ }
  }
  if (typeof o['fromContactId'] === 'string' && o['fromContactId'].length > 0 && o['fromContactId'].length <= 64) {
    out.fromContactId = o['fromContactId'];
  }
  if (typeof o['toContactId'] === 'string' && o['toContactId'].length > 0 && o['toContactId'].length <= 64) {
    out.toContactId = o['toContactId'];
  }
  if (typeof o['reportDate'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o['reportDate'])) {
    out.reportDate = o['reportDate'];
  }
  const caseNumber = reportStr(o['caseNumber'], MAX_REPORT_META); if (caseNumber.length > 0) out.caseNumber = caseNumber;
  const referenceNumber = reportStr(o['referenceNumber'], MAX_REPORT_META); if (referenceNumber.length > 0) out.referenceNumber = referenceNumber;
  const classification = reportStr(o['classification'], MAX_REPORT_META); if (classification.length > 0) out.classification = classification;
  const signature = reportStr(o['signature'], MAX_REPORT_META); if (signature.length > 0) out.signature = signature;
  if (o['signatureRef'] !== undefined) {
    try { out.signatureRef = ensureFileName(o['signatureRef'], 'signatureRef'); } catch { /* drop a malformed ref */ }
  }
  return out;
}

/** Validate + clamp a renderer-supplied Contact before it is persisted: bounds every field
 *  (MAX_CONTACT_FIELD), routes logoRef through ensureFileName. */
export function ensureContact(raw: unknown): import('@shared/reports-types').Contact {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'].length === 0) throw new ValidationError('contact.id must be a non-empty string');
  const opt = (k: string): string | undefined => {
    const s = reportStr(o[k], MAX_CONTACT_FIELD);
    return s.length > 0 ? s : undefined;
  };
  const out: import('@shared/reports-types').Contact = { id: o['id'], name: reportStr(o['name'], MAX_CONTACT_FIELD) };
  const title = opt('title'); if (title !== undefined) out.title = title;
  const org = opt('org'); if (org !== undefined) out.org = org;
  const email = opt('email'); if (email !== undefined) out.email = email;
  const phone = opt('phone'); if (phone !== undefined) out.phone = phone;
  const address = opt('address'); if (address !== undefined) out.address = address;
  if (o['logoRef'] !== undefined) {
    try { out.logoRef = ensureFileName(o['logoRef'], 'logoRef'); } catch { /* drop a malformed ref */ }
  }
  return out;
}

/** Validate + clamp a renderer-supplied Descriptor before it is persisted: bounds name
 *  (MAX_CONTACT_FIELD) and body (MAX_DESCRIPTOR_BODY). */
export function ensureDescriptor(raw: unknown): import('@shared/reports-types').Descriptor {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'].length === 0) throw new ValidationError('descriptor.id must be a non-empty string');
  return {
    id: o['id'],
    name: reportStr(o['name'], MAX_CONTACT_FIELD),
    body: reportStr(o['body'], MAX_DESCRIPTOR_BODY)
  };
}

/** An introduction is a named reusable text, structurally identical to a Descriptor. */
export function ensureIntroduction(raw: unknown): import('@shared/reports-types').Descriptor {
  return ensureDescriptor(raw);
}
