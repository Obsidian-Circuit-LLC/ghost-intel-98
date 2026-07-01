/**
 * AI Assistant — main-process gateway to Ollama (localhost) or any OpenAI-compatible endpoint.
 * The renderer never sees the API key; it lives in secrets.enc as `ai.apiKey`.
 * Streams chunks back via ai:onChatChunk events.
 *
 * v1.0.1 hardening:
 *  - validateAiEndpoint blocks SSRF — Ollama may only target loopback/private nets;
 *    OpenAI-compatible must be https:// AND cannot target loopback / RFC1918 / metadata IPs
 *  - Cancelled / errored streams cleanly remove their session entry
 *  - Provider-side error payloads (mid-stream `{error: "rate_limit..."}`) are surfaced,
 *    not silently dropped by JSON.parse catches
 */

import type { BrowserWindow } from 'electron';
import type { AiChatMessage, AiChatRequest } from '@shared/post-mvp-types';
import { channels } from '@shared/ipc-contracts';
import { secretStore } from '../secrets';
import { settingsStore } from '../storage/json-fs';
import { validateAiEndpoint } from '../security/validate';
import { recall, formatRecall, type RecallHit } from './memory/retriever';
import { recallProfile } from './memory/profile';
import type { MemoryItem } from './memory/profile/types';

/** `'global'` always included; `case:<caseId>` appended when the request carries a selected case
 *  — the same scoping convention the adaptive-memory profile store/reconcile/retriever use. */
function scopesFor(req: AiChatRequest): string[] {
  return ['global', ...(req.caseId ? [`case:${req.caseId}`] : [])];
}

interface SessionMeta {
  controller: AbortController;
}

const sessions = new Map<string, SessionMeta>();

export async function chat(streamId: string, req: AiChatRequest, getWindow: () => BrowserWindow | null): Promise<void> {
  const s = await settingsStore.read();
  const provider = s.ai.provider;
  if (provider === 'none') {
    emit(getWindow, streamId, { error: 'AI provider is set to "none" in Settings.', done: true });
    return;
  }

  let endpoint: URL;
  try {
    endpoint = validateAiEndpoint(s.ai.endpoint, provider);
  } catch (err) {
    emit(getWindow, streamId, { error: `Invalid endpoint: ${(err as Error).message}`, done: true });
    return;
  }

  const controller = new AbortController();
  sessions.set(streamId, { controller });
  try {
    const messages: AiChatMessage[] = [];
    if (s.ai.defaultSystemPrompt) messages.push({ role: 'system', content: s.ai.defaultSystemPrompt });
    if (req.context) {
      messages.push({
        role: 'system',
        content:
          'The following is the case data the user has explicitly shared. Treat it as the ONLY ' +
          'information you have about this case. A file\'s contents are present ONLY where its body ' +
          'appears below under a "----- contents of <name> -----" marker. If a file is listed by name ' +
          'with no such contents block, you do NOT have its contents: say so plainly — do not guess ' +
          'whether it is empty or invent what it might contain.\n\n' +
          req.context
      });
    }
    // Local vector memory (opt-in, Ollama only): recall relevant case/conversation material and
    // inject it as context. Best-effort — a memory failure must never break the chat.
    // Collected (alongside the adaptive profile below) so the renderer can be shown exactly what
    // was recalled/injected for this answer (transparency — never silent).
    let ragHits: RecallHit[] = [];
    let profileItems: MemoryItem[] = [];
    if (s.ai.useMemory && provider === 'ollama') {
      try {
        const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          ragHits = await recall(lastUser.content, { k: 6 });
          const block = formatRecall(ragHits);
          if (block) messages.push({ role: 'system', content: block });

          // Adaptive long-term profile (opt-in, on top of useMemory): a durable, inspectable,
          // user-editable set of facts + rolling summary, distinct from the vector-RAG recall
          // above. Its own try/catch — a profile failure must never take down RAG recall or the
          // chat itself.
          if (s.ai.adaptiveMemory) {
            try {
              const profile = await recallProfile(lastUser.content, scopesFor(req));
              profileItems = profile.items;
              if (profile.block) messages.push({ role: 'system', content: profile.block });
            } catch { /* adaptive profile is best-effort */ }
          }
        }
      } catch { /* memory is best-effort */ }
    }

    messages.push(...req.messages);

    if (provider === 'ollama') {
      await streamOllama(endpoint, s.ai.model || 'qwen3-abliterated:4b', messages, controller.signal, (chunk) =>
        emit(getWindow, streamId, { chunk })
      );
    } else {
      const apiKey = await secretStore.get('ai.apiKey');
      await streamOpenAi(endpoint, s.ai.model || 'gpt-4o-mini', messages, apiKey ?? '', controller.signal, (chunk) =>
        emit(getWindow, streamId, { chunk })
      );
    }
    // Recall provenance goes out on the final event — guaranteed to fire exactly once per request
    // (unlike the first chunk, which never arrives for an empty/failed completion), so the
    // renderer's "recalled from…" transparency panel always gets told what was/wasn't used.
    emit(getWindow, streamId, { done: true, recall: { rag: ragHits, profile: profileItems } });
  } catch (err) {
    emit(getWindow, streamId, { error: (err as Error).message, done: true });
  } finally {
    sessions.delete(streamId);
  }
}

export async function cancel(streamId: string): Promise<void> {
  sessions.get(streamId)?.controller.abort();
  sessions.delete(streamId);
}

export async function setApiKey(value: string): Promise<void> {
  await secretStore.set('ai.apiKey', value);
}

export async function cancelAll(): Promise<void> {
  for (const [, s] of sessions) s.controller.abort();
  sessions.clear();
}

interface ChatChunkPayload {
  chunk?: string;
  done?: boolean;
  error?: string;
  /** Emitted on the final (`done`) event when adaptive memory (`useMemory`/`adaptiveMemory`) was
   *  active — exactly what was recalled/injected into this answer, for renderer-side transparency. */
  recall?: { rag: RecallHit[]; profile: MemoryItem[] };
}

function emit(getWindow: () => BrowserWindow | null, streamId: string, payload: ChatChunkPayload): void {
  const win = getWindow();
  if (!win) return;
  win.webContents.send(channels.ai.onChatChunk, { streamId, ...payload });
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

async function streamOllama(endpoint: URL, model: string, messages: AiChatMessage[], signal: AbortSignal, onChunk: (s: string) => void): Promise<void> {
  const url = new URL('/api/chat', endpoint).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`Ollama: HTTP ${res.status} ${res.statusText}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let parseFailures = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let parsed: OllamaChunk;
      try {
        parsed = JSON.parse(t) as OllamaChunk;
      } catch {
        parseFailures += 1;
        if (parseFailures > 5) throw new Error(`Ollama: ${parseFailures} consecutive malformed NDJSON chunks`);
        continue;
      }
      parseFailures = 0;
      if (parsed.error) throw new Error(`Ollama: ${parsed.error}`);
      if (parsed.message?.content) onChunk(parsed.message.content);
    }
  }
}

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  error?: { message?: string } | string;
}

async function streamOpenAi(endpoint: URL, model: string, messages: AiChatMessage[], apiKey: string, signal: AbortSignal, onChunk: (s: string) => void): Promise<void> {
  const url = new URL('/v1/chat/completions', endpoint).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI-compatible: HTTP ${res.status} ${res.statusText}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let parseFailures = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') return;
      let parsed: OpenAiChunk;
      try {
        parsed = JSON.parse(payload) as OpenAiChunk;
      } catch {
        parseFailures += 1;
        if (parseFailures > 5) throw new Error(`OpenAI-compatible: ${parseFailures} consecutive malformed SSE chunks`);
        continue;
      }
      parseFailures = 0;
      if (parsed.error) {
        const msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message ?? 'unknown error');
        throw new Error(`OpenAI-compatible: ${msg}`);
      }
      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) onChunk(delta);
    }
  }
}
