/**
 * AI Assistant — chat interface backed by the configured provider in Settings.
 * Case context is opt-in per-message — the user explicitly checks which case to include.
 * API keys live in safeStorage; the renderer never sees them in plaintext.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiChatMessage, AiChatRequest } from '@shared/post-mvp-types';
import type { CaseSummary, CaseRecord } from '@shared/types';
import { useSettings } from '../../state/store';

interface DisplayMessage extends AiChatMessage {
  id: string;
  streaming?: boolean;
}

function newId(): string {
  return `msg-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function AiAssistantModule(): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [contextCaseId, setContextCaseId] = useState('');
  const [contextCase, setContextCase] = useState<CaseRecord | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = useSettings((s) => s.settings);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);
  useEffect(() => {
    if (!contextCaseId) { setContextCase(null); return; }
    void window.api.cases.read(contextCaseId).then(setContextCase).catch(() => setContextCase(null));
  }, [contextCaseId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    if (settings?.ai.provider === 'none') {
      alert('Set an AI provider in Settings first.');
      return;
    }
    const streamId = `chat-${Date.now()}`;
    const userMsg: DisplayMessage = { id: newId(), role: 'user', content: input.trim() };
    const assistantMsg: DisplayMessage = { id: newId(), role: 'assistant', content: '', streaming: true };
    const history: AiChatMessage[] = [...messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: input.trim() }];
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    const context = contextCase ? buildContext(contextCase) : undefined;
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
      }
    });

    try {
      await window.api.ai.chatStream(streamId, req);
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `[error: ${(err as Error).message}]`, streaming: false } : m));
      setStreaming(false);
      off();
    }
  }, [input, streaming, settings, messages, contextCase]);

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
        <button onClick={() => quickPrompt('Summarise this case in 3-5 bullet points.')} disabled={!contextCaseId}>Summarise</button>
        <button onClick={() => quickPrompt('Draft a status report for this case suitable for an external stakeholder.')} disabled={!contextCaseId}>Draft report</button>
        <button onClick={() => quickPrompt('What questions should I be asking that I have not yet?')} disabled={!contextCaseId}>Open questions</button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 8, background: '#fff' }}>
        {messages.length === 0 && (
          <div style={{ color: '#666', padding: 16 }}>
            Set a provider in Settings, optionally pick a case for context, and type below.
            The case bundle (description, tasks, links, timeline, notes list) is only sent
            when you explicitly select a case here.
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

function buildContext(c: CaseRecord): string {
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
    `Notes (filenames only; no body): ${c.notes.map((n) => n.name).join(', ') || '—'}`,
    '',
    `Recent timeline (${c.timeline.length}):`,
    ...c.timeline.slice(-10).map((e) => `  - [${e.at}] (${e.kind}) ${e.message}`)
  ];
  return lines.join('\n');
}
