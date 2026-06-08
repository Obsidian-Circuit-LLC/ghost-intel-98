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
import { recall, formatRecall } from './memory/retriever';

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
    if (s.ai.useMemory && provider === 'ollama') {
      try {
        const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          const block = formatRecall(await recall(lastUser.content, { k: 6 }));
          if (block) messages.push({ role: 'system', content: block });
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
    emit(getWindow, streamId, { done: true });
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

function emit(getWindow: () => BrowserWindow | null, streamId: string, payload: { chunk?: string; done?: boolean; error?: string }): void {
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
