/**
 * Isolated local-Ollama summary of a single GeoINT incident description. Deliberately NOT the
 * conversational `chatStream` gateway: no RAG, no web-search directives, no memory injection — so a
 * dossier summary can never trigger network egress beyond one loopback Ollama call, and never leaves
 * the machine. Ollama-only: an OpenAI-compatible/remote provider is treated as "no local model", so
 * unverified OSINT is never sent to a remote API. Charter: the summary is stamped "AI · unverified"
 * in the UI; it summarizes the unverified report, it does not assess its truth.
 */
import type { AiChatMessage, EventSummaryResult } from '@shared/post-mvp-types';
import { settingsStore } from '../storage/json-fs';
import { validateAiEndpoint } from '../security/validate';

const SUMMARY_SYSTEM =
  'You are summarizing a single UNVERIFIED open-source intelligence report. In one or two sentences, ' +
  'neutrally summarize ONLY what the report text states. Do not add facts, context, locations, or ' +
  'figures that are not present. Do not infer, estimate, or state casualty numbers. Do not judge ' +
  'whether the report is true. Output only the summary text.';

const TIMEOUT_MS = 30_000;

export async function summarizeEvent(description: string): Promise<EventSummaryResult> {
  const desc = (description ?? '').trim();
  const unavailable = (reason: string): EventSummaryResult => ({ available: false, reason });
  if (!desc) return unavailable('No description to summarize.');

  const s = await settingsStore.read();
  if (s.ai.provider !== 'ollama') return unavailable('Local AI model not available (set a local Ollama model in Settings → AI).');
  if (!s.ai.model?.trim()) return unavailable('No local Ollama model is configured (Settings → AI).');

  let endpoint: URL;
  try {
    endpoint = validateAiEndpoint(s.ai.endpoint, 'ollama');
  } catch (err) {
    return unavailable(`Invalid local AI endpoint: ${(err as Error).message}`);
  }

  const messages: AiChatMessage[] = [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: desc }
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL('/api/chat', endpoint).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.ai.model, messages, stream: false }),
      signal: controller.signal
    });
    if (!res.ok) return unavailable(`Local AI model returned HTTP ${res.status}.`);
    const data = (await res.json()) as { message?: { content?: unknown } };
    const text = typeof data?.message?.content === 'string' ? data.message.content.trim() : '';
    if (!text) return unavailable('Local AI model returned no summary.');
    return { available: true, text };
  } catch (err) {
    return unavailable(`Local AI model did not respond: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
