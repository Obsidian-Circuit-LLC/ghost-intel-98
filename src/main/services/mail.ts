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
    client = new ImapFlow({
      host: input.imapHost, port: input.imapPort, secure: input.imapSecure,
      auth: { user: input.user, pass: input.password }, logger: false
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
  const client = new ImapFlow({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure,
    auth: { user: acct.user, pass: password }, logger: false
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const out: MailMessageSummary[] = [];
    for await (const msg of client.fetch({ seen: false }, { envelope: true, internalDate: true, uid: true, bodyStructure: true, source: false })) {
      out.push({
        uid: msg.uid,
        from: msg.envelope?.from?.[0]?.address ?? '',
        to: msg.envelope?.to?.[0]?.address ?? '',
        subject: msg.envelope?.subject ?? '(no subject)',
        date: toIso(msg.internalDate),
        preview: '',
        unseen: true
      });
      if (out.length >= limit) break;
    }
    for await (const msg of client.fetch({ seen: true }, { envelope: true, internalDate: true, uid: true })) {
      if (out.length >= limit * 2) break;
      out.push({
        uid: msg.uid,
        from: msg.envelope?.from?.[0]?.address ?? '',
        to: msg.envelope?.to?.[0]?.address ?? '',
        subject: msg.envelope?.subject ?? '(no subject)',
        date: toIso(msg.internalDate),
        preview: '',
        unseen: false
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  } finally {
    await safeLogout(client);
  }
}

export async function fetchMessage(id: string, uid: number): Promise<MailMessage> {
  const { acct, password } = await loadAccountWithPassword(id);
  const client = new ImapFlow({
    host: acct.imapHost, port: acct.imapPort, secure: acct.imapSecure,
    auth: { user: acct.user, pass: password }, logger: false
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const msg = await client.fetchOne(String(uid), { envelope: true, internalDate: true, source: true, uid: true }, { uid: true });
    if (!msg) throw new Error(`Message uid=${uid} not found`);
    const source = msg.source ?? Buffer.from('');
    let parsed: ParsedMail;
    try {
      parsed = await simpleParser(source);
    } catch {
      // Fallback: at least return raw source as body if multipart parse fails.
      return {
        uid: msg.uid,
        from: msg.envelope?.from?.[0]?.address ?? '',
        to: msg.envelope?.to?.[0]?.address ?? '',
        subject: msg.envelope?.subject ?? '(no subject)',
        date: toIso(msg.internalDate),
        preview: '', unseen: false,
        body: source.toString('utf8'),
        attachments: []
      };
    }
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
      attachments: (parsed.attachments ?? []).map((a: ParsedAttachment) => ({
        filename: a.filename ?? 'attachment',
        contentType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? a.content.length,
        contentBase64: a.content.toString('base64')
      }))
    };
  } finally {
    await safeLogout(client);
  }
}

export async function sendMail(input: MailSendInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { acct, password } = await loadAccountWithPassword(input.accountId);
    const transporter = nodemailer.createTransport({
      host: acct.smtpHost, port: acct.smtpPort, secure: acct.smtpSecure,
      auth: { user: acct.user, pass: password }
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
  return draftStore.list(accountId);
}

export async function upsertDraft(input: Parameters<typeof draftStore.upsert>[0]): Promise<draftStore.MailDraft> {
  return draftStore.upsert(input);
}

export async function deleteDraft(id: string): Promise<void> {
  return draftStore.remove(id);
}
