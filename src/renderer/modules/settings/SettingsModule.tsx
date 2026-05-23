/**
 * Settings — sound, theme, startup, default case folder, shortcuts editor,
 * and provider stubs for AI / Mail / Browser (UIs for the latter ship with v1.0.0 modules).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AccessShortcut, AppSettings } from '@shared/types';

function newShortcutId(): string {
  return `sc-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function SettingsModule(): JSX.Element {
  const [s, setS] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<{ version: string; userData: string; platform: NodeJS.Platform } | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const load = useCallback(async () => {
    setS(await window.api.settings.read());
    setInfo(await window.api.system.appInfo());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(p: Partial<AppSettings>): Promise<void> {
    const next = await window.api.settings.update(p);
    setS(next);
  }

  if (!s) return <div className="ga98-stack">Loading…</div>;

  return (
    <div className="ga98-stack">
      <fieldset>
        <legend>About</legend>
        <p>Ghost Access 98 v{info?.version ?? '—'} · {info?.platform ?? '—'}</p>
        <p style={{ fontSize: 11 }}>Data root: <code>{info?.userData ?? '—'}</code></p>
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
        <p style={{ fontSize: 11 }}>By default cases live under the OS userData folder. Override to keep them on a different drive.</p>
        <input className="ga98-text" style={{ width: '100%' }} value={s.caseFolderOverride ?? ''}
          onChange={(e) => void patch({ caseFolderOverride: e.target.value || null })}
          placeholder="(default: OS userData)" />
        <p style={{ fontSize: 10, color: '#600' }}>
          Override takes effect on next app launch.
        </p>
      </fieldset>

      <fieldset>
        <legend>Access menu shortcuts</legend>
        <ul className="ga98-list">
          {s.shortcuts.map((sc, i) => (
            <li key={sc.id}>
              <span style={{ width: 50, fontSize: 11, opacity: 0.7 }}>[{sc.kind}]</span>
              <input className="ga98-text" style={{ flex: 1 }} value={sc.label}
                onChange={(e) => void patch({ shortcuts: s.shortcuts.map((x) => x.id === sc.id ? { ...x, label: e.target.value } : x) })} />
              <input className="ga98-text" style={{ flex: 1 }} value={sc.target}
                onChange={(e) => void patch({ shortcuts: s.shortcuts.map((x) => x.id === sc.id ? { ...x, target: e.target.value } : x) })} />
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
        <legend>AI Assistant (provider stub — module ships in v1.0.0)</legend>
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
          <label style={{ alignSelf: 'flex-start' }}>System prompt:</label>
          <textarea className="ga98-text" rows={3} value={s.ai.defaultSystemPrompt}
            onChange={(e) => void patch({ ai: { ...s.ai, defaultSystemPrompt: e.target.value } })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Browser (stub)</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 4 }}>
          <label>Homepage:</label>
          <input className="ga98-text" value={s.browser.homepage} onChange={(e) => void patch({ browser: { ...s.browser, homepage: e.target.value } })} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Mail (stub)</legend>
        <p style={{ fontSize: 11 }}>Full account UI ships with the Mail module in v1.0.0. Configured accounts are stored encrypted in <code>secrets.enc</code>.</p>
      </fieldset>
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
  return next;
}
