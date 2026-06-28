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
import { useAuth, useSettings } from '../../state/store';
import { LocalAiPane } from './LocalAiPane';
import { playMailNotify, clearMailChimeCache } from '../../audio/synth';
import logoUrl from '../../assets/logo.png';
import { CLEARNET_DIALOG_TEXT, xNetworkToggleEnabled } from '../x/x-settings-logic';

type SectionKey = 'about' | 'sound' | 'theme' | 'cases' | 'shortcuts' | 'ai' | 'browser' | 'terminal' | 'mail' | 'backup' | 'security' | 'searchlight' | 'geoint' | 'socmint' | 'x';

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
  { key: 'terminal',  label: 'Terminal',    glyph: '💻' },
  { key: 'mail',      label: 'Mail',        glyph: '✉' },
  { key: 'backup',      label: 'Backup',      glyph: '💾' },
  { key: 'security',   label: 'Security',    glyph: '🔒' },
  { key: 'searchlight', label: 'Searchlight', glyph: '🔎' },
  { key: 'geoint',      label: 'GeoINT',      glyph: '🌍' },
  { key: 'socmint',     label: 'SOCMINT',     glyph: '📡' },
  { key: 'x',           label: 'X / Twitter', glyph: '✖' }
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
    // Push into the shared store so the live shell (desktop wallpaper, theme
    // intensity, etc. in App.tsx) re-renders immediately — optimistically here,
    // then reconciled with the persisted result below. Without this the change
    // only reaches disk and wouldn't show until the next launch.
    useSettings.setState({ settings: merged });
    try {
      const written = await window.api.settings.update(p);
      latest.current = written;
      setS(written);
      useSettings.setState({ settings: written });
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
      latest.current = base;
      setS(base);
      useSettings.setState({ settings: base });
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
        {section === 'terminal' && <TerminalPane s={s} reload={load} />}
        {section === 'mail' && <MailPane s={s} patch={patch} />}
        {section === 'backup' && <BackupPane />}
        {section === 'security' && <SecurityPane />}
        {section === 'searchlight' && <SearchlightPane s={s} patch={patch} />}
        {section === 'geoint' && <GeoINTPane s={s} patch={patch} />}
        {section === 'socmint' && <SocmintPane s={s} patch={patch} />}
        {section === 'x' && <XPane s={s} patch={patch} />}
      </div>
    </div>
  );
}

function AboutPane({ info }: { info: { version: string; userData: string; platform: NodeJS.Platform; secretBackend?: string } | null }): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <img src={logoUrl} alt="Ghost Intel 98 logo" style={{ width: 96, height: 96, imageRendering: 'pixelated', border: '1px solid #808080' }} />
        <div>
          <h3 style={{ margin: '0 0 4px 0' }}>Ghost Intel 98</h3>
          <p style={{ margin: 0 }}>v{info?.version ?? '—'} · {info?.platform ?? '—'}</p>
          <p style={{ margin: 0, fontSize: 11 }}>MIT licensed · © 2026 Desirae Stark</p>
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
      <fieldset>
        <legend>Local AI attribution</legend>
        <p style={{ fontSize: 11, margin: '4px 0' }}>
          Built with Llama. Llama 3.1 is licensed under the Llama 3.1 Community License,
          © Meta Platforms, Inc. Local model runtime: Ollama (MIT). Full license texts ship
          with the bundled installer.
        </p>
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
      <br />
      <label><input type="checkbox" checked={s.legacySounds} onChange={(e) => void patch({ legacySounds: e.target.checked })} /> Legacy sound pack (classic dial-up + startup jingle)</label>
      <br />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <button onClick={() => playMailNotify()}>Test "You've got mail" chime</button>
        <button
          onClick={async () => {
            try {
              await window.api.sounds.openFolder();
              clearMailChimeCache(); // pick up a replacement on the next chime without a restart
              toast.info('Replace mail-notify.wav in this folder with your own jingle.');
            } catch (err) {
              toast.error(`Could not open folder: ${(err as Error).message}`);
            }
          }}
          title="Open the folder holding the mail chime so you can swap in your own .wav"
        >
          Change chime (open sounds folder)…
        </button>
      </div>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        Sounds are synthesised at runtime via Web Audio by default. The optional <strong>Legacy sound
        pack</strong> swaps the startup chime and DialTerm dial-up for bundled AI-reworked recordings of
        the classic Windows jingle and dial-up handshake — derivative works of their originals, off by default.
      </p>
      <p style={{ fontSize: 11, color: '#444', marginTop: 4 }}>
        The <strong>"You've got mail" chime</strong> is yours to change: click <em>Change chime</em> to
        open the sounds folder and replace <code>mail-notify.wav</code> with any <code>.wav</code> you
        like (keep the same filename). It takes effect on the next new mail.
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
  const [memStatus, setMemStatus] = useState<{ model: string; cases: number; chunks: number } | null>(null);
  const [memBusy, setMemBusy] = useState(false);
  const [memProgress, setMemProgress] = useState<string>('');

  useEffect(() => { void window.api.memory.status().then(setMemStatus).catch(() => undefined); }, []);
  useEffect(() => window.api.memory.onProgress((p) => setMemProgress(`${p.done}/${p.total} · ${p.label}`)), []);

  async function rebuildIndex(): Promise<void> {
    setMemBusy(true); setMemProgress('starting…');
    try {
      const r = await window.api.memory.reindexAll();
      setMemStatus(await window.api.memory.status());
      toast.success(`Memory index rebuilt: ${r.cases} case(s), ${r.chunks} chunk(s).`);
    } catch (err) {
      toast.error(`Reindex failed: ${(err as Error).message}`);
    } finally { setMemBusy(false); setMemProgress(''); }
  }

  return (
    <>
      <LocalAiPane />
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
        <input className="ga98-text" value={s.ai.model} onChange={(e) => void patch({ ai: { ...s.ai, model: e.target.value } })} placeholder="e.g. qwen3-abliterated:4b or gpt-4o-mini" />
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
        <label style={{ alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={s.ai.formattedOutput}
            onChange={(e) => void patch({ ai: { ...s.ai, formattedOutput: e.target.checked } })} />
          Formatted assistant output (bold/italics/bullets)
        </label>
      </div>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        The API key is sent to the configured endpoint only when you send an AI message.
        It never leaves your machine for any other reason. The renderer never sees the key
        in plaintext — it lives encrypted in <code>secrets.enc</code> and is read by the
        main process at request time.
      </p>
      </fieldset>
      <fieldset>
        <legend>Case Memory (local, offline)</legend>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={s.ai.useMemory}
            onChange={(e) => void patch({ ai: { ...s.ai, useMemory: e.target.checked } })} />
          Let the assistant recall relevant notes, files, entities &amp; past conversations
        </label>
        <p style={{ fontSize: 11, color: '#444', margin: '6px 0' }}>
          Builds a local vector index of your cases and conversations using the bundled embedding
          model ({memStatus?.model ?? 'nomic-embed-text'}). Everything stays on this machine
          (loopback only) and is encrypted at rest with your vault. Retrieval is deterministic.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={() => void rebuildIndex()} disabled={memBusy}>{memBusy ? 'Rebuilding…' : 'Rebuild memory index'}</button>
          <span style={{ fontSize: 11, color: '#444' }}>
            {memBusy ? memProgress : memStatus ? `${memStatus.cases} case(s) · ${memStatus.chunks} chunk(s) indexed` : ''}
          </span>
        </div>
      </fieldset>
    </>
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

function TerminalPane({ s, reload }: { s: AppSettings; reload: () => Promise<void> }): JSX.Element {
  // Enabling the local shell grants local code execution, so it is gated behind a NATIVE
  // confirmation dialog in main (shell.requestEnable). settings.update can NOT set the enable
  // keys, so we never route them through `patch` — we call the dedicated IPC and re-read.
  const onToggle = async (checked: boolean): Promise<void> => {
    try {
      if (checked) await window.api.shell.requestEnable(s.localShellProgram);
      else await window.api.shell.disable();
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const onProgram = async (program: AppSettings['localShellProgram']): Promise<void> => {
    // Changing the program also goes through requestEnable (re-confirms + persists); only offered
    // while already enabled. The native dialog is the gate either way.
    try {
      await window.api.shell.requestEnable(program);
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <fieldset>
      <legend>Terminal</legend>
      <label>
        <input type="checkbox" checked={s.localShellEnabled} onChange={(e) => void onToggle(e.target.checked)} />
        {' '}Enable local shell in DialTerm (runs local commands with your own privileges)
      </label>
      <br />
      <label>Shell:&nbsp;
        <select className="ga98-text" value={s.localShellProgram} disabled={!s.localShellEnabled}
          onChange={(e) => void onProgram(e.target.value as AppSettings['localShellProgram'])}>
          <option value="cmd">Command Prompt (cmd.exe)</option>
          <option value="powershell">PowerShell</option>
        </select>
      </label>
      <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
        Off by default. Turning it on opens a confirmation prompt. The local shell runs on your
        machine with your account's privileges; it is not a remote connection. The terminal backend
        is loaded only when you open a shell session.
      </p>
    </fieldset>
  );
}

function MailPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  return (
    <fieldset>
      <legend>Mail</legend>
      <p style={{ fontSize: 12, marginTop: 0 }}>Add accounts from the Mail module. Each account stores its IMAP/SMTP password in <code>secrets.enc</code>, encrypted via your OS keyring.</p>
      <hr style={{ margin: '8px 0', borderColor: '#ccc' }} />
      <label>
        <input
          type="checkbox"
          checked={s.mailBackgroundCheck}
          onChange={(e) => void patch({ mailBackgroundCheck: e.target.checked })}
        />
        {' '}Check for new mail in the background
      </label>
      <p style={{ fontSize: 11, color: '#444', margin: '6px 0 0' }}>
        When on, Ghost Intel 98 checks your inbox about once a minute even when the Mail window is
        closed, and plays the “You’ve got mail” chime + a toast when new mail arrives. Off by default
        (no background network use until you enable it). The chime also needs <strong>Sound → Enable
        sounds</strong> on; use the <em>Test “You've got mail” chime</em> button there to confirm audio.
      </p>
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

function SearchlightPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  const sl = s.searchlight;
  const set = (p: Partial<AppSettings['searchlight']>): void => { void patch({ searchlight: { ...sl, ...p } }); };
  return (
    <fieldset>
      <legend>Searchlight</legend>
      <label>
        <input type="checkbox" checked={sl.networkEnabled} onChange={(e) => set({ networkEnabled: e.target.checked })} />
        {' '}Enable Searchlight network (sweeps). Off = Searchlight sends nothing.
      </label>
      <p style={{ fontSize: 11, color: '#444', margin: '6px 0' }}>
        Sweeps run through Tor by default. A per-sweep clearnet checkbox is in the Sweep panel.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '160px 80px', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <label>Tor concurrency:</label>
        <input
          className="ga98-text"
          type="number"
          min={1}
          max={64}
          value={sl.torConcurrency}
          onChange={(e) => set({ torConcurrency: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
        />
        <label>Clearnet concurrency:</label>
        <input
          className="ga98-text"
          type="number"
          min={1}
          max={64}
          value={sl.clearnetConcurrency}
          onChange={(e) => set({ clearnetConcurrency: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
        />
      </div>

      <fieldset style={{ marginTop: 12 }}>
        <legend>Detection scoring</legend>
        <label>
          <input
            type="checkbox"
            checked={!sl.scorer.lightweightMode}
            onChange={(e) => set({ scorer: { ...sl.scorer, lightweightMode: !e.target.checked } })}
          />
          {' '}Deep scan: inspect page content to cut false positives (recommended)
        </label>
        <label style={{ display: 'block', marginTop: 4 }}>
          <input
            type="checkbox"
            checked={sl.scorer.useMl}
            onChange={(e) => set({ scorer: { ...sl.scorer, useMl: e.target.checked } })}
          />
          {' '}Use ML model (blends with heuristics) — experimental; bundled model pending retrain
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 120px', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <label>Found threshold:</label>
          <input
            className="ga98-text"
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={sl.scorer.foundThreshold ?? ''}
            placeholder="model default (0.5559)"
            onChange={(e) => set({ scorer: { ...sl.scorer, foundThreshold: e.target.value === '' ? null : Number(e.target.value) } })}
          />
          <label>Maybe floor:</label>
          <input
            className="ga98-text"
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={sl.scorer.maybeFloor ?? ''}
            placeholder="model default (0.3224)"
            onChange={(e) => set({ scorer: { ...sl.scorer, maybeFloor: e.target.value === '' ? null : Number(e.target.value) } })}
          />
        </div>
        <p style={{ fontSize: 11, color: '#444', margin: '6px 0' }}>
          Leave thresholds blank to use the model&apos;s own calibrated values.
        </p>
        <button onClick={() => set({ scorer: { foundThreshold: null, maybeFloor: null, lightweightMode: false, useMl: false } })}>
          Reset detection defaults
        </button>
      </fieldset>
    </fieldset>
  );
}

function GeoINTPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  const [aisKeyDraft, setAisKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.api.geoint.hasLayerKey('ais').then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const saveAisKey = async (): Promise<void> => {
    const trimmed = aisKeyDraft.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await window.api.geoint.setLayerKey('ais', trimmed);
      setAisKeyDraft('');
      const updated = await window.api.geoint.hasLayerKey('ais');
      setHasKey(updated);
      toast.success('AIS key saved (encrypted).');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset>
      <legend>GeoINT</legend>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>AISStream.io API key:</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="ga98-text"
            type="password"
            value={aisKeyDraft}
            onChange={(e) => setAisKeyDraft(e.target.value)}
            placeholder={hasKey ? '(key stored — enter new to replace)' : 'Paste AISStream.io key…'}
            style={{ flex: 1 }}
            disabled={saving}
          />
          <button
            onClick={() => void saveAisKey()}
            disabled={saving || !aisKeyDraft.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {hasKey && (
          <span style={{ fontSize: 11, color: '#008000', marginTop: 4, display: 'block' }}>✓ key stored</span>
        )}
        <p style={{ fontSize: 11, color: '#444', margin: '6px 0 0' }}>
          AISStream.io key for the Live Ships feed. Stored encrypted; never leaves this machine.
          The ADS-B aircraft feed needs no key.
        </p>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={s.geoint.cctvOverTor}
            onChange={(e) => void patch({ geoint: { ...s.geoint, cctvOverTor: e.target.checked } })}
            style={{ marginTop: 2 }}
          />
          <span>
            Route CCTV streams through Tor (off by default). When on, a camera that can't be
            reached over Tor will not load rather than expose your IP. Live video over Tor may be slow.
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function SocmintPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  const [burnerId, setBurnerId] = useState('');
  const [sessionString, setSessionString] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [hasBurner, setHasBurner] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  // Load hasBurner status when the burner ID changes.
  useEffect(() => {
    const id = burnerId.trim();
    if (!id) { setHasBurner(false); return; }
    void window.api.socmint.hasBurner(id).then(setHasBurner).catch(() => setHasBurner(false));
  }, [burnerId]);

  const saveBurner = async (): Promise<void> => {
    const id = burnerId.trim();
    const sess = sessionString.trim();
    if (!id) { toast.error('Enter a burner ID.'); return; }
    if (!sess) { toast.error('Enter a session string.'); return; }
    setSaving(true);
    try {
      const creds: Record<string, string> = { sessionString: sess };
      if (apiId.trim()) creds.apiId = apiId.trim();
      if (apiHash.trim()) creds.apiHash = apiHash.trim();
      await window.api.socmint.setBurner(id, creds);
      const updated = await window.api.socmint.hasBurner(id);
      setHasBurner(updated);
      setSessionString(''); setApiId(''); setApiHash('');
      toast.success('Burner credentials saved (encrypted).');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset>
      <legend>SOCMINT</legend>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={s.socmint.networkEnabled}
            onChange={(e) => void patch({ socmint: { ...s.socmint, networkEnabled: e.target.checked } })}
            style={{ marginTop: 2 }}
          />
          <span>
            Enable SOCMINT network egress (off by default). When off, no collector
            connects and no egress is initiated for SOCMINT operations.
          </span>
        </label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 12, margin: '0 0 6px 0', fontWeight: 'bold' }}>Collector transport</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="socmint-transport"
              value="direct"
              checked={(s.socmint.transport ?? 'direct') === 'direct'}
              onChange={() => void patch({ socmint: { ...s.socmint, transport: 'direct' } })}
            />
            <span>Direct (clearnet)</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="socmint-transport"
              value="tor"
              checked={(s.socmint.transport ?? 'direct') === 'tor'}
              onChange={() => void patch({ socmint: { ...s.socmint, transport: 'tor' } })}
            />
            <span>Tor (per-burner circuit)</span>
          </label>
        </div>
        <p style={{ fontSize: 11, color: '#444', margin: '6px 0 0' }}>
          Direct sends traffic over your normal connection; Tor routes each burner through its own circuit.
          In Tor mode a bootstrapped Tor connection is required — the collector refuses when Tor is down.
        </p>
      </div>
      <hr style={{ margin: '10px 0', borderColor: '#ccc' }} />
      <div>
        <p style={{ fontSize: 12, margin: '0 0 8px 0', fontWeight: 'bold' }}>Burner identity</p>
        <p style={{ fontSize: 11, color: '#444', margin: '0 0 8px 0' }}>
          Burner credentials are stored encrypted via the OS keyring under
          {' '}<code>socmint.burner.&lt;id&gt;.*</code>. Only a boolean{' '}
          <strong>has credential</strong> status is shown here — the secret values
          are never echoed to the UI.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, alignItems: 'center' }}>
          <label>Burner ID:</label>
          <input
            className="ga98-text"
            value={burnerId}
            onChange={(e) => setBurnerId(e.target.value)}
            placeholder="e.g. burner-1"
            disabled={saving}
          />
          <label>Session string:</label>
          <input
            className="ga98-text"
            type="password"
            value={sessionString}
            onChange={(e) => setSessionString(e.target.value)}
            placeholder="(Telegram session string — not echoed)"
            disabled={saving}
          />
          <label>API ID (opt.):</label>
          <input
            className="ga98-text"
            type="password"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            placeholder="(numeric API ID — optional)"
            disabled={saving}
          />
          <label>API Hash (opt.):</label>
          <input
            className="ga98-text"
            type="password"
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value)}
            placeholder="(API hash — optional)"
            disabled={saving}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button
            onClick={() => void saveBurner()}
            disabled={saving || !burnerId.trim() || !sessionString.trim()}
          >
            {saving ? 'Saving…' : 'Save burner credentials'}
          </button>
          {burnerId.trim() && hasBurner && (
            <span style={{ fontSize: 11, color: '#008000' }}>✓ credential stored</span>
          )}
          {burnerId.trim() && !hasBurner && (
            <span style={{ fontSize: 11, color: '#888' }}>no credential stored</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: '#444', margin: '8px 0 0' }}>
          The Telegram collector is built to interface; live validation and library
          lock are pending the operator smoke test (spec §7). Setting credentials
          here prepares the identity for when the library is pinned.
        </p>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// X / Twitter collector settings pane (X-7)
// ---------------------------------------------------------------------------

/**
 * XPane — gated toggle + clearnet-acknowledgement dialog + account management.
 *
 * Gating (spec §3.1):
 *   - The network-enabled toggle is DISABLED until clearnetAcknowledged=true.
 *   - clearnetAcknowledged is set only via the explicit confirmation dialog
 *     (not by the toggle alone). The dialog text is from CLEARNET_DIALOG_TEXT.
 *
 * Credentials (spec §5.2):
 *   - auth_token / ct0 are written to secretStore via x.addAccount().
 *   - Credential input fields are type="password" and are cleared after save.
 *   - x.listAccounts() returns IDs only; x.hasAccount() returns boolean only.
 *   - No credential values are ever displayed or stored in component state after save.
 */
function XPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => Promise<void> }): JSX.Element {
  const [newAccountId, setNewAccountId] = useState('');
  const [newAuthToken, setNewAuthToken] = useState('');
  const [newCt0, setNewCt0] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [accountList, setAccountList] = useState<string[]>([]);
  const [credStatus, setCredStatus] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async (): Promise<void> => {
    try {
      const ids = (await window.api.x.listAccounts()) as string[];
      setAccountList(ids);
      const pairs = await Promise.all(
        ids.map(async (id) => {
          const has = (await window.api.x.hasAccount(id)) as boolean;
          return [id, has] as const;
        }),
      );
      setCredStatus(Object.fromEntries(pairs));
    } catch {
      setAccountList([]);
      setCredStatus({});
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const x = s.x;

  const handleAcknowledge = async (): Promise<void> => {
    const ok = await confirmDialog(CLEARNET_DIALOG_TEXT, 'X/Twitter Collector — Clearnet Acknowledgement');
    if (!ok) return;
    await patch({ x: { ...x, clearnetAcknowledged: true } });
    toast.info('Clearnet acknowledged. You may now enable the X collector.');
  };

  const handleNetworkToggle = async (checked: boolean): Promise<void> => {
    if (checked && !xNetworkToggleEnabled(x.clearnetAcknowledged)) {
      toast.error('Acknowledge the clearnet warning first (see below).');
      return;
    }
    await patch({ x: { ...x, networkEnabled: checked } });
  };

  const handleAddAccount = async (): Promise<void> => {
    const id = newAccountId.trim();
    if (!id) { toast.error('Enter an account ID.'); return; }
    if (!newAuthToken.trim() && !newCt0.trim()) {
      toast.error('Enter at least auth_token or ct0.');
      return;
    }
    setSaving(true);
    try {
      const creds: Record<string, string> = {};
      if (newAuthToken.trim()) creds.auth_token = newAuthToken.trim();
      if (newCt0.trim()) creds.ct0 = newCt0.trim();
      if (newUsername.trim()) creds.username = newUsername.trim();
      await window.api.x.addAccount(id, creds);
      // Clear credential fields immediately after save — they must not remain in state.
      setNewAccountId(''); setNewAuthToken(''); setNewCt0(''); setNewUsername('');
      toast.success('X account credentials saved (encrypted).');
      await loadAccounts();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAccount = async (id: string): Promise<void> => {
    const ok = await confirmDialog(
      `Remove X account "${id}" and delete all stored credentials?`,
      'Remove X account',
    );
    if (!ok) return;
    try {
      await window.api.x.removeAccount(id);
      toast.success('Account removed.');
      await loadAccounts();
    } catch (err) {
      toast.error(`Remove failed: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <fieldset>
        <legend>X / Twitter Collector</legend>

        {/* Clearnet acknowledgement gate */}
        {!x.clearnetAcknowledged ? (
          <div style={{ border: '1px solid #c0a000', background: '#fffae0', padding: 10, marginBottom: 12 }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: 'bold', color: '#7a4d00' }}>
              Clearnet acknowledgement required
            </p>
            <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#444' }}>
              The X/Twitter collector makes requests to x.com over your regular internet
              connection. Unlike SOCMINT (Telegram) it cannot be routed through Tor.
              You must read and confirm the clearnet disclosure before the network
              toggle can be enabled.
            </p>
            <button onClick={() => void handleAcknowledge()}>
              View clearnet disclosure and acknowledge…
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 11, color: '#008000', marginBottom: 8 }}>
            ✓ Clearnet exposure acknowledged.
          </p>
        )}

        {/* Network enable toggle — disabled until clearnetAcknowledged */}
        <div style={{ marginBottom: 10 }}>
          <label
            style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              cursor: xNetworkToggleEnabled(x.clearnetAcknowledged) ? 'pointer' : 'not-allowed',
              opacity: xNetworkToggleEnabled(x.clearnetAcknowledged) ? 1 : 0.45,
            }}
          >
            <input
              type="checkbox"
              checked={x.networkEnabled}
              disabled={!xNetworkToggleEnabled(x.clearnetAcknowledged)}
              onChange={(e) => void handleNetworkToggle(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Enable X/Twitter network egress (off by default). When off, the sidecar
              is never spawned and no egress is initiated for X collection.
            </span>
          </label>
          {!xNetworkToggleEnabled(x.clearnetAcknowledged) && (
            <p style={{ fontSize: 11, color: '#900', margin: '3px 0 0 24px' }}>
              Requires clearnet acknowledgement above.
            </p>
          )}
        </div>

        <p style={{ fontSize: 11, color: '#444', margin: '0 0 0 0' }}>
          The X collector uses a Python sidecar (twscrape) that connects to x.com. Both
          settings.x.networkEnabled and settings.x.clearnetAcknowledged must be true at
          the IPC gate before any sidecar path is entered (spec §3.1). The sidecar binary
          is sealed (pending operator lock) — collection is not available until it is
          installed separately.
        </p>
      </fieldset>

      {/* Account credentials */}
      <fieldset>
        <legend>X Account Credentials</legend>
        <p style={{ fontSize: 11, color: '#444', margin: '0 0 8px 0' }}>
          Credentials (auth_token + ct0) are stored encrypted via the OS keyring under
          {' '}<code>x.accounts.&lt;id&gt;.*</code>. Only a boolean{' '}
          <strong>has credential</strong> status is shown here — the secret values
          are never echoed to the UI (spec §5.2). Provision burner accounts externally
          on an unlinked device/network before adding them here.
        </p>

        {/* Existing accounts */}
        {accountList.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 'bold', margin: '0 0 6px 0' }}>Stored accounts</p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {accountList.map((id) => (
                <li key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <code style={{ flex: 1, fontSize: 12 }}>{id}</code>
                  {credStatus[id]
                    ? <span style={{ fontSize: 11, color: '#008000' }}>✓ auth_token stored</span>
                    : <span style={{ fontSize: 11, color: '#888' }}>no auth_token</span>
                  }
                  <button onClick={() => void handleRemoveAccount(id)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Add new account */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 'bold', margin: '0 0 6px 0' }}>Add account</p>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 6, alignItems: 'center' }}>
            <label>Account ID:</label>
            <input
              className="ga98-text"
              value={newAccountId}
              onChange={(e) => setNewAccountId(e.target.value)}
              placeholder="e.g. burner-x-1"
              disabled={saving}
            />
            <label>auth_token:</label>
            <input
              className="ga98-text"
              type="password"
              value={newAuthToken}
              onChange={(e) => setNewAuthToken(e.target.value)}
              placeholder="(cookie — write-only, not echoed)"
              disabled={saving}
              autoComplete="off"
            />
            <label>ct0:</label>
            <input
              className="ga98-text"
              type="password"
              value={newCt0}
              onChange={(e) => setNewCt0(e.target.value)}
              placeholder="(CSRF token — write-only, not echoed)"
              disabled={saving}
              autoComplete="off"
            />
            <label>Username (opt.):</label>
            <input
              className="ga98-text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="@handle (optional)"
              disabled={saving}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button
              onClick={() => void handleAddAccount()}
              disabled={saving || !newAccountId.trim() || (!newAuthToken.trim() && !newCt0.trim())}
            >
              {saving ? 'Saving…' : 'Save credentials'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
            Extract auth_token and ct0 from your browser's cookie jar after logging in to
            x.com on the burner account. Credentials are stored encrypted; once saved,
            they are never shown again (boolean status only).
          </p>
        </div>
      </fieldset>
    </>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
  return next;
}

/** Minimum master-password length. Mirrors main-process ensureNewPassword (defence in depth):
 *  a .ga98 backup bundles the wrapped DEK, so the password is an offline scrypt-cracking target. */
const MIN_PW_LEN = 12;

/** Lightweight inline strength estimate (no external dep). Heuristic only — length + variety. */
function pwStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '#c0c0c0' };
  let s = 0;
  if (pw.length >= MIN_PW_LEN) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(4, s);
  return {
    score,
    label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score],
    color: ['#a00000', '#c06000', '#a0a000', '#2080a0', '#008000'][score]
  };
}

function StrengthMeter({ pw }: { pw: string }): JSX.Element | null {
  if (!pw) return null;
  const { score, label, color } = pwStrength(pw);
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ height: 6, background: '#dfdfdf', border: '1px solid #808080' }}>
        <div style={{ height: '100%', width: `${(score + 1) * 20}%`, background: color }} />
      </div>
      <span style={{ fontSize: 11, color }}>
        {label}{pw.length < MIN_PW_LEN ? ` — needs ${MIN_PW_LEN}+ characters` : ''}
      </span>
    </div>
  );
}

function SecurityPane(): JSX.Element {
  const refreshAuth = useAuth((st) => st.refresh);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [npw, setNpw] = useState('');
  const [npw2, setNpw2] = useState('');
  const [dpw, setDpw] = useState('');

  const loadStatus = useCallback(async () => {
    setEnabled((await window.api.auth.status()).enabled);
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const enable = async (): Promise<void> => {
    if (pw.length < MIN_PW_LEN) { toast.error(`Use at least ${MIN_PW_LEN} characters.`); return; }
    if (pw !== pw2) { toast.error('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { recoveryKey: rk } = await window.api.auth.setup(pw);
      setRecoveryKey(rk);
      setEnabled(true);
      setPw(''); setPw2('');
      await refreshAuth();
      toast.success('Login enabled — your data is now encrypted at rest.');
    } catch (err) {
      toast.error(`Could not enable login: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (): Promise<void> => {
    if (npw.length < MIN_PW_LEN) { toast.error(`Use at least ${MIN_PW_LEN} characters.`); return; }
    if (npw !== npw2) { toast.error('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await window.api.auth.changePassword(npw);
      setNpw(''); setNpw2('');
      toast.success('Master password changed.');
    } catch (err) {
      toast.error(`Could not change password: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (): Promise<void> => {
    if (!dpw) { toast.error('Enter your password to confirm.'); return; }
    const ok = await confirmDialog(
      'Disabling login decrypts all your data back to plaintext on disk. Continue?',
      'Disable login'
    );
    if (!ok) return;
    setBusy(true);
    try {
      await window.api.auth.disable(dpw);
      setDpw('');
      setEnabled(false);
      await refreshAuth();
      toast.success('Login disabled — data decrypted.');
    } catch (err) {
      toast.error(`Could not disable login: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const lockNow = async (): Promise<void> => {
    await window.api.auth.lock();
    await refreshAuth(); // App swaps to the lock screen (this window unmounts)
  };

  if (enabled === null) return <div className="ga98-stack">Loading…</div>;

  if (recoveryKey) {
    return (
      <fieldset>
        <legend>Save your recovery key</legend>
        <p style={{ color: '#900', marginTop: 4 }}>
          This is shown <strong>once</strong>. It is the only way back in if you forget your password.
          Write it down and store it somewhere safe — it is not saved anywhere you can read it again.
        </p>
        <p
          style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 1, padding: 8, border: '1px solid #808080', background: '#fff', userSelect: 'all', textAlign: 'center' }}
        >
          {recoveryKey}
        </p>
        <div className="field-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button onClick={() => { void navigator.clipboard?.writeText(recoveryKey).then(() => toast.success('Copied.'), () => toast.error('Copy failed — write it down.')); }}>Copy</button>
          <button onClick={() => setRecoveryKey(null)}>I have saved it</button>
        </div>
      </fieldset>
    );
  }

  if (!enabled) {
    return (
      <>
        <fieldset>
          <legend>Login &amp; encryption</legend>
          <p style={{ marginTop: 4 }}>
            Protect Ghost Intel 98 with a master password. When enabled, all case data is encrypted
            at rest (AES-256-GCM); the app stays locked until you enter the password.
          </p>
          <p style={{ color: '#900', fontSize: 11 }}>
            There is no password reset. You will get a one-time recovery key — keep it safe.
          </p>
          <p style={{ color: '#555', fontSize: 11 }}>
            A backup file (.ga98) carries your encrypted key, so anyone who gets it can guess your
            password offline at their leisure. Use {MIN_PW_LEN}+ characters — a long passphrase is best.
          </p>
          <div className="field-row-stacked">
            <label htmlFor="ga98-pw">Master password</label>
            <input id="ga98-pw" type="password" value={pw} disabled={busy} onChange={(e) => setPw(e.target.value)} />
            <StrengthMeter pw={pw} />
          </div>
          <div className="field-row-stacked">
            <label htmlFor="ga98-pw2">Confirm password</label>
            <input id="ga98-pw2" type="password" value={pw2} disabled={busy} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <div className="field-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => void enable()} disabled={busy || !pw || !pw2}>
              {busy ? 'Encrypting…' : 'Enable login'}
            </button>
          </div>
        </fieldset>
      </>
    );
  }

  return (
    <>
      <fieldset>
        <legend>Login &amp; encryption</legend>
        <p style={{ marginTop: 4 }}>Login is <strong>enabled</strong>. Your data is encrypted at rest.</p>
        <div className="field-row" style={{ justifyContent: 'flex-start' }}>
          <button onClick={() => void lockNow()} disabled={busy}>Lock now</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Change master password</legend>
        <div className="field-row-stacked">
          <label htmlFor="ga98-npw">New password</label>
          <input id="ga98-npw" type="password" value={npw} disabled={busy} onChange={(e) => setNpw(e.target.value)} />
          <StrengthMeter pw={npw} />
        </div>
        <div className="field-row-stacked">
          <label htmlFor="ga98-npw2">Confirm new password</label>
          <input id="ga98-npw2" type="password" value={npw2} disabled={busy} onChange={(e) => setNpw2(e.target.value)} />
        </div>
        <div className="field-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={() => void changePassword()} disabled={busy || !npw || !npw2}>Change password</button>
        </div>
        <p style={{ fontSize: 11, color: '#555' }}>The recovery key is unchanged by a password change.</p>
      </fieldset>
      <fieldset>
        <legend>Disable login</legend>
        <p style={{ marginTop: 4, color: '#900' }}>Decrypts all data back to plaintext on disk and removes the password.</p>
        <div className="field-row-stacked">
          <label htmlFor="ga98-dpw">Confirm with your password</label>
          <input id="ga98-dpw" type="password" value={dpw} disabled={busy} onChange={(e) => setDpw(e.target.value)} />
        </div>
        <div className="field-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={() => void disable()} disabled={busy || !dpw}>{busy ? 'Working…' : 'Disable login'}</button>
        </div>
      </fieldset>
    </>
  );
}
