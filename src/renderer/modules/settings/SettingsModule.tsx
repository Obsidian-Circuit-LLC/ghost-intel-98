/**
 * Settings — sound, theme, startup, default case folder, shortcuts editor,
 * and provider stubs for AI / Mail / Browser.
 *
 * v1.0.1: shortcut label/target edits now happen against a local-only state and
 * commit on blur, reading the latest local snapshot via a ref. Eliminates the
 * stale-closure race where rapid edits to two inputs would overwrite each other.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessShortcut, AppSettings } from '@shared/types';
import logoUrl from '../../assets/logo.png';

function newShortcutId(): string {
  return `sc-${crypto.randomUUID()}`;
}

export function SettingsModule(): JSX.Element {
  const [s, setS] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<{ version: string; userData: string; platform: NodeJS.Platform; secretBackend?: string } | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const latest = useRef<AppSettings | null>(null);

  const load = useCallback(async () => {
    const next = await window.api.settings.read();
    setS(next);
    latest.current = next;
    setInfo(await window.api.system.appInfo() as Awaited<ReturnType<typeof window.api.system.appInfo>> & { secretBackend?: string });
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(p: Partial<AppSettings>): Promise<void> {
    const base = latest.current ?? s;
    if (!base) return;
    const merged: AppSettings = {
      ...base,
      ...p,
      ai: { ...base.ai, ...(p.ai ?? {}) },
      mail: { ...base.mail, ...(p.mail ?? {}) },
      browser: { ...base.browser, ...(p.browser ?? {}) },
      shortcuts: p.shortcuts ?? base.shortcuts
    };
    latest.current = merged;
    setS(merged);
    const written = await window.api.settings.update(p);
    latest.current = written;
    setS(written);
  }

  function updateShortcutLocal(id: string, key: 'label' | 'target', value: string): void {
    setS((prev) => {
      if (!prev) return prev;
      const next = { ...prev, shortcuts: prev.shortcuts.map((x) => x.id === id ? { ...x, [key]: value } : x) };
      latest.current = next;
      return next;
    });
  }

  function commitShortcuts(): void {
    if (!latest.current) return;
    void patch({ shortcuts: latest.current.shortcuts });
  }

  if (!s) return <div className="ga98-stack">Loading…</div>;

  return (
    <div className="ga98-stack">
      <fieldset>
        <legend>About</legend>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <img src={logoUrl} alt="Ghost Access 98 logo" style={{ width: 96, height: 96, imageRendering: 'pixelated', border: '1px solid #808080' }} />
          <div>
            <h3 style={{ margin: '0 0 4px 0' }}>Ghost Access 98</h3>
            <p style={{ margin: 0 }}>v{info?.version ?? '—'} · {info?.platform ?? '—'}</p>
            <p style={{ margin: 0, fontSize: 11 }}>MIT licensed · © 2026 Obsidian Circuit</p>
          </div>
        </div>
        <p style={{ fontSize: 11 }}>Data root: <code>{info?.userData ?? '—'}</code></p>
        <p style={{ fontSize: 11 }}>
          Secrets backend: <code>{info?.secretBackend ?? '—'}</code>
          {info?.secretBackend === 'basic_text' && (
            <span style={{ color: '#900' }}> — WARNING: no OS keyring detected; secrets are obfuscated, not encrypted against a local attacker. Install gnome-keyring or KWallet.</span>
          )}
          {info?.secretBackend === 'unavailable' && (
            <span style={{ color: '#900' }}> — WARNING: encryption backend is unavailable. Mail / SSH / AI credentials cannot be saved.</span>
          )}
        </p>
      </fieldset>

      <fieldset>
        <legend>Sound</legend>
        <label><input type="checkbox" checked={s.soundEnabled} onChange={(e) => void patch({ soundEnabled: e.target.checked })} /> Sounds on</label>
        <br />
        <label><input type="checkbox" checked={s.startupSoundEnabled} onChange={(e) => void patch({ startupSoundEnabled: e.target.checked })} /> Play startup chime on launch</label>
      </fieldset>

      <fieldset>
        <legend>Theme</legend>
        <label>Intensity:&nbsp;
          <select className="ga98-text" value={s.themeIntensity} onChange={(e) => void patch({ themeIntensity: e.target.value as AppSettings['themeIntensity'] })}>
            <option value="lite">Lite</option>
            <option value="classic">Classic</option>
            <option value="maximum">Maximum</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Default case folder</legend>
        <p style={{ fontSize: 11 }}>By default cases live under the OS userData folder. Override is stored but not yet wired (planned for a future release).</p>
        <input className="ga98-text" style={{ width: '100%' }} value={s.caseFolderOverride ?? ''}
          onChange={(e) => void patch({ caseFolderOverride: e.target.value || null })}
          placeholder="(default: OS userData)" />
      </fieldset>

      <fieldset>
        <legend>Access menu shortcuts</legend>
        <ul className="ga98-list">
          {s.shortcuts.map((sc, i) => (
            <li key={sc.id}>
              <span style={{ width: 50, fontSize: 11, opacity: 0.7 }}>[{sc.kind}]</span>
              <input className="ga98-text" style={{ flex: 1 }} value={sc.label}
                onChange={(e) => updateShortcutLocal(sc.id, 'label', e.target.value)}
                onBlur={commitShortcuts} />
              <input className="ga98-text" style={{ flex: 1 }} value={sc.target}
                onChange={(e) => updateShortcutLocal(sc.id, 'target', e.target.value)}
                onBlur={commitShortcuts} />
              <button disabled={i === 0} onClick={() => void patch({ shortcuts: swap(s.shortcuts, i, i - 1) })}>↑</button>
              <button disabled={i === s.shortcuts.length - 1} onClick={() => void patch({ shortcuts: swap(s.shortcuts, i, i + 1) })}>↓</button>
              <button onClick={() => void patch({ shortcuts: s.shortcuts.filter((x) => x.id !== sc.id) })}>×</button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <input className="ga98-text" value={newLabel} placeholder="Label" onChange={(e) => setNewLabel(e.target.value)} style={{ flex: 1 }} />
          <input className="ga98-text" value={newUrl} placeholder="https://… (web link)" onChange={(e) => setNewUrl(e.target.value)} style={{ flex: 2 }} />
          <button disabled={!newLabel.trim() || !newUrl.trim()} onClick={() => {
            const sc: AccessShortcut = { id: newShortcutId(), label: newLabel.trim(), kind: 'url', target: newUrl.trim() };
            void patch({ shortcuts: [...s.shortcuts, sc] });
            setNewLabel(''); setNewUrl('');
          }}>Add link</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>AI Assistant</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 4 }}>
          <label>Provider:</label>
          <select className="ga98-text" value={s.ai.provider} onChange={(e) => void patch({ ai: { ...s.ai, provider: e.target.value as AppSettings['ai']['provider'] } })}>
            <option value="none">(none)</option>
            <option value="ollama">Ollama (local)</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
          <label>Endpoint:</label>
          <input className="ga98-text" value={s.ai.endpoint} onChange={(e) => void patch({ ai: { ...s.ai, endpoint: e.target.value } })} />
          <label>Model:</label>
          <input className="ga98-text" value={s.ai.model} onChange={(e) => void patch({ ai: { ...s.ai, model: e.target.value } })} placeholder="e.g. llama3:8b or gpt-4o-mini" />
          <label>API key:</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input className="ga98-text" type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)} placeholder="(stored encrypted; only for openai-compatible)" style={{ flex: 1 }} />
            <button disabled={!apiKeyDraft} onClick={async () => {
              try {
                await window.api.ai.setApiKey(apiKeyDraft);
                await patch({ ai: { ...s.ai, apiKeyRef: 'ai.apiKey' } });
                setApiKeyStatus('Saved (encrypted)');
                setApiKeyDraft('');
              } catch (err) {
                setApiKeyStatus(`Failed: ${(err as Error).message}`);
              }
            }}>Save key</button>
          </div>
          <span />
          <span style={{ fontSize: 11, color: apiKeyStatus?.startsWith('Failed') ? '#900' : '#080' }}>{apiKeyStatus ?? ''}</span>
          <label style={{ alignSelf: 'flex-start' }}>System prompt:</label>
          <textarea className="ga98-text" rows={3} value={s.ai.defaultSystemPrompt}
            onChange={(e) => void patch({ ai: { ...s.ai, defaultSystemPrompt: e.target.value } })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Browser</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 4 }}>
          <label>Homepage:</label>
          <input className="ga98-text" value={s.browser.homepage} onChange={(e) => void patch({ browser: { ...s.browser, homepage: e.target.value } })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Mail</legend>
        <p style={{ fontSize: 11 }}>Add accounts from the Mail module. Each account stores its IMAP/SMTP password in <code>secrets.enc</code>, encrypted via your OS keyring.</p>
      </fieldset>
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
  return next;
}
