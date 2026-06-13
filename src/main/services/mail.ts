/**
 * Mail service. Accounts in mail-accounts.json, drafts in mail-drafts.json,
 * passwords in secrets.enc. Short-lived IMAP/SMTP connections.
 *
 * v2.0: outbound attachments via nodemailer's attachments array;
 * inbound multipart parsing via mailparser (extracts attachments to MailAttachment);
 * drafts API delegated to storage/drafts.ts.
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser, type ParsedMail, type Attachment as ParsedAttachment } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { MailAccount, MailMessage, MailMessageSummary, MailSendInput } from '@shared/post-mvp-types';
import { secretStore, SecretsUnavailableError, SecretsCorruptedError } from '../secrets';
import * as accountStore from '../storage/accounts';
import * as draftStore from '../storage/drafts';
import { markConsented, assertAllConsented } from '../security/consent';
import { isDraftAttachmentSafe } from '../security/validate';

/** Refuse to parse messages larger than this — protects main process against
 *  multipart bombs from a hostile mail server. */
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024; // 25 MB
/** Refuse to ship individual attachments larger than this back to the renderer. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Tightened from imapflow's defaults (90s connect / 16s greeting / 5min idle) so an
 *  unreachable or wrong host fails fast and *catchably* instead of hanging for minutes. */
const IMAP_TIMEOUTS = { connectionTimeout: 20_000, greetingTimeout: 12_000, socketTimeout: 45_000 } as const;

/**
 * Construct an ImapFlow client with a persistent 'error' listener attached.
 *
 * CRITICAL: ImapFlow is an EventEmitter. A socket timeout or any async transport fault
 * emits an 'error' event. With NO listener, Node's emitter contract re-throws it as an
 * uncaughtException — which Electron turns into a fatal "A JavaScript error occurred in
 * the main process" dialog that kills the entire app. (Reported in the wild: a slow /
 * unreachable IMAP host hit the idle socketTimeout, imapflow emitted 'error', nothing
 * listened, the app crashed.) The listener keeps the failure contained to the in-flight
 * operation's awaited promise, which rejects and is surfaced to the renderer as a toast.
 */
function makeImapClient(opts: { host: string; port: number; secure: boolean; user: string; pass: string }): ImapFlow {
  const client = new ImapFlow({
    host: opts.host, port: opts.port, secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass }, logger: false,
    ...IMAP_TIMEOUTS
  });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[mail.imap] client error event', { host: opts.host, message: (err as Error)?.message });
  });
  return client;
}

export async function listAccounts(): Promise<MailAccount[]> {
  return accountStore.listAccounts();
}

export async function upsertAccount(input: MailAccount & { password?: string }): Promise<MailAccount> {
  const id = input.id || `acct-${randomUUID()}`;
  const passwordRef = input.passwordRef || `mail.password.${id}`;
  const cleaned: MailAccount = {
    id,
    label: input.label,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    user: input.user,
    passwordRef
  };
  await accountStore.upsertAccount(cleaned);
  if (input.password) {
    try {
      await secretStore.set(passwordRef, input.password);
    } catch (err) {
      try { await accountStore.deleteAccount(id); } catch { /* nothing more we can do */ }
      throw err;
    }
  }
  return cleaned;
}

export async function deleteAccount(id: string): Promise<void> {
  const removed = await accountStore.deleteAccount(id);
  if (removed) {
    try { await secretStore.delete(removed.passwordRef); } catch { /* secrets may already be gone */ }
  }
}

async function loadAccountWithPassword(id: string): Promise<{ acct: MailAccount; password: string }> {
  const list = await accountStore.listAccounts();
  const acct = list.find((a) => a.id === id);
  if (!acct) throw new Error(`Mail account not found: ${id}`);
  let password: string | null;
  try {
    password = await secretStore.get(acct.passwordRef);
  } catch (err) {
    if (err instanceof SecretsUnavailableError) {
      throw new Error(`OS keyring is locked or unavailable — unlock it and retry. (${acct.label})`);
    }
    if (err instanceof SecretsCorruptedError) {
      throw new Error(`Encrypted secrets file is unreadable — see Settings → About → secrets backend. (${acct.label})`);
    }
    throw err;
  }
  if (password == null) throw new Error(`No password stored for ${acct.label} — re-enter via Accounts…`);
  return { acct, password };
}

function toIso(d: string | Date | null | undefined): string {
  if (!d) return new Date().toISOString();
  if (d instanceof Date) return d.toISOString();
  return new Date(d).toISOString();
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try { await client.logout(); } catch { try { client.close(); } catch { /* nothing */ } }
}

export async function testAccount(input: MailAccount & { password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  let client: ImapFlow | null = null;
  try {
    client = makeImapClient({
      host: input.imapHost, port: input.imapPort, secure: input.imapSecure,
      user: input.user, pass: input.password
    });
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    if (client) await safeLogout(client);
    return { ok: false, error: (err as Error).message };
  }
}

export async function fetchInbox(id: string, limit = 30): Promise<MailMessageSummary[]> {
  const { acct, password } = await loadAccountWithPassword(id);
  const client = makeImapClient({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure,
    user: acct.user, pass: password
  });
  await client.connect();
  try {
    const mbox = await client.mailboxOpen('INBOX');
    // Fetch the NEWEST `limit` messages by sequence number, not a seen/unseen-filtered slice.
    // The old code did `fetch({seen:false})` then `break` at `limit` — but IMAP FETCH yields in
    // ASCENDING sequence order (oldest first), so a full inbox of unseen mail filled every slot
    // with the OLDEST unseen messages and the just-arrived one (e.g. a self-sent test) was never
    // retrieved. Sorting by date afterwards can only reorder what was fetched. Sequence `start:*`
    // is the highest-numbered (= most-recent) messages, which is exactly what an inbox view wants,
    // independent of the \Seen flag. `unseen` now comes from the actual flag, not the fetch bucket.
    const total = mbox.exists ?? 0;
    if (total === 0) return [];
    const start = Math.max(1, total - limit + 1);
    const out: MailMessageSummary[] = [];
    for await (const msg of client.fetch(`${start}:*`, { envelope: true, internalDate: true, uid: true, flags: true })) {
      out.push({
        uid: msg.uid,
        from: msg.envelope?.from?.[0]?.address ?? '',
        to: msg.envelope?.to?.[0]?.address ?? '',
        subject: msg.envelope?.subject ?? '(no subject)',
        date: toIso(msg.internalDate),
        preview: '',
        unseen: !(msg.flags?.has('\\Seen') ?? false)
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  } finally {
    await safeLogout(client);
  }
}

export async function fetchMessage(id: string, uid: number): Promise<MailMessage> {
  const { acct, password } = await loadAccountWithPassword(id);
  const client = makeImapClient({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure,
    user: acct.user, pass: password
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    // Round-3 audit High: pull envelope first so we have headers even if we abort the body fetch.
    const meta = await client.fetchOne(String(uid), { envelope: true, internalDate: true, uid: true }, { uid: true });
    if (!meta) throw new Error(`Message uid=${uid} not found`);
    // Stream the body with a byte-counted cap so a hostile server can't OOM main by
    // returning a multi-GB message. Previous fetchOne({source:true}) buffered the
    // whole message in RAM before our cap check fired.
    const dl = await client.download(String(uid), undefined, { uid: true });
    let source: Buffer | null = null;
    let aborted = false;
    if (dl && dl.content) {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of dl.content as AsyncIterable<Buffer>) {
        total += chunk.length;
        if (total > MAX_MESSAGE_BYTES) {
          aborted = true;
          break;
        }
        chunks.push(chunk);
      }
      source = aborted ? null : Buffer.concat(chunks);
    }
    if (aborted || !source) {
      return {
        uid: meta.uid,
        from: meta.envelope?.from?.[0]?.address ?? '',
        to: meta.envelope?.to?.[0]?.address ?? '',
        subject: meta.envelope?.subject ?? '(no subject)',
        date: toIso(meta.internalDate),
        preview: '', unseen: false,
        body: `[Message exceeds the ${MAX_MESSAGE_BYTES} byte in-app size limit. Open in webmail to view.]`,
        attachments: []
      };
    }
    const msg = { ...meta, source } as typeof meta & { source: Buffer };
    let parsed: ParsedMail | null = null;
    let parseError: string | null = null;
    try {
      parsed = await simpleParser(source);
    } catch (err) {
      parseError = (err as Error).message;
      // eslint-disable-next-line no-console
      console.error('[mail.parse]', { uid, err });
    }
    if (!parsed) {
      // Fallback: raw source as body — but stamp the parse error so the UI can warn the user.
      return {
        uid: msg.uid,
        from: msg.envelope?.from?.[0]?.address ?? '',
        to: msg.envelope?.to?.[0]?.address ?? '',
        subject: `${msg.envelope?.subject ?? '(no subject)'} — [parse failed: ${parseError}]`,
        date: toIso(msg.internalDate),
        preview: '', unseen: false,
        body: source.toString('utf8'),
        attachments: []
      };
    }
    const attachments = (parsed.attachments ?? []).map((a: ParsedAttachment) => {
      const size = a.size ?? a.content.length;
      if (size > MAX_ATTACHMENT_BYTES) {
        return {
          filename: a.filename ?? 'attachment',
          contentType: a.contentType ?? 'application/octet-stream',
          size,
          // Do not ship the content — the renderer can't usefully hold 50 MB+ base64.
          contentBase64: undefined
        };
      }
      return {
        filename: a.filename ?? 'attachment',
        contentType: a.contentType ?? 'application/octet-stream',
        size,
        contentBase64: a.content.toString('base64')
      };
    });
    return {
      uid: msg.uid,
      from: parsed.from?.text ?? msg.envelope?.from?.[0]?.address ?? '',
      to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to.text) : (msg.envelope?.to?.[0]?.address ?? ''),
      subject: parsed.subject ?? msg.envelope?.subject ?? '(no subject)',
      date: toIso(parsed.date ?? msg.internalDate),
      preview: parsed.text?.slice(0, 200) ?? '',
      unseen: false,
      body: parsed.text ?? '',
      html: typeof parsed.html === 'string' ? parsed.html : undefined,
      attachments
    };
  } finally {
    await safeLogout(client);
  }
}

export async function sendMail(input: MailSendInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    // Critical: every attachment path must have come through a user-gesture path
    // (files.pickOpen dialog or a previously persisted draft). Without this gate,
    // a compromised renderer could exfil arbitrary local files via SMTP.
    const paths = (input.attachments ?? []).map((a) => a.path);
    assertAllConsented(paths, 'mail attachment');

    const { acct, password } = await loadAccountWithPassword(input.accountId);
    const transporter = nodemailer.createTransport({
      host: acct.smtpHost, port: acct.smtpPort, secure: acct.smtpSecure,
      // When the port isn't implicit-TLS (e.g. 587), the connection MUST upgrade to TLS via
      // STARTTLS before auth. requireTLS makes nodemailer demand that upgrade and refuse to
      // fall back to cleartext — both a security floor and the fix for "587 won't connect".
      requireTLS: true,
      auth: { user: acct.user, pass: password },
      connectionTimeout: 20_000, greetingTimeout: 12_000, socketTimeout: 45_000
    });
    const info = await transporter.sendMail({
      from: acct.user,
      to: input.to,
      subject: input.subject,
      text: input.body,
      attachments: (input.attachments ?? []).map((a) => ({
        path: a.path,
        filename: a.filename ?? basename(a.path)
      }))
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------- Drafts ----------

export async function listDrafts(accountId?: string): Promise<draftStore.MailDraft[]> {
  const drafts = await draftStore.list(accountId);
  // Re-validate every draft attachment path BEFORE marking consented. Defends against
  // the upgrade case where a v2.0.0 compromised renderer might have persisted
  // attacker-planted paths to mail-drafts.json. (Round-5 audit High H-A fix.)
  // Invalid entries are dropped from the returned draft so the UI doesn't show them.
  const out: draftStore.MailDraft[] = [];
  for (const d of drafts) {
    const safeAttachments: typeof d.attachments = [];
    const safePaths: string[] = [];
    for (const a of d.attachments) {
      if (await isDraftAttachmentSafe(a.path)) {
        safeAttachments.push(a);
        safePaths.push(a.path);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[mail.listDrafts] dropping unsafe attachment from draft', { draftId: d.id, name: a.name });
      }
    }
    markConsented(safePaths);
    out.push({ ...d, attachments: safeAttachments });
  }
  return out;
}

export async function upsertDraft(input: Parameters<typeof draftStore.upsert>[0]): Promise<draftStore.MailDraft> {
  return draftStore.upsert(input);
}

export async function deleteDraft(id: string): Promise<void> {
  return draftStore.remove(id);
}
