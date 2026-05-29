/**
 * Settings — left-rail navigation, sections rendered on the right.
 * v1.0.2: dedicated sections for About, Sound, Theme, Cases, Shortcuts,
 * AI Assistant, Browser, Mail diagnostics. API-key save goes via the real
 * ai.setApiKey IPC, not a settings round-trip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessShortcut, AppSettings } from '@shared/types';
import { toast } from '../../state/toasts';
import { confirmDialog } from '../../state/dialogs';
import logoUrl from '../../assets/logo.png';

type SectionKey = 'about' | 'sound' | 'theme' | 'cases' | 'shortcuts' | 'ai' | 'browser' | 'mail' | 'backup';

interface Section {
  key: SectionKey;
  label: string;
  glyph: string;
}

const SECTIONS: Section[] = [
  { key: 'about',     label: 'About',       glyph: 'ℹ' },
  { key: 'sound',     label: 'Sound',       glyph: '🔊' },
  { key: 'theme',     label: 'Theme',       glyph: '🎨' },
  { key: 'cases',     label: 'Case folder', glyph: '📁' },
  { key: 'shortcuts', label: 'Shortcuts',   glyph: '⚡' },
  { key: 'ai',        label: 'AI Assistant',glyph: '✨' },
  { key: 'browser',   label: 'Browser',     glyph: '🌐' },
  { key: 'mail',      label: 'Mail',        glyph: '✉' },
  { key: 'backup',    label: 'Backup',      glyph: '💾' }
];

function newShortcutId(): string {
  return `sc-${crypto.randomUUID()}`;
}

export function SettingsModule(): JSX.Element {
  const [s, setS] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<{ version: string; userData: string; platform: NodeJS.Platform; secretBackend?: string } | null>(null);
  const [section, setSection] = useState<SectionKey>('about');
  const latest = useRef<AppSettings | null>(null);

  const load = useCallback(async () => {
    const next = await window.api.settings.read();
    setS(next);
    latest.current = next;
    setInfo(await window.api.system.appInfo() as Awaited<ReturnType<typeof window.api.system.appInfo>> & { secretBackend?: string });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (p: Partial<AppSettings>): Promise<void> => {
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
    try {
      const written = await window.api.settings.update(p);
      latest.current = written;
      setS(written);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
      latest.current = base;
      setS(base);
    }
  }, [s]);

  if (!s) return <div className="ga98-stack">Loading…</div>;

  return (
    <div className="ga98-settings-shell">
      <nav className="ga98-settings-rail" aria-label="Settings sections">
        {SECTIONS.map((sec) => (
          <button
            key={sec.key}
            className="ga98-settings-rail-item"
            data-active={section === sec.key}
            onClick={() => setSection(sec.key)}
          >
            <span style={{ display: 'inline-block', width: 18, textAlign: 'center' }} aria-hidden="true">{sec.glyph}</span>
            <span>{sec.label}</span>
          </button>
        ))}
      </nav>
      <div className="ga98-settings-pane">
        {section === 'about' && <AboutPane info={info} />}
        {section === 'sound' && <SoundPane s={s} patch={patch} />}
        {section === 'theme' && <ThemePane s={s} patch={patch} />}
        {section === 'cases' && <CaseFolderPane s={s} patch={patch} />}
        {section === 'shortcuts' && <ShortcutsPane s={s} setS={setS} latest={latest} patch={patch} />}
        {section === 'ai' && <AiPane s={s} patch={patch} />}
        {section === 'browser' && <BrowserPane s={s} patch={patch} />}
        {section === 'mail' && <MailPane />}
        {section === 'backup' && <BackupPane />}
      </div>
    </div>
  );
}

function AboutPane({ info }: { info: { version: string; userData: string; platform: NodeJS.Platform; secretBackend?: string } | null }): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <img src={logoUrl} alt="Ghost Access 98 logo" style={{ width: 96, height: 96, imageRendering: 'pixelated', border: '1px solid #808080' }} />
        <div>
          <h3 style={{ margin: '0 0 4px 0' }}>Ghost Access 98</h3>
          <p style={{ margin: 0 }}>v{info?.version ?? '—'} · {info?.platform ?? '—'}</p>
          <p style={{ margin: 0, fontSize: 11 }}>MIT licensed · © 2026 Obsidian Circuit</p>
        </div>
      </div>
      <fieldset>
        <legend>Data root</legend>
        <code style={{ fontSize: 11 }}>{info?.userData ?? '—'}</code>
      </fieldset>
      <fieldset>
        <legend>Secrets backend</legend>
        <p style={{ margin: '4px 0' }}><code>{info?.secretBackend ?? '—'}</code></p>
        {info?.secretBackend === 'basic_text' && (
          <p style={{ color: '#900', margin: '4px 0' }}>
            ⚠ No OS keyring detected. Secrets are obfuscated, not encrypted against a local attacker.
            Install gnome-keyring or KWallet.
          </p>
        )}
        {info?.secretBackend === 'unavailable' && (
          <p style={{ color: '#900', margin: '4px 0' }}>
            ⚠ Encryption backend is unavailable. Mail / SSH / AI credentials cannot be saved.
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>Keyboard shortcuts</legend>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          <li><kbd>Ctrl/⌘ + N</kbd> — New (case if Cases focused; note if Notepad focused)</li>
          <li><kbd>Ctrl/⌘ + S</kbd> — Save (Notepad)</li>
          <li><kbd>Ctrl/⌘ + W</kbd> — Close the focused window</li>
          <li><kbd>Ctrl/⌘ + Tab</kbd> — Cycle focus between open windows</li>
          <li><kbd>F1</kbd> — Open Settings</li>
          <li><kbd>Esc</kbd> — Dismiss the topmost dialog</li>
        </ul>
      </fieldset>
    </>
  );
}

function SoundPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Sound</legend>
      <label><input type="checkbox" checked={s.soundEnabled} onChange={(e) => void patch({ soundEnabled: e.target.checked })} /> Enable sounds</label>
      <br />
      <label><input type="checkbox" checked={s.startupSoundEnabled} onChange={(e) => void patch({ startupSoundEnabled: e.target.checked })} /> Play startup chime on launch</label>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        All sounds are synthesised at runtime via Web Audio. No copyrighted audio is bundled.
      </p>
    </fieldset>
  );
}

function ThemePane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Theme</legend>
      <label>Intensity:&nbsp;
        <select className="ga98-text" value={s.themeIntensity} onChange={(e) => void patch({ themeIntensity: e.target.value as AppSettings['themeIntensity'] })}>
          <option value="lite">Lite</option>
          <option value="classic">Classic</option>
          <option value="maximum">Maximum</option>
        </select>
      </label>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label>Desktop background:&nbsp;
          <input type="color" value={s.wallpaperColor} onChange={(e) => void patch({ wallpaperColor: e.target.value })} />
        </label>
        <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.wallpaperColor}</span>
        <button onClick={() => void patch({ wallpaperColor: '#008080' })}>Reset to teal</button>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label>Background image:</label>
        <button onClick={async () => {
          try { const uri = await window.api.settings.pickWallpaper(); if (uri) await patch({ wallpaperImage: uri }); }
          catch (err) { toast.error(`Could not load image: ${(err as Error).message}`); }
        }}>Choose…</button>
        {s.wallpaperImage && <button onClick={() => void patch({ wallpaperImage: null })}>Clear</button>}
        <span style={{ fontSize: 11, opacity: 0.7 }}>{s.wallpaperImage ? 'image set' : 'none'}</span>
      </div>
    </fieldset>
  );
}

function CaseFolderPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Default case folder</legend>
      <p style={{ fontSize: 11, marginTop: 0 }}>By default cases live under the OS userData folder. Override is stored but not yet wired (planned for a future release).</p>
      <input className="ga98-text" style={{ width: '100%' }} value={s.caseFolderOverride ?? ''}
        onChange={(e) => void patch({ caseFolderOverride: e.target.value || null })}
        placeholder="(default: OS userData)" />
    </fieldset>
  );
}

function ShortcutsPane({ s, setS, latest, patch }: {
  s: AppSettings;
  setS: (next: AppSettings | ((prev: AppSettings | null) => AppSettings | null)) => void;
  latest: { current: AppSettings | null };
  patch: (p: Partial<AppSettings>) => Promise<void>;
}): JSX.Element {
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');

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

  return (
    <fieldset>
      <legend>Access menu shortcuts</legend>
      <p style={{ fontSize: 11, marginTop: 0 }}>Edit labels and targets. Add web links to launch them in your OS browser.</p>
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
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <input className="ga98-text" value={newLabel} placeholder="Label" onChange={(e) => setNewLabel(e.target.value)} style={{ flex: 1 }} />
        <input className="ga98-text" value={newUrl} placeholder="https://…" onChange={(e) => setNewUrl(e.target.value)} style={{ flex: 2 }} />
        <button disabled={!newLabel.trim() || !newUrl.trim()} onClick={() => {
          const sc: AccessShortcut = { id: newShortcutId(), label: newLabel.trim(), kind: 'url', target: newUrl.trim() };
          void patch({ shortcuts: [...s.shortcuts, sc] });
          setNewLabel(''); setNewUrl('');
        }}>Add link</button>
      </div>
    </fieldset>
  );
}

function AiPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  const [apiKeyDraft, setApiKeyDraft] = useState('');

  return (
    <fieldset>
      <legend>AI Assistant</legend>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, alignItems: 'center' }}>
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
              toast.success('API key saved (encrypted).');
              setApiKeyDraft('');
            } catch (err) {
              toast.error(`Save failed: ${(err as Error).message}`);
            }
          }}>Save key</button>
        </div>
        <label style={{ alignSelf: 'flex-start' }}>System prompt:</label>
        <textarea className="ga98-text" rows={3} value={s.ai.defaultSystemPrompt}
          onChange={(e) => void patch({ ai: { ...s.ai, defaultSystemPrompt: e.target.value } })} />
      </div>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        The API key is sent to the configured endpoint only when you send an AI message.
        It never leaves your machine for any other reason. The renderer never sees the key
        in plaintext — it lives encrypted in <code>secrets.enc</code> and is read by the
        main process at request time.
      </p>
    </fieldset>
  );
}

function BrowserPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Net Explorer</legend>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6 }}>
        <label>Homepage:</label>
        <input className="ga98-text" value={s.browser.homepage} onChange={(e) => void patch({ browser: { ...s.browser, homepage: e.target.value } })} />
      </div>
    </fieldset>
  );
}

function MailPane(): JSX.Element {
  return (
    <fieldset>
      <legend>Mail</legend>
      <p style={{ fontSize: 12 }}>Add accounts from the Mail module. Each account stores its IMAP/SMTP password in <code>secrets.enc</code>, encrypted via your OS keyring.</p>
    </fieldset>
  );
}

function BackupPane(): JSX.Element {
  return (
    <fieldset>
      <legend>Backup / Restore</legend>
      <p style={{ fontSize: 12, marginTop: 0 }}>
        Save all your cases, notes, attachments, entities, and settings to a single <code>.ga98</code>
        {' '}file — a safety copy, or to move everything to another machine.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={async () => {
          try { const saved = await window.api.backup.create(); if (saved) toast.success(`Backup saved: ${saved}`); }
          catch (err) { toast.error(`Backup failed: ${(err as Error).message}`); }
        }}>Create backup…</button>
        <button onClick={async () => {
          const ok = await confirmDialog('Restore overwrites your current data with the backup’s contents. Continue?', 'Restore backup');
          if (!ok) return;
          try {
            const r = await window.api.backup.restore();
            if (r) toast.success(`Restored ${r.files} files. Restart the app to load everything.`);
          } catch (err) { toast.error(`Restore failed: ${(err as Error).message}`); }
        }}>Restore…</button>
      </div>
      <p style={{ fontSize: 11, color: '#900', marginTop: 8 }}>
        Encrypted credentials (Mail / SSH / AI passwords) are OS-keyring-bound and do not transfer to
        another machine — re-enter them there.
      </p>
    </fieldset>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
  return next;
}
