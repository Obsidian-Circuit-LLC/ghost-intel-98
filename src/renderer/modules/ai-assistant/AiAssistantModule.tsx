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
import type { AiChatMessage, AiChatRequest, AiConversationSummary } from '@shared/post-mvp-types';
import type { CaseSummary, CaseRecord } from '@shared/types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import { ttsSupported, listVoices, onVoicesChanged, speakAuto, cancelSpeechAll, setTtsEnginePref, type TtsVoice } from '../../audio/tts';
import { piperAvailable } from '../../audio/piper';
import { extractPdfText } from '../../lib/pdfExtract';
import { loadAttachmentBytes } from '../../lib/attachmentBytes';
import { createVoskRecognizer } from '../../voice/recognizer';
import { VoiceConversation, type VoiceMode, type VoiceState } from '../../voice/conversation';

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
  // Saved-conversation memory (ChatGPT-style). convoIdRef is the id of the chat currently being
  // built; null until the first message is sent. titleRef holds the title (first user message).
  const [convos, setConvos] = useState<AiConversationSummary[]>([]);
  const convoIdRef = useRef<string | null>(null);
  const titleRef = useRef<string>('');
  // Only persist when a new message actually happened — NOT when loadConvo() repopulates
  // messages (that re-encrypted the store and, at the cap, could evict a chat just by browsing).
  const dirtyRef = useRef(false);
  const [includeFiles, setIncludeFiles] = useState(false);
  const activeStreamRef = useRef<{ id: string; off: () => void } | null>(null);
  // Set by STFU/unmount so a `done` event already queued in the event loop can't start TTS
  // after the user explicitly stopped (TOCTOU between cancel and the dispatched done event).
  const stoppedRef = useRef(false);
  // One-time-per-session confirmation that file CONTENTS may leave the machine to a remote provider.
  const remoteEgressConfirmedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = useSettings((s) => s.settings);
  const patchSettings = useSettings((s) => s.patch);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [piperOk, setPiperOk] = useState(false);
  // Voice conversation (offline STT → AI → TTS). Mode is ephemeral per session.
  const [voiceMode, setVoiceMode] = useState<VoiceMode | 'off'>('off');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voicePartial, setVoicePartial] = useState('');
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
  const convoRef = useRef<VoiceConversation | null>(null);
  // The in-flight voice AI stream, so Stop-voice / unmount can actually abort it (it doesn't go
  // through activeStreamRef). And a guard so a double-click during model load can't start twice.
  const voiceStreamRef = useRef<{ id: string; off: () => void } | null>(null);
  const voiceStartingRef = useRef(false);
  // Latest messages, read by askOnce without re-binding it on every message.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);
  useEffect(() => { void window.api.voice.modelStatus().then((s) => setModelInstalled(s.installed)); }, []);

  // --- saved-conversation memory ---
  const refreshConvos = useCallback(() => { void window.api.aiConvos.list().then(setConvos).catch(() => {}); }, []);
  useEffect(() => { refreshConvos(); }, [refreshConvos]);

  // Auto-save the active conversation whenever it settles (stream finished) and has content.
  // convoIdRef is assigned in send() when the first message goes out.
  useEffect(() => {
    if (streaming || messages.length === 0 || !convoIdRef.current || !dirtyRef.current) return;
    const payload = {
      id: convoIdRef.current,
      title: titleRef.current || messages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'Conversation',
      messages: messages.map(({ role, content }) => ({ role, content }))
    };
    void window.api.aiConvos.save(payload).then(() => { dirtyRef.current = false; refreshConvos(); }).catch(() => {});
  }, [streaming, messages, refreshConvos]);

  function newChat(): void {
    convoIdRef.current = null;
    titleRef.current = '';
    dirtyRef.current = false;
    setMessages([]);
  }
  async function loadConvo(id: string): Promise<void> {
    try {
      const c = await window.api.aiConvos.get(id);
      if (!c) return;
      convoIdRef.current = c.id;
      titleRef.current = c.title;
      dirtyRef.current = false; // loading is not a change — don't trigger a re-save
      setMessages(c.messages.map((m) => ({ ...m, id: newId() })));
    } catch (err) { toast.error(`Couldn't open conversation: ${(err as Error).message}`); }
  }
  async function deleteConvo(id: string): Promise<void> {
    const ok = await confirmDialog('Delete this saved conversation?', 'Delete conversation');
    if (!ok) return;
    try {
      await window.api.aiConvos.delete(id);
      if (convoIdRef.current === id) newChat();
      refreshConvos();
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`); }
  }

  // Populate the offline voice list and keep it current. Chromium fills voices asynchronously and
  // the OS set can change at runtime, so we do a one-shot initial load (which has its own
  // populate-or-timeout window) AND keep a live `voiceschanged` subscription — otherwise a voice
  // that arrives after the initial window is lost and the picker silently never appears.
  useEffect(() => {
    if (!ttsSupported()) { setVoicesLoaded(true); return; }
    let active = true;
    void listVoices().then((vs) => { if (active) { setVoices(vs); setVoicesLoaded(true); } });
    const unsub = onVoicesChanged((vs) => { if (active) { setVoices(vs); setVoicesLoaded(true); } });
    return () => { active = false; unsub(); };
  }, []);

  async function setTts(patch: { ttsEnabled?: boolean; ttsVoiceUri?: string | null; ttsRate?: number; ttsEngine?: 'auto' | 'system' | 'piper' }): Promise<void> {
    if (!settings) return;
    if (patch.ttsEnabled === false) cancelSpeechAll();
    if (patch.ttsEngine) setTtsEnginePref(patch.ttsEngine);
    await patchSettings({ ai: { ...settings.ai, ...patch } });
  }

  // Probe whether the bundled Piper voice is installed (gates the engine selector) and keep the
  // dispatcher's engine preference in sync with the saved setting.
  useEffect(() => { void piperAvailable().then(setPiperOk); }, []);
  useEffect(() => { if (settings?.ai.ttsEngine) setTtsEnginePref(settings.ai.ttsEngine); }, [settings?.ai.ttsEngine]);

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
      cancelSpeechAll();
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
    // First message of a fresh chat → mint a conversation id + title (used by the auto-save effect).
    if (!convoIdRef.current) { convoIdRef.current = newId(); titleRef.current = text.slice(0, 60); }
    dirtyRef.current = true; // a real new message → the conversation should be saved
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    stoppedRef.current = false;

    const req: AiChatRequest = { context, messages: history };

    // Accumulate the full reply locally so we can speak it on `done` without reading
    // back through React state (avoids StrictMode double-speak + stale closures).
    let acc = '';
    let errored = false;
    // Coalesce token bursts into ~16 fps state flushes. A per-token setMessages re-renders an
    // ever-growing <pre> — O(n²) over a long reply — which saturated the main thread so the STFU
    // click couldn't get a turn ("stops working on very large output"). Throttling keeps the UI
    // and the STFU button responsive; `acc` still holds the full text for TTS. A pending flush is
    // dropped once the user has stopped, so it can't overwrite the "[stopped]" bubble.
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushNow = (): void => {
      flushTimer = null;
      if (stoppedRef.current) return;
      setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: acc } : m));
    };
    const scheduleFlush = (): void => { if (flushTimer === null && !stoppedRef.current) flushTimer = setTimeout(flushNow, 60); };
    const clearFlush = (): void => { if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } };
    const off = window.api.ai.onChunk(({ streamId: sid, chunk, done, error }) => {
      if (sid !== streamId) return;
      if (chunk) { acc += chunk; scheduleFlush(); }
      if (error) {
        clearFlush();
        errored = true;
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: `${acc}\n\n[error: ${error}]`, streaming: false } : m));
      }
      if (done) {
        clearFlush();
        setMessages((prev) => prev.map((m) => m.id === assistantMsg.id ? { ...m, content: errored ? m.content : acc, streaming: false } : m));
        setStreaming(false);
        off();
        if (activeStreamRef.current?.id === streamId) activeStreamRef.current = null;
        const st = useSettings.getState().settings;
        if (!stoppedRef.current && st?.ai.ttsEnabled && acc.trim()) {
          void speakAuto(acc, { voiceURI: st.ai.ttsVoiceUri, rate: st.ai.ttsRate }).then((r) => {
            if (!r.spoken && (r.reason === 'remote-blocked' || r.reason === 'no-local-voice')) {
              toast.warn('Voice off: no on-device voice available. Install an offline/Natural voice in Windows settings, or use the bundled Piper voice — cloud voices are blocked by design.');
            }
          });
        }
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

  // STFU — abort the in-flight generation immediately. The cancel IPC aborts the
  // upstream fetch (AbortController in main); we also finalize the UI locally rather
  // than wait for a possibly-never-arriving `done`, dropping the chunk listener so a
  // late tail can't keep mutating the bubble.
  const stop = useCallback(() => {
    stoppedRef.current = true;
    cancelSpeechAll();
    const active = activeStreamRef.current;
    if (!active) return;
    void window.api.ai.cancel(active.id).catch(() => {});
    active.off();
    activeStreamRef.current = null;
    setMessages((prev) => prev.map((m) => m.streaming
      ? { ...m, content: `${m.content}${m.content ? '\n\n' : ''}[stopped]`, streaming: false }
      : m));
    setStreaming(false);
  }, []);

  // One-shot ask used by the voice conversation: pushes the user transcript + a streaming
  // assistant bubble into the transcript, streams the reply, and resolves the full text so the
  // controller can speak it. Voice sends case METADATA context only (never file contents) so a
  // remote provider can't trigger a blocking egress dialog mid-conversation.
  const askOnce = useCallback((text: string): Promise<string> => {
    return new Promise((resolve) => {
      const st = useSettings.getState().settings;
      if (!st || st.ai.provider === 'none') { resolve(''); return; }
      const streamId = `voice-${newId()}`;
      const userMsg: DisplayMessage = { id: newId(), role: 'user', content: text };
      const asstMsg: DisplayMessage = { id: newId(), role: 'assistant', content: '', streaming: true };
      const history: AiChatMessage[] = [
        ...messagesRef.current.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: text }
      ];
      if (!convoIdRef.current) { convoIdRef.current = newId(); titleRef.current = text.slice(0, 60); }
      setMessages((prev) => [...prev, userMsg, asstMsg]);
      const context = contextCase ? buildContextMeta(contextCase) : undefined;
      let acc = '';
      let settled = false;
      const finish = (text: string): void => {
        if (settled) return;
        settled = true;
        off();
        if (voiceStreamRef.current?.id === streamId) voiceStreamRef.current = null;
        // Mark dirty only at turn-completion so the auto-save effect persists the voice exchange
        // ONCE here, not on every streamed chunk (chunks update messages with dirty still false).
        dirtyRef.current = true;
        setMessages((prev) => prev.map((m) => m.id === asstMsg.id ? { ...m, streaming: false } : m));
        resolve(text);
      };
      const off = window.api.ai.onChunk(({ streamId: sid, chunk, done, error }) => {
        if (sid !== streamId) return;
        if (chunk) { acc += chunk; setMessages((prev) => prev.map((m) => m.id === asstMsg.id ? { ...m, content: m.content + chunk } : m)); }
        // Treat error as TERMINAL (resolve + drop the listener) — a stray error without a paired
        // `done` would otherwise hang the conversation in 'thinking' and leak this listener.
        if (error) { setMessages((prev) => prev.map((m) => m.id === asstMsg.id ? { ...m, content: `${m.content}\n\n[error: ${error}]` } : m)); finish(acc); return; }
        if (done) finish(acc);
      });
      voiceStreamRef.current = { id: streamId, off };
      window.api.ai.chatStream(streamId, { context, messages: history })
        .catch((e) => finish(`[error: ${(e as Error).message}]`));
    });
  }, [contextCase]);

  const stopVoice = useCallback(() => {
    cancelSpeechAll();
    // Abort any in-flight voice AI request (it isn't tracked by activeStreamRef / STFU).
    const vs = voiceStreamRef.current;
    if (vs) { void window.api.ai.cancel(vs.id).catch(() => {}); vs.off(); voiceStreamRef.current = null; }
    void convoRef.current?.stop();
    convoRef.current = null;
    setVoiceMode('off');
    setVoiceState('idle');
    setVoicePartial('');
  }, []);

  const startVoice = useCallback(async (mode: VoiceMode) => {
    if (settings?.ai.provider === 'none') { toast.warn('Set an AI provider in Settings first.'); return; }
    // Guard against a double-click during the (slow) model load creating two recognizers/mics.
    if (voiceMode !== 'off' || convoRef.current || voiceStartingRef.current) return;
    voiceStartingRef.current = true;
    try {
      // Race the model load against a timeout so a corrupt/stalled model can't hang silently.
      const recognizer = await Promise.race([
        createVoskRecognizer(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('model load timed out')), 30000))
      ]);
      const st = useSettings.getState().settings;
      const convo = new VoiceConversation({
        recognizer,
        mode,
        ask: askOnce,
        speak: (t) => new Promise<void>((res) => {
          void speakAuto(t, { voiceURI: st?.ai.ttsVoiceUri, rate: st?.ai.ttsRate, onEnd: res }).then((r) => {
            if (!r.spoken) res();
          });
        }),
        onState: setVoiceState,
        onPartial: setVoicePartial,
        onError: (e) => toast.error(`Voice: ${e.message}`)
      });
      convoRef.current = convo;
      setVoiceMode(mode);
      await convo.start();
    } catch (err) {
      toast.error(`Could not start voice: ${(err as Error).message}. Is the Vosk model bundled and mic access allowed?`);
      stopVoice();
    } finally {
      voiceStartingRef.current = false;
    }
  }, [voiceMode, settings, askOnce, stopVoice]);

  // Tear voice down on unmount: abort the in-flight voice stream + stop the recognizer/mic.
  useEffect(() => () => {
    const vs = voiceStreamRef.current;
    if (vs) { void window.api.ai.cancel(vs.id).catch(() => {}); vs.off(); voiceStreamRef.current = null; }
    void convoRef.current?.stop();
  }, []);

  // Push-to-talk press/release via pointer events with a document-level pointerup, so dragging
  // the cursor off the button doesn't truncate the utterance (mouseLeave would).
  const pttHoldingRef = useRef(false);
  const pttDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    pttHoldingRef.current = true;
    convoRef.current?.pttDown();
    const up = (): void => {
      if (!pttHoldingRef.current) return;
      pttHoldingRef.current = false;
      convoRef.current?.pttUp();
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointerup', up);
  }, []);

  function quickPrompt(text: string): void {
    setInput(text);
  }

  // Right-click → copy. navigator.clipboard first; fall back to a hidden textarea +
  // execCommand so copy works even if Electron doesn't treat the app origin as "secure"
  // or the window isn't focused. Stays fully offline either way.
  const [msgMenu, setMsgMenu] = useState<{ x: number; y: number; content: string } | null>(null);
  async function copyText(text: string): Promise<void> {
    setMsgMenu(null);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied.');
      return;
    } catch { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Copied.');
    } catch (err) {
      toast.error(`Copy failed: ${(err as Error).message}`);
    }
  }
  function copyAll(): string {
    return messages.map((m) => `## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${m.content}`).join('\n\n');
  }

  async function exportChat(): Promise<void> {
    const text = messages.map((m) => `## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${m.content}`).join('\n\n');
    try {
      const saved = await window.api.export.text('ai-conversation.txt', text);
      if (saved) toast.success(`Saved ${saved}.`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Conversation memory sidebar (ChatGPT-style): new chat, the saved list, delete. */}
      <div className="ga98-pane" style={{ width: 170, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <button onClick={newChat} style={{ margin: 4 }} title="Start a new conversation (the current one is saved)">+ New chat</button>
        <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
          {convos.length === 0 && <li style={{ color: '#666', fontSize: 11 }}>No saved chats yet.</li>}
          {convos.map((c) => (
            <li key={c.id} data-selected={c.id === convoIdRef.current} title={`${c.messageCount} message${c.messageCount === 1 ? '' : 's'} · ${new Date(c.updatedAt).toLocaleString()}`}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 11 }} onClick={() => void loadConvo(c.id)}>{c.title}</span>
              <button onClick={() => void deleteConvo(c.id)} style={{ minWidth: 0, padding: '0 5px' }} title="Delete this conversation">×</button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0 }}>
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
        <button onClick={() => void exportChat()} disabled={messages.length === 0} title="Save this conversation to a file">Export…</button>
        {(ttsSupported() || piperOk) && (
          <>
            <button
              onClick={() => void setTts({ ttsEnabled: !settings?.ai.ttsEnabled })}
              title="Speak AI responses aloud (bundled offline Piper voice, or your OS voices)"
              style={{ fontWeight: settings?.ai.ttsEnabled ? 'bold' : 'normal' }}
            >
              {settings?.ai.ttsEnabled ? '🔊 Voice' : '🔇 Voice'}
            </button>
            {settings?.ai.ttsEnabled && piperOk && (
              <select
                className="ga98-text"
                style={{ maxWidth: 130 }}
                value={settings?.ai.ttsEngine ?? 'auto'}
                onChange={(e) => void setTts({ ttsEngine: e.target.value as 'auto' | 'system' | 'piper' })}
                title="Voice engine. Piper is a bundled, fully-offline neural voice. System uses your OS voices."
              >
                <option value="auto">Voice: Auto (Piper)</option>
                <option value="piper">Voice: Piper (neural)</option>
                <option value="system">Voice: System</option>
              </select>
            )}
            {settings?.ai.ttsEnabled && piperOk && (settings?.ai.ttsEngine ?? 'auto') !== 'system' && (
              <span style={{ fontSize: 11, opacity: 0.7 }} title="Bundled neural voice — runs entirely on-device, no network.">🧠 offline neural</span>
            )}
            {settings?.ai.ttsEnabled && (!piperOk || (settings?.ai.ttsEngine ?? 'auto') === 'system') && (
              voices.some((v) => !v.remote) ? (
                <select
                  className="ga98-text"
                  style={{ maxWidth: 160 }}
                  value={settings?.ai.ttsVoiceUri ?? ''}
                  onChange={(e) => void setTts({ ttsVoiceUri: e.target.value || null })}
                  title="On-device voices only. Cloud/'online' voices are hidden by design (no-cloud). Install Windows Natural voices via Settings → Accessibility."
                >
                  <option value="">(default on-device voice)</option>
                  {voices.filter((v) => !v.remote).map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                  ))}
                </select>
              ) : voicesLoaded ? (
                // Don't silently hide the control: say *why* there's nothing to pick. Cloud voices
                // are filtered by design (no-cloud), so "no on-device voice" is the actual state.
                <span
                  style={{ fontSize: 11, opacity: 0.8, maxWidth: 280 }}
                  title="Cloud/'online' voices are blocked by design (no-cloud). Install an on-device voice: Windows → Settings → Accessibility → Speech (or Narrator → add natural voices)."
                >
                  ⚠ No on-device voice found — install Windows Natural voices (cloud voices are blocked by design).
                </span>
              ) : null
            )}
          </>
        )}
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
          <div
            key={m.id}
            style={{ marginBottom: 12 }}
            onContextMenu={(e) => { e.preventDefault(); setMsgMenu({ x: e.clientX, y: e.clientY, content: m.content }); }}
            title="Right-click to copy"
          >
            <div style={{ fontSize: 11, fontWeight: 'bold', color: m.role === 'user' ? '#000080' : '#400080' }}>
              {m.role === 'user' ? 'You' : 'Assistant'}{m.streaming ? ' · streaming…' : ''}
            </div>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{m.content}</pre>
          </div>
        ))}
      </div>
      {ttsSupported() && (
        <div style={{ padding: '3px 6px', display: 'flex', gap: 6, alignItems: 'center', borderTop: '1px solid #999', background: 'var(--ga98-grey)', fontSize: 11, flexWrap: 'wrap' }}>
          {modelInstalled === false ? (
            <span style={{ color: '#900' }} title="Vosk speech model not bundled">
              🎙 Voice input needs a Vosk model in <code>resources/vosk/</code> — speak-aloud (TTS) still works.
            </span>
          ) : voiceMode === 'off' ? (
            <>
              <span>Voice conversation:</span>
              <button onClick={() => void startVoice('continuous')} disabled={modelInstalled === null} title="Hands-free: mic stays open; the AI listens, answers, and speaks while you read">🎙 Hands-free</button>
              <button onClick={() => void startVoice('ptt')} disabled={modelInstalled === null} title="Push-to-talk: hold a button to speak">🎤 Push-to-talk</button>
            </>
          ) : (
            <>
              <button onClick={stopVoice} style={{ fontWeight: 'bold' }}>■ Stop voice</button>
              {voiceMode === 'ptt' && (
                <button
                  onPointerDown={pttDown}
                  disabled={voiceState === 'thinking' || voiceState === 'speaking'}
                  title="Hold while speaking"
                >🎤 Hold to talk</button>
              )}
              <span style={{ opacity: 0.85 }}>
                {voiceMode === 'continuous' ? 'hands-free' : 'push-to-talk'} · <b>{voiceState}</b>
                {voicePartial ? ` — “${voicePartial}”` : ''}
              </span>
            </>
          )}
        </div>
      )}
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
        {streaming
          ? (
            <button
              onClick={stop}
              title="Stop the AI right now — aborts the request"
              style={{ minWidth: 64, fontWeight: 'bold', color: '#a00' }}
            >
              STFU
            </button>
          )
          : <button onClick={() => void send()} disabled={!input.trim()}>Send</button>}
      </div>

      {msgMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29999 }} onMouseDown={() => setMsgMenu(null)} />
          <div className="ga98-context-menu" style={{ left: msgMenu.x, top: msgMenu.y }}>
            <button className="ga98-context-menu-item" onClick={() => void copyText(msgMenu.content)}>Copy message</button>
            <button className="ga98-context-menu-item" onClick={() => void copyText(copyAll())}>Copy whole conversation</button>
          </div>
        </>
      )}
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

function isPdfName(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

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
    // PDFs are binary, so readAttachmentText rejects them; pull their text layer with pdf.js
    // instead (text-layer only — a scanned/image PDF yields nothing and is marked accordingly).
    if (isPdfName(a.originalName) || isPdfName(a.fileName)) {
      try {
        const bytes = await loadAttachmentBytes(c.id, a.fileName);
        const extracted = await extractPdfText(bytes, { maxChars: Math.min(RENDER_PER_ITEM_CAP, room()) });
        if (!extracted.trim()) { skipped.push({ name: a.originalName, reason: 'pdf-no-text-layer' }); continue; }
        const capped = extracted.slice(0, room());
        const trunc = capped.length < extracted.length ? ' (truncated)' : '';
        parts.push(`----- text of ${a.originalName} (PDF)${trunc} -----\n${capped}`);
        included.push({ name: a.originalName, bytes: capped.length });
        total += capped.length;
      } catch {
        skipped.push({ name: a.originalName, reason: 'pdf-error' });
      }
      continue;
    }
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
