/**
 * AI Assistant — chat interface backed by the configured provider in Settings.
 * Case context is opt-in per-message — the user explicitly checks which case to include.
 * API keys live in safeStorage; the renderer never sees them in plaintext.
 *
 * v1.0.1 fixes: randomUUID streamId (no millisecond collisions), useEffect cleanup
 * cancels active streams on unmount, context-load failure surfaces in the UI instead
 * of silently sending an empty context.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiChatMessage, AiChatRequest } from '@shared/post-mvp-types';
import type { CaseSummary, CaseRecord } from '@shared/types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';

interface DisplayMessage extends AiChatMessage {
  id: string;
  streaming?: boolean;
}

function newId(): string {
  return crypto.randomUUID();
}

export function AiAssistantModule(): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [contextCaseId, setContextCaseId] = useState('');
  const [contextCase, setContextCase] = useState<CaseRecord | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(false);
  const activeStreamRef = useRef<{ id: string; off: () => void } | null>(null);
  // One-time-per-session confirmation that file CONTENTS may leave the machine to a remote provider.
  const remoteEgressConfirmedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = useSettings((s) => s.settings);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);

  // Default the "include file contents" toggle by provider — on for local Ollama (data
  // never leaves the box), off for remote/none until the user opts in. A provider change
  // also invalidates any prior remote-egress confirmation.
  useEffect(() => {
    setIncludeFiles(settings?.ai.provider === 'ollama');
    remoteEgressConfirmedRef.current = false;
  }, [settings?.ai.provider]);

  useEffect(() => {
    setContextError(null);
    if (!contextCaseId) { setContextCase(null); return; }
    void window.api.cases.read(contextCaseId)
      .then((c) => { setContextCase(c); setContextError(null); })
      .catch((err) => { setContextCase(null); setContextError((err as Error).message); });
  }, [contextCaseId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Cancel any in-flight stream + drop the listener on unmount.
  useEffect(() => {
    return () => {
      const active = activeStreamRef.current;
      if (active) {
        active.off();
        void window.api.ai.cancel(active.id).catch(() => {});
        activeStreamRef.current = null;
      }
    };
  }, []);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    if (settings?.ai.provider === 'none') {
      toast.warn('Set an AI provider in Settings first.');
      return;
    }
    if (contextCaseId && !contextCase) {
      toast.warn('Case context failed to load. Clear the dropdown or retry before sending.');
      return;
    }
    const text = input.trim();

    // Assemble context BEFORE mutating chat state. Gathering file contents reads files and,
    // for a remote provider, prompts the user to confirm egress. If they decline we abort
    // cleanly with nothing added to the transcript — hence this runs before the bubbles append.
    let context: string | undefined;
    if (contextCase) {
      if (includeFiles) {
        let gathered: GatheredFiles;
        try {
          gathered = await gatherCaseFiles(contextCase);
        } catch (err) {
          toast.error(`Could not read case files: ${(err as Error).message}`);
          return;
        }
        const remote = settings?.ai.provider === 'openai-compatible';
        if (remote && gathered.included.length > 0 && !remoteEgressConfirmedRef.current) {
          const ok = await confirmDialog(
            `Include the contents of ${gathered.included.length} file(s) (${formatBytes(gathered.totalBytes)}) ` +
              `from "${contextCase.title}" in this request? Your AI provider is a remote endpoint ` +
              `(${safeHost(settings?.ai.endpoint)}) — these file contents will leave this machine.`,
            'Send file contents to a remote provider?'
          );
          if (!ok) {
            toast.warn('Send cancelled — file contents were not sent. Untick "Include file contents" to send metadata only.');
            return;
          }
          remoteEgressConfirmedRef.current = true;
        }
        context = composeContext(contextCase, gathered);
      } else {
        context = buildContextMeta(contextCase);
      }
    }

    const streamId = `chat-${newId()}`;
    const userMsg: DisplayMessage = { id: newId(), role: 'user', content: text };
    const assistantMsg: DisplayMessage = { id: newId(), role: 'assistant', content: '', streaming: true };
    const history: AiChatMessage[] = [...messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    const req: AiChatRequest = { context, messages: history };

    const off = window.api.ai.onChunk(({ streamId: sid, chunk, done, error }) => {
      if (sid !== streamId) return;
      if (chunk) {
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m));
      }
      if (error) {
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `${m.content}\n\n[error: ${error}]`, streaming: false } : m));
      }
      if (done) {
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, streaming: false } : m));
        setStreaming(false);
        off();
        if (activeStreamRef.current?.id === streamId) activeStreamRef.current = null;
      }
    });
    activeStreamRef.current = { id: streamId, off };

    try {
      await window.api.ai.chatStream(streamId, req);
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `[error: ${(err as Error).message}]`, streaming: false } : m));
      setStreaming(false);
      off();
      activeStreamRef.current = null;
    }
  }, [input, streaming, settings, messages, contextCase, contextCaseId, includeFiles]);

  function quickPrompt(text: string): void {
    setInput(text);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <span style={{ fontSize: 11 }}>Provider: <b>{settings?.ai.provider}</b> · model <b>{settings?.ai.model || '—'}</b></span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }}>
          Case context:&nbsp;
          <select className="ga98-text" value={contextCaseId} onChange={(e) => setContextCaseId(e.target.value)}>
            <option value="">(none)</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label
          style={{ fontSize: 11, opacity: contextCase ? 1 : 0.5 }}
          title="Include note + text-attachment contents in the context sent to the AI. Binary files are never sent; a remote provider asks for confirmation first."
        >
          <input type="checkbox" checked={includeFiles} disabled={!contextCase} onChange={(e) => setIncludeFiles(e.target.checked)} />
          &nbsp;Include file contents
        </label>
        <button onClick={() => quickPrompt('Summarise this case in 3-5 bullet points.')} disabled={!contextCase}>Summarise</button>
        <button onClick={() => quickPrompt('Draft a status report for this case suitable for an external stakeholder.')} disabled={!contextCase}>Draft report</button>
        <button onClick={() => quickPrompt('What questions should I be asking that I have not yet?')} disabled={!contextCase}>Open questions</button>
      </div>
      {contextError && (
        <div style={{ background: '#fee', color: '#900', padding: '4px 8px', fontSize: 11, borderBottom: '1px solid #c00' }}>
          Context unavailable: {contextError} — clear the dropdown or retry before sending.
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 8, background: '#fff' }}>
        {messages.length === 0 && (
          <div style={{ color: '#666', padding: 16 }}>
            Set a provider in Settings, optionally pick a case for context, and type below.
            Selecting a case sends its metadata (description, tasks, links, timeline, file list).
            Tick <b>Include file contents</b> to also send note &amp; text-attachment bodies — with a
            remote provider you&rsquo;ll confirm first, since that data leaves your machine.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 'bold', color: m.role === 'user' ? '#000080' : '#400080' }}>
              {m.role === 'user' ? 'You' : 'Assistant'}{m.streaming ? ' · streaming…' : ''}
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{m.content}</pre>
          </div>
        ))}
      </div>
      <div style={{ padding: 4, display: 'flex', gap: 4, borderTop: '1px solid #999', background: 'var(--ga98-grey)' }}>
        <textarea
          className="ga98-text"
          rows={3}
          style={{ flex: 1, height: 'auto' }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }}
          placeholder="Ask anything. Ctrl/Cmd-Enter to send."
        />
        <button onClick={() => void send()} disabled={streaming || !input.trim()}>Send</button>
      </div>
    </div>
  );
}

interface GatheredFiles {
  sections: string;
  included: { name: string; bytes: number }[];
  skipped: { name: string; reason: string }[];
  totalBytes: number;
}

/** Renderer-side soft caps. Per-item keeps one big note/log from dominating; the total
 *  budget bounds how much leaves the machine. (The main process enforces its own hard
 *  per-file cap + binary rejection independently — these are a UX/context-window concern.) */
const RENDER_PER_ITEM_CAP = 64 * 1024;
const RENDER_TOTAL_BUDGET = 256 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function safeHost(endpoint?: string): string {
  if (!endpoint) return 'the configured endpoint';
  try { return new URL(endpoint).host || endpoint; } catch { return endpoint; }
}

/** Read note bodies + text-attachment contents up to the total budget. Notes come via
 *  notes.read; attachments via files.readAttachmentText (main rejects binaries → text:null). */
async function gatherCaseFiles(c: CaseRecord): Promise<GatheredFiles> {
  const parts: string[] = [];
  const included: { name: string; bytes: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let total = 0;
  const room = (): number => RENDER_TOTAL_BUDGET - total;

  for (const n of c.notes) {
    if (room() <= 0) { skipped.push({ name: n.name, reason: 'budget' }); continue; }
    try {
      const body = await window.api.notes.read(c.id, n.name);
      if (!body) { skipped.push({ name: n.name, reason: 'empty' }); continue; }
      const capped = body.slice(0, Math.min(RENDER_PER_ITEM_CAP, room()));
      const trunc = capped.length < body.length ? ' (truncated)' : '';
      parts.push(`----- contents of note "${n.name}"${trunc} -----\n${capped}`);
      included.push({ name: n.name, bytes: capped.length });
      total += capped.length;
    } catch {
      skipped.push({ name: n.name, reason: 'read-error' });
    }
  }

  for (const a of c.attachments) {
    if (room() <= 0) { skipped.push({ name: a.originalName, reason: 'budget' }); continue; }
    try {
      const res = await window.api.files.readAttachmentText(c.id, a.fileName);
      if (res.text == null) { skipped.push({ name: a.originalName, reason: res.reason ?? 'skipped' }); continue; }
      const capped = res.text.slice(0, room());
      const trunc = (res.truncated || capped.length < res.text.length) ? ' (truncated)' : '';
      parts.push(`----- contents of ${a.originalName}${trunc} -----\n${capped}`);
      included.push({ name: a.originalName, bytes: capped.length });
      total += capped.length;
    } catch {
      skipped.push({ name: a.originalName, reason: 'read-error' });
    }
  }

  return { sections: parts.join('\n\n'), included, skipped, totalBytes: total };
}

function buildContextMeta(c: CaseRecord): string {
  const lines: string[] = [
    `Title: ${c.title}`,
    `Reference: ${c.reference}`,
    `Status: ${c.status} · Priority: ${c.priority}`,
    `Tags: ${c.tags.join(', ') || '—'}`,
    `Description: ${c.description || '—'}`,
    '',
    `Tasks (${c.tasks.length}):`,
    ...c.tasks.map((t) => `  - [${t.done ? 'x' : ' '}] ${t.text}${t.dueAt ? ` (due ${t.dueAt})` : ''}`),
    '',
    `Web links (${c.links.length}):`,
    ...c.links.map((l) => `  - ${l.title}: ${l.url}`),
    '',
    `Reminders (${c.reminders.length}):`,
    ...c.reminders.map((r) => `  - ${r.title} @ ${r.fireAt}${r.fired ? ' (fired)' : ''}`),
    '',
    `Notes (${c.notes.length}): ${c.notes.map((n) => n.name).join(', ') || '—'}`,
    `Attachments (${c.attachments.length}): ${c.attachments.map((a) => `${a.originalName} (${formatBytes(a.size)})`).join(', ') || '—'}`,
    '',
    `Recent timeline (${c.timeline.length}):`,
    ...c.timeline.slice(-10).map((e) => `  - [${e.at}] (${e.kind}) ${e.message}`)
  ];
  return lines.join('\n');
}

function composeContext(c: CaseRecord, g: GatheredFiles): string {
  let ctx = buildContextMeta(c);
  if (g.sections) {
    ctx += `\n\n===== FILE CONTENTS (${g.included.length} file${g.included.length === 1 ? '' : 's'}, ${formatBytes(g.totalBytes)}) =====\n${g.sections}`;
  }
  if (g.skipped.length) {
    ctx += `\n\nFiles present but contents NOT included (${g.skipped.length}): ` +
      g.skipped.map((s) => `${s.name} [${s.reason}]`).join(', ');
  }
  return ctx;
}
