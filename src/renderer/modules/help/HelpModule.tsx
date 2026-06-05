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

// OpChildSafety — guidance (supplied by GhostExodus) for grassroots child-protection / OSINT
// investigators on reporting CSAM lawfully through proper channels WITHOUT viewing, downloading,
// or mishandling material. Static reference text; no network egress beyond opening an official
// reporting site in the OS browser when a link is clicked.
const OPCS_INTRO: string[] = [
  "If you're a pedo hunter, a grassroots, home-grown cyber investigator, or whatever the case may be, and you are interested in online child safeguarding, whether that be with the group Anonymous, some hacking group, or you just want to deliver justice, know this: online pedo-hunting may be your starting point, but if you're serious about safeguarding kids and catching dangerous threats, your real goal should be to end up doing Open-Source Intelligence (OSINT) work for a non-profit organization (NGO) where you can cause the greatest good in the lives of victims, and the greatest damage against online predators.",
  "As a grassroots child-protection investigator, you should understand that law enforcement agencies are not necessarily looking to work directly with vigilantes or independent hunters. By contrast, working through a recognised NGO or reporting organisation can add legitimacy and ensure information reaches the appropriate channels.",
  "Try not to become frustrated if your reports do not receive a response or appear to disappear into a system. Organisations such as NCMEC, CEOP, the IWF, HSI, and the FBI receive enormous volumes of reports every day and must prioritise cases based on risk, available evidence, jurisdiction, and available resources. Repeatedly submitting the same report or overwhelming agencies with follow-up messages is unlikely to help.",
  "Neither the FBI nor child-protection NGOs are generally concerned with whether you identify yourself as an OSINT investigator, hacker, cyber-vigilante, pedo hunter, member of Anonymous, or simply a concerned member of the public. What matters is whether the information you provide is accurate, relevant, lawful, and actionable.",
  "Collecting every possible piece of evidence from start to finish does not necessarily make their job easier. Investigators have legal authorities, forensic capabilities, subpoena powers, international partnerships, and access to information that private citizens do not. In many cases, the most useful contribution a member of the public can make is to provide a clear, concise report containing usernames, URLs, timestamps, platform information, and a factual description of what was observed, then allow trained investigators to take it from there.",
  "The goal should not be to build your own case. The goal should be to identify a potential threat, preserve relevant information lawfully, submit it through the proper channels, and let those with the legal authority to investigate determine the next steps."
];

const OPCS_DONT: { title: string; points: string[] }[] = [
  { title: 'Lack of Context or Misinterpretation', points: [
    'Inaccurate Analysis: Hunters may misinterpret or mislabel benign content as CSAM leading to false accusations. Ensure certainty that what you are reporting is true and accurate.',
    'Over-Reporting: Sending large volumes of poorly documented or irrelevant information can overwhelm authorities and make it harder to prioritize real threats.'
  ] },
  { title: 'Violating Legal Protocols', points: [
    'Possession of Illegal Content: Downloading, storing, or redistributing CSAM is a federal crime. This jeopardizes the hunter and the investigation.',
    'DDoS Attacks or Platform Interference: Attacking sites can destroy or obscure evidence, making it harder for law enforcement to track offenders.',
    'Public Disclosure: Sharing details of investigations on social media can alert offenders, prompting them to delete evidence or change methods.'
  ] },
  { title: 'Mishandling Evidence', points: [
    'Alteration of Metadata: Downloading, modifying, or re-uploading content changes critical metadata like timestamps or geolocation.',
    'Failure to Preserve Original Content: Screenshots or derivatives are often not enough for law enforcement.'
  ] },
  { title: 'Mixing Evidence with Personal Opinions', points: [
    'Biased Documentation: Including personal commentary or assumptions can taint a legitimate report.',
    'Confusion Over Intent: Interpreting data without expertise may introduce inaccuracies or false connections.'
  ] },
  { title: 'Lack of Verification', points: [
    'Submitting Unverified Content: Failing to confirm the legitimacy of flagged accounts or claims can lead to chasing false leads.',
    'Inadequate Documentation: Poorly documented evidence like incomplete URLs or missing timestamps hinders effective action.'
  ] }
];

const OPCS_AVOID: string[] = [
  'Follow Legal Procedures: Report directly to NCMEC or the FBI without tampering with data.',
  'Do Not Possess or Share Illegal Content: Simply describe what was seen without downloading or redistributing it.',
  'Use Approved Reporting Tools: Platforms provide tools to report CSAM while preserving evidence legally.',
  'Avoid Independent Investigations: Do not engage in hacking or interacting with suspects unless authorized.',
  'Maintain Confidentiality: Refrain from discussing evidence publicly to avoid tipping off suspects.'
];

const OPCS_WEBSITE: string[] = [
  'Report the URL/Domain to the domain controller. Use a WHOIS lookup (e.g. whois.domaintools.com) to retrieve registrar info and the abuse email, then email the abuse address.',
  'Identify the hosting company from the domain registrar. Search for the abuse email associated with the domain, then email the abuse address.',
  'If you have the IP address of an individual distributing CSAM, report the IP address to the internet service provider (look it up via WHOIS).'
];

const OPCS_REPORT: { name: string; blurb: string; url: string; phone?: string; region: string }[] = [
  { name: 'National Center for Missing & Exploited Children (NCMEC)', blurb: "A U.S. nonprofit with a special statutory role. U.S. law requires online providers to report apparent child sexual exploitation to NCMEC's CyberTipline, and NCMEC routes reports to law enforcement. It is not itself a police force; it does not prosecute or arrest.", url: 'https://report.cybertip.org/', phone: '+1 800-843-5678', region: 'United States' },
  { name: 'Internet Watch Foundation (IWF)', blurb: 'A UK charity and hotline, government-endorsed, working with police, platforms, hosting companies, and international hotlines to assess and remove online child sexual abuse material. Its analysts have legal protection to view suspected illegal material in the course of their work, but the IWF is not a police force.', url: 'https://www.iwf.org.uk/en/uk-report/', region: 'United Kingdom' },
  { name: 'Child Exploitation and Online Protection Command (CEOP)', blurb: 'A law enforcement command of the UK National Crime Agency. Its role is to protect children and young people from sexual exploitation, grooming, and abuse online. Reports go to CEOP Child Protection Advisors.', url: 'https://www.ceop.police.uk/ceop-reporting/', region: 'United Kingdom' },
  { name: 'Homeland Security Investigations (HSI)', blurb: 'The principal investigative arm of U.S. Immigration and Customs Enforcement (ICE). Through its Cyber Crimes Center (C3), HSI investigates child exploitation, online enticement, child sex trafficking, and CSAM offences. It has authority to investigate, execute warrants, and make arrests.', url: 'https://www.ice.gov/webform/ice-tip-form', phone: '+1 866-DHS-2-ICE (866-347-2423)', region: 'United States' },
  { name: 'Australian Centre to Counter Child Exploitation (ACCCE)', blurb: "Australia's national child-protection coordination centre. It brings together federal and state law enforcement agencies to investigate online child exploitation and child abuse material. Reports are assessed and routed to the appropriate investigative authorities.", url: 'https://www.accce.gov.au/report', region: 'Australia' },
  { name: 'Cybertip.ca', blurb: "Canada's national tipline for reporting the online sexual exploitation of children. Reports are reviewed by analysts and referred to law enforcement, child-protection agencies, or international partners when appropriate.", url: 'https://www.cybertip.ca/', phone: '1-866-658-9022', region: 'Canada' },
  { name: 'Europol Internet Referral Unit (IRU)', blurb: 'Works with law enforcement agencies across the European Union to identify and refer online criminal content, including material relating to child sexual exploitation. Members of the public should generally report through national police or national hotlines, but the IRU plays a major role in international coordination.', url: 'https://www.europol.europa.eu/', region: 'European Union' },
  { name: 'INHOPE Network', blurb: 'A global network of hotlines operating in dozens of countries. Its member hotlines receive reports of CSAM and work with law enforcement, hosting providers, and international partners to facilitate removal and investigation.', url: 'https://www.inhope.org/', region: 'International' },
  { name: 'National Crime Agency (NCA)', blurb: "The UK's national law enforcement agency. Through specialist commands, including CEOP, it investigates serious and organised crime involving child sexual exploitation, online grooming, trafficking, and abuse networks.", url: 'https://www.nationalcrimeagency.gov.uk/contact-us', region: 'United Kingdom' }
];

/** Opens a real reporting/reference site in the OS browser (never in-app) via the deny-by-default
 *  window-open path. Only http(s) URLs reach the OS; everything else is dropped in main. */
function ExtLink({ href }: { href: string }): JSX.Element {
  return (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); void window.api.system.openExternal(href); }}
      style={{ color: '#0000aa' }}
    >{href}</a>
  );
}

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
        <legend>OpChildSafety — child-safety reporting</legend>
        <div style={{ fontSize: 12 }}>
          <p style={{ marginTop: 0, fontWeight: 'bold' }}>Introduction</p>
          {OPCS_INTRO.map((p, i) => (
            <p key={i} style={{ margin: '0 0 8px' }}>{p}</p>
          ))}
          <p style={{
            margin: '8px 0', padding: '6px 8px', fontWeight: 'bold',
            color: '#900', background: '#ffecec', border: '1px solid #c00'
          }}>
            !!! DO NOT INTENTIONALLY VIEW, DOWNLOAD, SCREENSHOT, OR SEARCH FOR CSAM !!!
          </p>

          <p style={{ margin: '12px 0 4px', fontWeight: 'bold' }}>Preparing the report: what not to do</p>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {OPCS_DONT.map((d) => (
              <li key={d.title} style={{ marginBottom: 4 }}>
                <span style={{ fontWeight: 'bold' }}>{d.title}</span>
                <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
                  {d.points.map((pt, j) => <li key={j}>{pt}</li>)}
                </ul>
              </li>
            ))}
          </ol>

          <p style={{ margin: '12px 0 4px', fontWeight: 'bold' }}>How to avoid tainting evidence</p>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {OPCS_AVOID.map((a, i) => <li key={i}>{a}</li>)}
          </ol>

          <p style={{ margin: '12px 0 4px', fontWeight: 'bold' }}>Tools</p>
          <p style={{ margin: '0 0 4px' }}>
            Use tools that cannot view or cache images — prefer terminal-based, text-only browsers:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><code>w3m</code> — <code>sudo apt install w3m</code> (source: <ExtLink href="https://github.com/tats/w3m" />)</li>
            <li><code>lynx</code> — <code>sudo apt install lynx</code></li>
          </ul>

          <p style={{ margin: '12px 0 4px', fontWeight: 'bold' }}>When investigating a website for CSAM</p>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {OPCS_WEBSITE.map((w, i) => <li key={i}>{w}</li>)}
          </ol>

          <p style={{ margin: '12px 0 4px', fontWeight: 'bold' }}>Where to report CSAM</p>
          <div>
            {OPCS_REPORT.map((o) => (
              <div key={o.name} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 'bold' }}>{o.name} <span style={{ fontWeight: 'normal', opacity: 0.7 }}>— {o.region}</span></div>
                <div style={{ margin: '2px 0' }}>{o.blurb}</div>
                <div><ExtLink href={o.url} />{o.phone ? <span> · {o.phone}</span> : null}</div>
              </div>
            ))}
          </div>

          <p style={{ margin: '12px 0 0', fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 }}>
            OBSERVE. REPORT. CATCH THE PREDATOR. RESCUE THE VICTIM.
          </p>
        </div>
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
