/**
 * Help — keyboard-shortcut reference + module walkthrough.
 */

import logoUrl from '../../assets/logo.png';

const MODULE_DOCS: { name: string; desc: string }[] = [
  { name: 'My Cases', desc: 'Create cases, attach files (drag-drop), keep notes, tasks, links, reminders, and a per-case timeline. Sort by updated/created/priority/status/title; filter by tag.' },
  { name: 'Notepad 98', desc: 'Plain-text editor scoped to a case. Ctrl/⌘+N for new, Ctrl/⌘+S to save.' },
  { name: 'Calendar', desc: 'Month grid showing global reminders, case-scoped reminders, and case task due dates. Click any day to quickly create a reminder for it.' },
  { name: 'Reminders / Alarm', desc: 'Set named one-shot reminders. The ticker fires every 30s and surfaces matches as a Windows toast + a synthesized chime.' },
  { name: 'Shred', desc: 'Soft-delete bucket. Cases and attachments live here until you Restore or Purge.' },
  { name: 'Settings', desc: 'Sound, theme, default case folder, Access-menu shortcut editor, AI provider config, browser homepage. Sections in the left rail.' },
  { name: 'Net Explorer', desc: 'Internal browser via <webview>. Multi-tab, bookmark bar (right-click a bookmark to remove), history panel, save-URL-to-case.' },
  { name: 'Mail', desc: 'IMAP receive + SMTP send. Multiple accounts. Drafts persist across launches. Compose supports file attachments. Inbound multipart messages are parsed and their attachments are downloadable via the OS save dialog.' },
  { name: 'DialTerm', desc: 'SSH client with a 90s dial-up handshake animation. Key-based auth recommended; passphrases/passwords encrypted in secrets.enc. Right-click for Copy/Paste; Ctrl+Shift+C / Ctrl+Shift+V also work.' },
  { name: 'EyeSpy', desc: 'Authorised camera streams only. HLS, MJPEG, and HTTP-refresh image streams play in-app. RTSP needs a local ffmpeg→HLS bridge — instructions shown on RTSP entry. No discovery or brute-force.' },
  { name: 'AI Assistant', desc: 'Pluggable Ollama (local) or OpenAI-compatible (https). Case context is opt-in per message — selected from the dropdown. API key encrypted in secrets.enc, never seen by the renderer. Use STFU to abort a running generation.' },
  { name: 'Jukebox', desc: 'WinAmp-styled audio player. Local MP3/OGG/FLAC/WAV/M4A + M3U playlists, spectrum visualizer. Internet radio is opt-in (off by default). Local files stream through a path-confined internal protocol.' },
  { name: 'GeoINT', desc: 'Pluggable geopolitical-monitoring dashboard. RSS/Atom/GeoJSON sources + OPML import, a Leaflet map on a tile server you configure, offline gazetteer geocoding. Network is opt-in (off by default). Save an event into a case as a record / link / note with an auto-linked location entity + timeline entry.' }
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl/⌘ + N', action: 'New (case if Cases focused; note if Notepad focused)' },
  { keys: 'Ctrl/⌘ + S', action: 'Save (Notepad)' },
  { keys: 'Ctrl/⌘ + W', action: 'Close the focused window' },
  { keys: 'Ctrl/⌘ + Tab', action: 'Cycle focus between open windows' },
  { keys: 'F1', action: 'Open Settings' },
  { keys: 'Esc', action: 'Dismiss the topmost dialog' },
  { keys: 'Ctrl + Shift + C', action: 'Copy selection (DialTerm)' },
  { keys: 'Ctrl + Shift + V', action: 'Paste (DialTerm)' }
];

export function HelpModule(): JSX.Element {
  return (
    <div className="ga98-stack">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <img src={logoUrl} alt="" style={{ width: 64, height: 64, imageRendering: 'pixelated', border: '1px solid #808080' }} />
        <div>
          <h2 style={{ margin: 0 }}>RTFM</h2>
          <p style={{ margin: 0, fontSize: 12 }}>Read the Friendly Manual — module reference + keyboard shortcuts</p>
        </div>
      </div>

      <fieldset>
        <legend>Keyboard shortcuts</legend>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td style={{ padding: '2px 12px 2px 0', whiteSpace: 'nowrap' }}><kbd>{s.keys}</kbd></td>
                <td style={{ padding: '2px 0' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <fieldset>
        <legend>Modules</legend>
        <dl style={{ margin: 0, fontSize: 12 }}>
          {MODULE_DOCS.map((m) => (
            <div key={m.name} style={{ marginBottom: 8 }}>
              <dt style={{ fontWeight: 'bold' }}>{m.name}</dt>
              <dd style={{ margin: '2px 0 0 12px' }}>{m.desc}</dd>
            </div>
          ))}
        </dl>
      </fieldset>

      <fieldset>
        <legend>Privacy</legend>
        <ul style={{ marginTop: 4, fontSize: 12, paddingLeft: 18 }}>
          <li>No telemetry. No analytics. No background phone-home.</li>
          <li>All network egress is initiated by an explicit user action (mail fetch, browser nav, AI request, stream view).</li>
          <li>Mail / SSH / AI credentials live in <code>secrets.enc</code>, encrypted via your OS keyring (DPAPI on Windows, Keychain on macOS, libsecret/KWallet on Linux). Plaintext credentials never touch disk.</li>
          <li>Every sound is synthesized at runtime via Web Audio — no copyrighted assets.</li>
        </ul>
      </fieldset>

      <fieldset>
        <legend>Where things live</legend>
        <p style={{ fontSize: 11 }}>Your data lives under the OS userData folder in a <code>GhostAccess98/</code> directory. Open <b>Settings → About</b> to see the exact path on your machine.</p>
      </fieldset>
    </div>
  );
}
