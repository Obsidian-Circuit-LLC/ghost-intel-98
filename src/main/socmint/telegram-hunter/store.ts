/**
 * Task TF2 — Telegram Hunter per-tool artifact stores + path-traversal-guarded
 * Telegram Desktop export import.
 *
 * The Telegram capture engine (Plan B) normalizes visible messages/profiles into
 * the shared encrypted case store as `HarvestedItem`s (socmint namespace). This
 * module holds the Telegram-specific artifact stores the source kept in
 * plaintext JSON, ported onto the app's encrypt-at-rest layer:
 *
 *   - members       — visible group/channel member intelligence (honest: no total)
 *   - profiles      — captured visible user-profile panels (honest: no creation date)
 *   - keywordWatch  — literal keyword-watch terms (LITERAL match; no RegExp compiled)
 *   - imports       — imported Telegram Desktop export sets
 *   - dedup         — a dedup index of seen item keys
 *
 * Plus `parseTelegramExport` — a hardened port of the source's `parseJsonExport`
 * that resolves every media path through `confineImportPath` (Plan A), DROPPING
 * any media that escapes the chosen root (closes the source's LFI).
 *
 * Public API:
 *   makeTgHunterStore(deps)  — pure factory over an injected fs seam; use in tests.
 *   parseTelegramExport(root, json) — pure import parser; use in tests.
 *   prodTgHunterStore()      — production-wired singleton (secure-fs + real paths,
 *                              ensureUuid caseId), lazy so importing never pulls in
 *                              electron at import time.
 *
 * Encrypt-at-rest: the production factory routes every read/write through secure-fs
 * (never the plaintext json-fs bypass — Global Constraints).
 *
 * Determinism: order is append order (a pure function of the write sequence), never
 * readdir iteration order or a clock; the caller supplies every timestamp.
 *
 * CLEARNET/TOR NOTE: this module imports only `node:path` and (lazily, in prod)
 * paths/secure-fs/validate. It pulls in NOTHING from bgconn/Tor — the Telegram
 * capture window (`session.ts`) owns the Tor gate; the store is pure persistence.
 */

import { confineImportPath } from '../../capture/security';
import { withLock } from '../../util/mutex';
import type { TgProfile } from './extract';

// ---- artifact record shapes --------------------------------------------

/** One visible group/channel member. Every field beyond `handle`/`capturedAt` is
 *  OPTIONAL and present ONLY when the value was actually visible (honesty):
 *   - `displayName` is omitted when no display name was shown — NEVER backfilled from the @handle;
 *   - `phone` is stored ONLY when the logged-in account could see it;
 *   - `avatar`, when present, is a local `data:` thumbnail — a remote URL must never be stored here;
 *   - `profileUrl`, when present, is a Telegram-host-guarded permalink.
 *  There is NO member-total field: Telegram hides the real subscriber/member count, and this
 *  store never fabricates one — only the members actually collected are persisted. */
export interface TgMember {
  handle: string;
  displayName?: string;
  /** Visible phone — present ONLY when shown to this account; never inferred. */
  phone?: string;
  /** Visible status/role line (e.g. "admin · online", "last seen recently"). */
  status?: string;
  /** Local `data:` avatar thumbnail — data: only, never a remote URL. */
  avatar?: string;
  /** Telegram-host-guarded profile permalink, when visible. */
  profileUrl?: string;
  /** Where the member was seen (group/channel label) — visible context, optional. */
  context?: string;
  /** ISO timestamp supplied by the caller (injected clock) — never computed here. */
  capturedAt: string;
}

/** One keyword-watch rule. `term` is matched LITERALLY at watch time (no `new RegExp` on
 *  untrusted input — ReDoS/injection); the store persists the term plus its match options
 *  so a saved watch matches the way it was defined (ported from the source rule shape). */
export interface TgKeywordRule {
  term: string;
  /** ISO timestamp supplied by the caller (injected clock). */
  addedAt: string;
  /** When true, the literal match is case-sensitive; default (absent) is case-insensitive. */
  caseSensitive?: boolean;
  /** When true or absent, the term matches as an exact phrase (one literal `.includes`);
   *  when false, the term matches when ALL of its words appear (each literally). */
  exactPhrase?: boolean;
}

/** The literal-match options for a keyword rule (everything but the persisted term/clock). */
export type TgKeywordOptions = Pick<TgKeywordRule, 'caseSensitive' | 'exactPhrase'>;

/** One media attachment inside an imported message. `path`, when present, is a CONFINED
 *  absolute path INSIDE the chosen export root (see `confineImportPath`); it is ABSENT when
 *  the export pointed outside the root or at a remote URL (the media was dropped). */
export interface ImportedMedia {
  type: 'image' | 'gif' | 'video' | 'voice' | 'audio' | 'file';
  name: string;
  path?: string;
}

/** One imported message (visible export content). */
export interface ImportedItem {
  chatId: string;
  chatName: string;
  messageId: string;
  author: string;
  authorId: string;
  timestamp: string;
  text: string;
  links: string[];
  media: ImportedMedia[];
}

/** A parsed Telegram Desktop export set (one imported chat). */
export interface TgImportSet {
  id: string;
  name: string;
  sourceFile: string;
  items: ImportedItem[];
  /** ISO timestamp supplied by the caller (injected clock). */
  importedAt: string;
}

// ---- injectable fs seam (for tests) ------------------------------------

export interface TgHunterStoreDeps {
  /** Read raw bytes; must throw with `(err as NodeJS.ErrnoException).code === 'ENOENT'` when absent. */
  readFile(path: string): Promise<Buffer>;
  /** Atomic write (caller provides the JSON string). */
  writeFile(path: string, data: string): Promise<void>;
  membersPath(caseId: string): string;
  profilesPath(caseId: string): string;
  keywordWatchPath(caseId: string): string;
  importsPath(caseId: string): string;
  dedupPath(caseId: string): string;
}

// ---- helpers -----------------------------------------------------------

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function readJsonArr<T>(deps: Pick<TgHunterStoreDeps, 'readFile'>, path: string): Promise<T[]> {
  try {
    const buf = await deps.readFile(path);
    return JSON.parse(buf.toString('utf8')) as T[];
  } catch (e) {
    if (isEnoent(e)) return [];
    throw e;
  }
}

async function writeJson<T>(deps: Pick<TgHunterStoreDeps, 'writeFile'>, path: string, value: T): Promise<void> {
  await deps.writeFile(path, JSON.stringify(value, null, 2));
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

// ---- import parser (LFI-guarded) ---------------------------------------

/** Extension → media kind, ported from the source's `parseJsonExport`. */
function mediaTypeForExt(ext: string): ImportedMedia['type'] {
  const e = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(e)) return 'image';
  if (['.gif', '.webm'].includes(e)) return 'gif';
  if (['.mp4', '.mov', '.mkv', '.avi'].includes(e)) return 'video';
  if (['.ogg', '.opus'].includes(e)) return 'voice';
  if (['.mp3', '.wav', '.m4a', '.flac'].includes(e)) return 'audio';
  return 'file';
}

/** Telegram export message text is either a string or an array of `{text}` / string runs. */
function joinText(text: unknown): string {
  if (Array.isArray(text)) {
    return text.map((v) => (typeof v === 'string' ? v : String((v as { text?: unknown })?.text ?? ''))).join('');
  }
  return typeof text === 'string' ? text : '';
}

const HTTP_RE = /^https?:/i;
const LINK_RE = /https?:\/\/[^\s]+/g;

/**
 * Parse a Telegram Desktop `result.json` export rooted at `root`, into `ImportedItem`s.
 * HARDENED PORT of the source `parseJsonExport`: every media rel-path is resolved through
 * `confineImportPath(root, rel)` and DROPPED when it escapes the root (`../../etc/passwd`,
 * an absolute `/etc/passwd`) or is a remote URL — the message is kept, the offending media
 * is not. No fs access here (pure); a later reader dereferences only confined paths.
 */
export function parseTelegramExport(root: string, json: unknown): ImportedItem[] {
  const raw = (json ?? {}) as { chats?: { list?: unknown[] } | unknown[] };
  const chats = Array.isArray(raw.chats)
    ? raw.chats
    : Array.isArray((raw.chats as { list?: unknown[] } | undefined)?.list)
      ? (raw.chats as { list: unknown[] }).list
      : [];

  const out: ImportedItem[] = [];
  chats.forEach((chatRaw, idx) => {
    const chat = (chatRaw ?? {}) as { id?: unknown; name?: unknown; messages?: unknown[] };
    const chatId = `json-${String(chat.id ?? idx)}`;
    const chatName = String(chat.name ?? chat.id ?? `Chat ${idx + 1}`);
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    for (const msgRaw of messages) {
      const msg = (msgRaw ?? {}) as {
        id?: unknown; from?: unknown; actor?: unknown; from_id?: unknown; actor_id?: unknown;
        date?: unknown; text?: unknown; file?: unknown; photo?: unknown; thumbnail?: unknown;
      };
      const text = joinText(msg.text);
      const media: ImportedMedia[] = [];
      const rel = String(msg.file ?? msg.photo ?? msg.thumbnail ?? '');
      // Skip remote refs (source did `if (/^https?:/i.test(rel)) continue`) and confine the rest.
      if (rel && !HTTP_RE.test(rel)) {
        const full = confineImportPath(root, rel);
        if (full) {
          const dot = full.lastIndexOf('.');
          const ext = dot >= 0 ? full.slice(dot) : '';
          const slash = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
          const name = slash >= 0 ? full.slice(slash + 1) : full;
          media.push({ type: mediaTypeForExt(ext), name, path: full });
        }
        // else: media escaped the root — DROPPED (the LFI fix).
      }
      out.push({
        chatId,
        chatName,
        messageId: String(msg.id ?? ''),
        author: String(msg.from ?? msg.actor ?? ''),
        authorId: String(msg.from_id ?? msg.actor_id ?? ''),
        timestamp: String(msg.date ?? ''),
        text,
        links: [...text.matchAll(LINK_RE)].map((m) => m[0]),
        media,
      });
    }
  });
  return out;
}

// ---- factory -----------------------------------------------------------

export interface TgHunterStore {
  members: {
    read(caseId: string): Promise<TgMember[]>;
    write(caseId: string, members: TgMember[]): Promise<void>;
    /** Upsert one member, deduped by (handle, displayName, context) case-insensitively.
     *  Returns the total member count for the case. */
    save(caseId: string, member: TgMember): Promise<number>;
    /** Batch upsert (one read + one write), deduped by (handle, displayName, context)
     *  case-insensitively. Returns `{ added, total }`: how many rows were genuinely NEW
     *  and the total collected count afterward — `total` is the count of members actually
     *  collected, NOT a claimed group size (Telegram hides that; we never fabricate it). */
    saveMany(caseId: string, members: TgMember[]): Promise<{ added: number; total: number }>;
  };
  profiles: {
    read(caseId: string): Promise<TgProfile[]>;
    write(caseId: string, profiles: TgProfile[]): Promise<void>;
    /** Batch upsert (one read + one write), deduped by (handle, displayName, context)
     *  case-insensitively. Returns `{ added, total }`: how many rows were genuinely NEW
     *  and the total captured count afterward. `total` is what was actually captured —
     *  the account-creation date remains null (Telegram hides it), never fabricated. */
    saveMany(caseId: string, profiles: TgProfile[]): Promise<{ added: number; total: number }>;
  };
  keywordWatch: {
    read(caseId: string): Promise<TgKeywordRule[]>;
    write(caseId: string, rules: TgKeywordRule[]): Promise<void>;
    /** Add a literal keyword term (with its match options), deduped by term
     *  case-insensitively. Returns the fresh rule list. */
    add(caseId: string, term: string, addedAt: string, opts?: TgKeywordOptions): Promise<TgKeywordRule[]>;
  };
  imports: {
    read(caseId: string): Promise<TgImportSet[]>;
    write(caseId: string, sets: TgImportSet[]): Promise<void>;
    /** Add one imported set, deduped by (sourceFile, id). Returns the total set count. */
    add(caseId: string, set: TgImportSet): Promise<number>;
  };
  dedup: {
    read(caseId: string): Promise<string[]>;
    has(caseId: string, key: string): Promise<boolean>;
    /** Record `key`; returns true iff it was newly added (false if already seen). */
    add(caseId: string, key: string): Promise<boolean>;
  };
}

export function makeTgHunterStore(deps: TgHunterStoreDeps): TgHunterStore {
  return {
    members: {
      read(caseId) {
        return withLock(`tg:members:${caseId}`, () =>
          readJsonArr<TgMember>(deps, deps.membersPath(caseId)),
        );
      },
      write(caseId, members) {
        return withLock(`tg:members:${caseId}`, () =>
          writeJson(deps, deps.membersPath(caseId), members),
        );
      },
      save(caseId, member) {
        return withLock(`tg:members:${caseId}`, async () => {
          const existing = await readJsonArr<TgMember>(deps, deps.membersPath(caseId));
          const key = (m: TgMember) => `${norm(m.handle)}|${norm(m.displayName)}|${norm(m.context)}`;
          const k = key(member);
          const idx = existing.findIndex((m) => key(m) === k);
          if (idx >= 0) existing[idx] = member;
          else existing.push(member);
          await writeJson(deps, deps.membersPath(caseId), existing);
          return existing.length;
        });
      },
      saveMany(caseId, members) {
        return withLock(`tg:members:${caseId}`, async () => {
          const existing = await readJsonArr<TgMember>(deps, deps.membersPath(caseId));
          const key = (m: TgMember) => `${norm(m.handle)}|${norm(m.displayName)}|${norm(m.context)}`;
          const index = new Map(existing.map((m, i) => [key(m), i]));
          let added = 0;
          for (const member of members) {
            const k = key(member);
            const at = index.get(k);
            if (at === undefined) {
              index.set(k, existing.length);
              existing.push(member);
              added += 1;
            } else {
              existing[at] = member; // refresh the latest visible values
            }
          }
          await writeJson(deps, deps.membersPath(caseId), existing);
          return { added, total: existing.length };
        });
      },
    },

    profiles: {
      read(caseId) {
        return withLock(`tg:profiles:${caseId}`, () =>
          readJsonArr<TgProfile>(deps, deps.profilesPath(caseId)),
        );
      },
      write(caseId, profiles) {
        return withLock(`tg:profiles:${caseId}`, () =>
          writeJson(deps, deps.profilesPath(caseId), profiles),
        );
      },
      saveMany(caseId, profiles) {
        return withLock(`tg:profiles:${caseId}`, async () => {
          const existing = await readJsonArr<TgProfile>(deps, deps.profilesPath(caseId));
          const key = (p: TgProfile) => `${norm(p.handle)}|${norm(p.displayName)}|${norm(p.context)}`;
          const index = new Map(existing.map((p, i) => [key(p), i]));
          let added = 0;
          for (const profile of profiles) {
            const k = key(profile);
            const at = index.get(k);
            if (at === undefined) {
              index.set(k, existing.length);
              existing.push(profile);
              added += 1;
            } else {
              existing[at] = profile; // refresh the latest visible values
            }
          }
          await writeJson(deps, deps.profilesPath(caseId), existing);
          return { added, total: existing.length };
        });
      },
    },

    keywordWatch: {
      read(caseId) {
        return withLock(`tg:keyword:${caseId}`, () =>
          readJsonArr<TgKeywordRule>(deps, deps.keywordWatchPath(caseId)),
        );
      },
      write(caseId, rules) {
        return withLock(`tg:keyword:${caseId}`, () =>
          writeJson(deps, deps.keywordWatchPath(caseId), rules),
        );
      },
      add(caseId, term, addedAt, opts) {
        return withLock(`tg:keyword:${caseId}`, async () => {
          const existing = await readJsonArr<TgKeywordRule>(deps, deps.keywordWatchPath(caseId));
          if (!existing.some((r) => norm(r.term) === norm(term))) {
            const rule: TgKeywordRule = { term, addedAt };
            if (opts?.caseSensitive !== undefined) rule.caseSensitive = opts.caseSensitive;
            if (opts?.exactPhrase !== undefined) rule.exactPhrase = opts.exactPhrase;
            existing.push(rule);
            await writeJson(deps, deps.keywordWatchPath(caseId), existing);
          }
          return existing;
        });
      },
    },

    imports: {
      read(caseId) {
        return withLock(`tg:imports:${caseId}`, () =>
          readJsonArr<TgImportSet>(deps, deps.importsPath(caseId)),
        );
      },
      write(caseId, sets) {
        return withLock(`tg:imports:${caseId}`, () =>
          writeJson(deps, deps.importsPath(caseId), sets),
        );
      },
      add(caseId, set) {
        return withLock(`tg:imports:${caseId}`, async () => {
          const existing = await readJsonArr<TgImportSet>(deps, deps.importsPath(caseId));
          const key = (s: TgImportSet) => `${norm(s.sourceFile)}|${norm(s.id)}`;
          const k = key(set);
          const idx = existing.findIndex((s) => key(s) === k);
          if (idx >= 0) existing[idx] = set;
          else existing.push(set);
          await writeJson(deps, deps.importsPath(caseId), existing);
          return existing.length;
        });
      },
    },

    dedup: {
      read(caseId) {
        return withLock(`tg:dedup:${caseId}`, () =>
          readJsonArr<string>(deps, deps.dedupPath(caseId)),
        );
      },
      has(caseId, key) {
        return withLock(`tg:dedup:${caseId}`, async () => {
          const seen = await readJsonArr<string>(deps, deps.dedupPath(caseId));
          return seen.includes(key);
        });
      },
      add(caseId, key) {
        return withLock(`tg:dedup:${caseId}`, async () => {
          const seen = await readJsonArr<string>(deps, deps.dedupPath(caseId));
          if (seen.includes(key)) return false;
          seen.push(key);
          await writeJson(deps, deps.dedupPath(caseId), seen);
          return true;
        });
      },
    },
  };
}

// ---- production-wired singleton ----------------------------------------
// Lazy: electron/paths/secure-fs/validate are resolved only on first call, so importing
// this module in tests that inject their own deps never evaluates electron. Telegram artifacts
// live under scrapingCaseDir('socmint', caseId) (Telegram shares the socmint namespace with
// WhatsApp). Every caseId reaching disk is ensureUuid-validated (Global Constraints).

let _prod: TgHunterStore | null = null;

export async function prodTgHunterStore(): Promise<TgHunterStore> {
  if (_prod) return _prod;
  const [{ join }, paths, { secureReadFile, secureWriteFile }, { ensureUuid }] = await Promise.all([
    import('node:path'),
    import('../../storage/paths'),
    import('../../storage/secure-fs'),
    import('../../security/validate'),
  ]);
  const artifact = (id: string, name: string) =>
    join(paths.scrapingCaseDir('socmint', ensureUuid(id, 'caseId')), name);
  _prod = makeTgHunterStore({
    readFile: secureReadFile,
    writeFile: (p, d) => secureWriteFile(p, d),
    membersPath: (id) => artifact(id, 'tg-members.json'),
    profilesPath: (id) => artifact(id, 'tg-profiles.json'),
    keywordWatchPath: (id) => artifact(id, 'tg-keyword-watch.json'),
    importsPath: (id) => artifact(id, 'tg-imports.json'),
    dedupPath: (id) => artifact(id, 'tg-dedup.json'),
  });
  return _prod;
}

/** Test-only: drop the cached production store. */
export function __resetProdTgHunterStore(): void {
  _prod = null;
}
