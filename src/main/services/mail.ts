/**
 * Mail service — accounts persisted in settings (sans password); passwords in secrets.enc.
 * Connections are short-lived (open per fetch / send) to keep the model simple and
 * the resource footprint low.
 */

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import type { MailAccount, MailMessage, MailMessageSummary, MailSendInput } from '@shared/post-mvp-types';
import { secretStore } from '../secrets';
import { settingsStore } from '../storage/json-fs';

interface PersistedAccounts {
  accounts: Omit<MailAccount, never>[];
}

async function readAccounts(): Promise<MailAccount[]> {
  const s = await settingsStore.read();
  return ((s as unknown as { mailAccountsV2?: MailAccount[] }).mailAccountsV2) ?? [];
}

async function writeAccounts(list: MailAccount[]): Promise<void> {
  const s = await settingsStore.read();
  const next = { ...s, mailAccountsV2: list } as unknown as PersistedAccounts;
  await settingsStore.update(next as unknown as Parameters<typeof settingsStore.update>[0]);
}

export async function listAccounts(): Promise<MailAccount[]> {
  return readAccounts();
}

export async function upsertAccount(input: MailAccount & { password?: string }): Promise<MailAccount> {
  const list = await readAccounts();
  const id = input.id || `acct-${randomUUID()}`;
  const passwordRef = input.passwordRef || `mail.password.${id}`;
  if (input.password) {
    await secretStore.set(passwordRef, input.password);
  }
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
  const idx = list.findIndex((a) => a.id === id);
  if (idx >= 0) list[idx] = cleaned;
  else list.push(cleaned);
  await writeAccounts(list);
  return cleaned;
}

export async function deleteAccount(id: string): Promise<void> {
  const list = await readAccounts();
  const acct = list.find((a) => a.id === id);
  if (acct) await secretStore.delete(acct.passwordRef);
  await writeAccounts(list.filter((a) => a.id !== id));
}

function toIso(d: string | Date | null | undefined): string {
  if (!d) return new Date().toISOString();
  if (d instanceof Date) return d.toISOString();
  return new Date(d).toISOString();
}

async function loadAccountWithPassword(id: string): Promise<{ acct: MailAccount; password: string }> {
  const list = await readAccounts();
  const acct = list.find((a) => a.id === id);
  if (!acct) throw new Error(`Mail account not found: ${id}`);
  const password = await secretStore.get(acct.passwordRef);
  if (password == null) throw new Error(`No password stored for ${acct.label}.`);
  return { acct, password };
}

export async function testAccount(input: MailAccount & { password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = new ImapFlow({
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
    // also pull recently seen for context
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
    await client.logout();
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
    await client.logout();
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
