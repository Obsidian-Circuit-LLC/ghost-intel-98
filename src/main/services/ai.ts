/**
 * AI Assistant — main-process gateway to Ollama (localhost) or any OpenAI-compatible endpoint.
 * The renderer never sees the API key; it lives in secrets.enc as `ai.apiKey`.
 * Streams chunks back via ai:onChatChunk events.
 */

import type { BrowserWindow } from 'electron';
import type { AiChatMessage, AiChatRequest } from '@shared/post-mvp-types';
import { channels } from '@shared/ipc-contracts';
import { secretStore } from '../secrets';
import { settingsStore } from '../storage/json-fs';

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

  const controller = new AbortController();
  sessions.set(streamId, { controller });
  try {
    const messages: AiChatMessage[] = [];
    if (s.ai.defaultSystemPrompt) messages.push({ role: 'system', content: s.ai.defaultSystemPrompt });
    if (req.context) messages.push({ role: 'system', content: `Case context the user explicitly shared:\n${req.context}` });
    messages.push(...req.messages);

    if (provider === 'ollama') {
      await streamOllama(s.ai.endpoint, s.ai.model || 'llama3', messages, controller.signal, (chunk) =>
        emit(getWindow, streamId, { chunk })
      );
    } else {
      const apiKey = await secretStore.get('ai.apiKey');
      await streamOpenAi(s.ai.endpoint, s.ai.model || 'gpt-4o-mini', messages, apiKey ?? '', controller.signal, (chunk) =>
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

function emit(getWindow: () => BrowserWindow | null, streamId: string, payload: { chunk?: string; done?: boolean; error?: string }): void {
  const win = getWindow();
  if (!win) return;
  win.webContents.send(channels.ai.onChatChunk, { streamId, ...payload });
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
}

async function streamOllama(endpoint: string, model: string, messages: AiChatMessage[], signal: AbortSignal, onChunk: (s: string) => void): Promise<void> {
  const url = endpoint.replace(/\/$/, '') + '/api/chat';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`Ollama: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t) as OllamaChunk;
        if (parsed.message?.content) onChunk(parsed.message.content);
      } catch {
        // skip malformed
      }
    }
  }
}

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

async function streamOpenAi(endpoint: string, model: string, messages: AiChatMessage[], apiKey: string, signal: AbortSignal, onChunk: (s: string) => void): Promise<void> {
  const url = endpoint.replace(/\/$/, '') + '/v1/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`OpenAI-compatible: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      try {
        const parsed = JSON.parse(payload) as OpenAiChunk;
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // skip malformed
      }
    }
  }
}
