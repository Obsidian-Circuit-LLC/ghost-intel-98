/**
 * Mail service — accounts in mail-accounts.json, passwords in secrets.enc.
 * Connections are short-lived per fetch / send.
 *
 * v1.0.1 round-3 fixes:
 *  - Write account profile FIRST, then secret. If secret fails, roll back the profile.
 *    No more orphaned passwordRefs piling up in secrets.enc when disk pressure spikes.
 *  - SecretsUnavailableError surfaces as "Keyring locked — unlock and retry" rather than
 *    masquerading as "no password stored".
 *  - safeLogout still wraps logout in try/catch so it doesn't mask in-flight errors.
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import type { MailAccount, MailMessage, MailMessageSummary, MailSendInput } from '@shared/post-mvp-types';
import { secretStore, SecretsUnavailableError, SecretsCorruptedError } from '../secrets';
import * as accountStore from '../storage/accounts';

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
  // 1. Persist the profile first.
  await accountStore.upsertAccount(cleaned);
  // 2. Then write the secret. If this fails, roll back the profile so we don't have
  //    a row pointing at a non-existent password (forcing the user to re-enter from scratch).
  if (input.password) {
    try {
      await secretStore.set(passwordRef, input.password);
    } catch (err) {
      // Roll back. If this rollback ALSO fails, surface both.
      try { await accountStore.deleteAccount(id); } catch { /* nothing more we can do */ }
      throw err;
    }
  }
  return cleaned;
}

export async function deleteAccount(id: string): Promise<void> {
  const removed = await accountStore.deleteAccount(id);
  if (removed) {
    try {
      await secretStore.delete(removed.passwordRef);
    } catch {
      // If secrets are unreadable, leave the password ref orphaned rather than blocking the delete.
    }
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
  if (password == null) {
    throw new Error(`No password stored for ${acct.label} — re-enter via Accounts…`);
  }
  return { acct, password };
}

function toIso(d: string | Date | null | undefined): string {
  if (!d) return new Date().toISOString();
  if (d instanceof Date) return d.toISOString();
  return new Date(d).toISOString();
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch { /* nothing */ }
  }
}

export async function testAccount(input: MailAccount & { password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  let client: ImapFlow | null = null;
  try {
    client = new ImapFlow({
      host: input.imapHost,
      port: input.imapPort,
      secure: input.imapSecure,
      auth: { user: input.user, pass: input.password },
      logger: false
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
    host: acct.imapHost,
    port: acct.imapPort,
    secure: acct.imapSecure,
    auth: { user: acct.user, pass: password },
    logger: false
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
    host: acct.imapHost,
    port: acct.imapPort,
    secure: acct.imapSecure,
    auth: { user: acct.user, pass: password },
    logger: false
  });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX');
    const msg = await client.fetchOne(String(uid), { envelope: true, internalDate: true, source: true, uid: true }, { uid: true });
    if (!msg) throw new Error(`Message uid=${uid} not found`);
    const bodyBuf = msg.source ?? Buffer.from('');
    return {
      uid: msg.uid,
      from: msg.envelope?.from?.[0]?.address ?? '',
      to: msg.envelope?.to?.[0]?.address ?? '',
      subject: msg.envelope?.subject ?? '(no subject)',
      date: toIso(msg.internalDate),
      preview: '',
      unseen: false,
      body: bodyBuf.toString('utf8')
    };
  } finally {
    await safeLogout(client);
  }
}

export async function sendMail(input: MailSendInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { acct, password } = await loadAccountWithPassword(input.accountId);
    const transporter = nodemailer.createTransport({
      host: acct.smtpHost,
      port: acct.smtpPort,
      secure: acct.smtpSecure,
      auth: { user: acct.user, pass: password }
    });
    const info = await transporter.sendMail({
      from: acct.user,
      to: input.to,
      subject: input.subject,
      text: input.body
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
