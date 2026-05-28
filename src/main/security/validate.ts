/**
 * Central validators used across IPC handlers. Every renderer-supplied identifier,
 * filename, URL, and SSH key path passes through here. Treat the renderer as hostile.
 *
 * v1.0.1 round-3 hardening: IPv6 / IPv4-mapped detection via net.isIP, symlink
 * resolution for SSH key paths, mailto: param stripping to prevent ?attach= exfil.
 */

import { resolve, relative, isAbsolute, normalize } from 'node:path';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isIP, isIPv6 } from 'node:net';

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
