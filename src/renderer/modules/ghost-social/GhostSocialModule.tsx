/**
 * Ghost Social Media Manager (hardened GI98 port) — Phase 4 renderer.
 *
 * A faithful port of GhostExodus's `src/App.tsx` (quarantine
 * `social-mgr-quar/ghost-social-media-manager/`) onto the GI98 seams. His UX is reproduced
 * verbatim; the hardening is enforced here on the renderer half (MAIN enforces the same
 * invariants authoritatively — the renderer flag is advisory):
 *
 *  - His `window.ghost.*` surface is rewired to `window.api.ghostSocial.*` (preload allow-list).
 *  - RECOVERY KEY (constraint 2): displayed on-screen + exported ONLY through a native save
 *    dialog (`vaultSaveRecoveryKey`) to a user-chosen path; NEVER auto-written to Desktop.
 *  - AUTO-POST ARM GATE (constraint 3, SAFETY-CRITICAL): the Scheduled Queue carries a default-OFF
 *    "Arm auto-posting" switch. Arming requires a one-time confirm naming the risk; a persistent
 *    "AUTO-POSTING ARMED" indicator shows (Queue page + global header marker) whenever armed. MAIN
 *    refuses to click Publish while disarmed regardless of this flag.
 *  - OVERLAY LIFECYCLE (constraint 9, the SDR regression class, MULTIPLIED): this module takes a
 *    `windowId`; `windowActive` = (focusStack top === id && !minimized). On blur/minimize the
 *    governor hides + detaches EVERY per-account view; a GI98 modal detaches them; module unmount
 *    tears them ALL down. The embedded browser view AND every compose-grid card obey this.
 *  - EGRESS (constraint 8): per-account clearnet-default + Tor opt-in behind a one-time warning,
 *    with a CLEARNET/TOR marker on the active view.
 *  - Media is name/type-only (NEVER uploaded); Inbox is STUBBED (returns []).
 *
 * The look is his TEAL console as a FIXED theme (`.gsm-root` + `--ga98-gsm-*`), identical under
 * classic + QUIET AMETHYST (constraint 10) — see ghost-social.css / theme.css.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Settings, Lock, Send, Inbox, History, ChevronDown, Trash2, Edit3, ArrowLeft, ArrowRight,
  RotateCw, Home, ExternalLink, Image, Video, MessageSquare, Search, X as Close, ShieldCheck,
  KeyRound, Save, LayoutDashboard, RefreshCw, Users, UserPlus, Pencil, GripVertical, CalendarClock,
  Play, Pause, ShieldAlert, ShieldOff,
} from './icons';
import type {
  Campaign, GhostState, SocialAccount, PlatformKey, InboxItem, BrowserCacheMode,
  ScheduledPost,
} from '@shared/ghost-social/types';
import { useWindows } from '../../state/store';
import { confirmDialog } from '../../state/dialogs';
import './ghost-social.css';

const gs = () => window.api.ghostSocial;

const platformOrder: PlatformKey[] = ['facebook', 'messenger', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube', 'bluesky', 'custom'];
const platformGlyph: Record<string, string> = { facebook: 'f', messenger: 'M', instagram: '◎', tiktok: '♪', linkedin: 'in', x: '𝕏', youtube: '▶', bluesky: '🦋', custom: '◉' };
const blankState: GhostState = { campaigns: [], selectedCampaignId: '', postHistory: [], messageNotes: [], browserCacheMode: 'recent3', scheduledPosts: [] };
const uid = (): string => crypto.randomUUID();
const fmt = (n: number | null | undefined): string =>
  n == null ? '—'
    : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B'
    : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
    : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K'
    : n.toLocaleString();

type Page = 'dashboard' | 'compose' | 'queue' | 'inbox' | 'history' | 'settings' | 'browser';

export function GhostSocialModule({ windowId }: { windowId: string }): JSX.Element {
  // Overlay-lifecycle governor input: this window is ACTIVE only when it is the top of the focus
  // stack and not minimized (the SDR window-active gate). Every per-account view shows ONLY then.
  const windowActive = useWindows((s) => {
    const top = s.focusStack[s.focusStack.length - 1];
    const win = s.windows.find((w) => w.id === windowId);
    return top === windowId && !!win && !win.minimized;
  });

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [state, setState] = useState<GhostState>(blankState);
  const [page, setPage] = useState<Page>('dashboard');
  const [activeAccount, setActiveAccount] = useState<SocialAccount | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [editAccount, setEditAccount] = useState<SocialAccount | null>(null);
  const [composer, setComposer] = useState({ text: '', mediaName: '', mediaType: '' });
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [cacheStatus, setCacheStatus] = useState<{ activeKey: string | null; cachedKeys: string[] }>({ activeKey: null, cachedKeys: [] });
  const [composeStatus, setComposeStatus] = useState<{ kind: 'idle' | 'working' | 'done' | 'warning'; text: string }>({ kind: 'idle', text: '' });
  const [armed, setArmed] = useState(false);
  const [showArmConfirm, setShowArmConfirm] = useState(false);
  const browserHost = useRef<HTMLDivElement | null>(null);
  // Finding 4: track the deferred-open timer + a mounted flag so a module unmount inside the 30ms
  // open window cannot create a native view AFTER teardown.
  const mountedRef = useRef(true);
  const openTimerRef = useRef<number | null>(null);

  const campaign = useMemo(() => state.campaigns.find((c) => c.id === state.selectedCampaignId) || state.campaigns[0], [state]);
  const persist = (next: GhostState): void => { setState(next); void gs().saveState(next).catch(() => {}); };
  const modifyCampaign = (fn: (c: Campaign) => Campaign): void => {
    if (!campaign) return;
    persist({ ...state, campaigns: state.campaigns.map((c) => (c.id === campaign.id ? fn(c) : c)) });
  };

  // A GI98 modal is open ⇒ MAIN must detach every native view so none floats over the veil.
  const modalOpen = showAdd || showCampaign || !!editAccount || recovery != null || showArmConfirm;

  useEffect(() => { void gs().vaultIsConfigured().then(setConfigured); }, []);

  useEffect(() => {
    if (!unlocked) return;
    void gs().getState().then((s) => {
      const hydrated = { ...s, browserCacheMode: s.browserCacheMode || 'recent3', scheduledPosts: s.scheduledPosts || [] } as GhostState;
      setState(hydrated);
      void gs().browserSetCacheMode(hydrated.browserCacheMode || 'recent3');
      if (!hydrated.selectedCampaignId && hydrated.campaigns[0]) persist({ ...hydrated, selectedCampaignId: hydrated.campaigns[0].id });
    });
    void gs().armGet().then(setArmed).catch(() => {});
  }, [unlocked]);

  // Host-anchored favicon fetch (hardening #3): register every account host so a legitimate
  // /favicon.ico is fetchable, and no other host ever is.
  useEffect(() => {
    if (!unlocked) return;
    const urls = state.campaigns.flatMap((c) => c.accounts.map((a) => a.url)).filter(Boolean);
    if (urls.length) void gs().browserRegisterHosts(urls).catch(() => {});
  }, [unlocked, state.campaigns]);

  useEffect(() => {
    if (!unlocked) return;
    return gs().onScheduledStateChanged(() => {
      void gs().getState().then((s) => setState({ ...s, browserCacheMode: s.browserCacheMode || 'recent3', scheduledPosts: s.scheduledPosts || [] } as GhostState)).catch(() => {});
    });
  }, [unlocked]);

  // ── overlay-lifecycle governor (constraint 9) ─────────────────────────────
  // 1. Report focus/minimize to MAIN: inactive ⇒ MAIN hides + detaches ALL views.
  useEffect(() => { void gs().browserSetWindowActive(windowActive).catch(() => {}); }, [windowActive]);
  // 2. A GI98 modal detaches every view while it is open (restored, no reload, on close).
  useEffect(() => { void gs().browserSetModal(modalOpen).catch(() => {}); }, [modalOpen]);
  // 3. Hide all views whenever we're not on a view-hosting page OR this window isn't active.
  useEffect(() => {
    if (!windowActive || (page !== 'browser' && page !== 'compose')) void gs().browserHide().catch(() => {});
  }, [page, windowActive]);
  // 4. Module unmount (window close) ⇒ tear down EVERY native view — no stray overlay survives — and
  //    cancel any pending deferred openAccount so it can't create a view after teardown (Finding 4).
  useEffect(() => () => {
    mountedRef.current = false;
    if (openTimerRef.current != null) { window.clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    void gs().browserCloseAll().catch(() => {});
  }, []);

  useEffect(() => {
    if (composeStatus.kind !== 'done' && composeStatus.kind !== 'warning') return;
    const t = window.setTimeout(() => setComposeStatus({ kind: 'idle', text: '' }), 4500);
    return () => window.clearTimeout(t);
  }, [composeStatus.kind, composeStatus.text]);

  // Embedded browser bounds tracking — the native view is positioned to this host region.
  useEffect(() => {
    if (page !== 'browser' || !browserHost.current || !windowActive) return;
    const update = (): void => {
      const r = browserHost.current!.getBoundingClientRect();
      // v3.72.1 blank-view fix: don't position the native view at 0×0 before the host has laid out (it
      // renders blank + can stay stuck there). Skip; the ResizeObserver re-fires on the real layout.
      if (r.width < 2 || r.height < 2) return;
      void gs().browserResize({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(browserHost.current);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [page, activeAccount, windowActive]);

  async function setup(): Promise<void> {
    setError('');
    if (password.length < 6) { setError('Use at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    try { const r = await gs().vaultSetup(password); setRecovery(r.recoveryKey); setUnlocked(true); }
    catch (e) { setError((e as Error)?.message || 'Setup failed'); }
  }
  async function unlock(): Promise<void> {
    setError('');
    (await gs().vaultUnlock(password.trim())) ? setUnlocked(true) : setError('Incorrect password or recovery key.');
  }
  async function lock(): Promise<void> {
    await gs().browserCloseAll(); await gs().vaultLock(); setUnlocked(false); setPassword(''); setPage('dashboard');
  }
  async function syncCacheStatus(): Promise<void> {
    const s = await gs().browserCacheStatus(); setCacheStatus({ activeKey: s.activeKey, cachedKeys: s.cachedKeys });
  }
  async function openAccount(a: SocialAccount): Promise<void> {
    if (!campaign) return;
    setActiveAccount(a); setPage('browser');
    const cid = campaign.id;
    // Finding 4: track the deferred open + guard on the mounted flag so an unmount within the 30ms
    // window cancels it (clearTimeout on unmount) and the late callback no-ops if it ever fires.
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(async () => {
      openTimerRef.current = null;
      if (!mountedRef.current) return;
      await gs().browserOpenAccount(cid, a);
      if (!mountedRef.current) return;
      // v3.72.1 blank-view fix: re-assert the host bounds after the view is created + the page starts
      // loading, in case the host laid out (or the ResizeObserver missed the initial 0→real transition)
      // — otherwise the freshly-created view can sit at 0×0 and render blank.
      const resync = (): void => {
        const h = browserHost.current;
        if (!h || !mountedRef.current) return;
        const r = h.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) {
          void gs().browserResize({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
        }
      };
      requestAnimationFrame(resync);
      for (const ms of [150, 500, 1200]) window.setTimeout(resync, ms);
      await syncCacheStatus();
    }, 30);
  }
  async function setCacheMode(mode: BrowserCacheMode): Promise<void> {
    persist({ ...state, browserCacheMode: mode }); await gs().browserSetCacheMode(mode); await syncCacheStatus();
  }
  async function deleteAccount(a: SocialAccount): Promise<void> {
    if (!campaign) return;
    if (!(await confirmDialog(`Delete ${a.username || a.name} from ${campaign.name}?\n\nIts saved Chromium session will also be cleared.`, 'Delete account'))) return;
    if (activeAccount?.id === a.id) { setActiveAccount(null); setPage('dashboard'); }
    await gs().browserDeleteAccountData(campaign.id, a.id).catch(() => false);
    await syncCacheStatus();
    modifyCampaign((c) => ({ ...c, accounts: c.accounts.filter((x) => x.id !== a.id) }));
  }
  async function addPlatform(key: PlatformKey, custom?: { name: string; url?: string; profileUrl?: string; username?: string }): Promise<void> {
    if (!campaign) return;
    const d = await gs().platformDefaults(key);
    const url = custom?.url || d.url;
    const name = custom?.name || d.name;
    const a: SocialAccount = { id: uid(), platform: key, name, url, profileUrl: custom?.profileUrl, username: custom?.username, enabled: true, capabilities: d.capabilities };
    // Host-anchor the favicon: register the new URL first so its own /favicon.ico is fetchable.
    await gs().browserRegisterHosts([url]).catch(() => {});
    a.favicon = (await gs().faviconFetch(url).catch(() => null)) || undefined;
    modifyCampaign((c) => ({ ...c, accounts: [...c.accounts, a] }));
    setShowAdd(false);
  }
  function saveAccount(next: SocialAccount): void { modifyCampaign((c) => ({ ...c, accounts: c.accounts.map((a) => (a.id === next.id ? next : a)) })); setEditAccount(null); }
  function newCampaign(name: string): void {
    const c = { id: uid(), name: name || 'New Campaign', accounts: [], notes: '' };
    persist({ ...state, campaigns: [...state.campaigns, c], selectedCampaignId: c.id }); setShowCampaign(false);
  }
  async function deleteCampaign(id: string): Promise<void> {
    if (state.campaigns.length === 1) { await confirmDialog('Create another campaign before deleting this one.', 'Cannot delete'); return; }
    const cs = state.campaigns.filter((c) => c.id !== id);
    persist({ ...state, campaigns: cs, selectedCampaignId: cs[0].id });
  }
  // Manual Composer publish — PREPARE-ONLY (constraint / G5). Fills each destination's composer in
  // its authenticated view and STOPS; the human clicks the platform's own Publish. Never armed,
  // never clicks Publish, never touches the arm gate.
  async function publish(): Promise<void> {
    if (!campaign || (!composer.text.trim() && !composer.mediaName)) return;
    const dest = campaign.accounts.filter((a) => a.enabled && a.composeEnabled !== false);
    if (!dest.length) { setComposeStatus({ kind: 'warning', text: 'Turn on at least one destination in Compose.' }); return; }
    setComposeStatus({ kind: 'working', text: `Preparing ${dest.length} destination${dest.length === 1 ? '' : 's'}…` });
    persist({ ...state, postHistory: [{ id: uid(), at: new Date().toISOString(), text: composer.text, destinations: dest.map((a) => a.name), status: 'queued' }, ...state.postHistory] });
    const results: Array<[string, { status: string; message: string }]> = [];
    for (const a of dest) {
      try {
        const result = await gs().publishPrepare(campaign.id, a, { text: composer.text, mediaType: composer.mediaType });
        results.push([a.username || a.name, { status: String(result?.status || 'prepared'), message: String(result?.message || 'Composer prepared in the live account tile.') }]);
      } catch (e) { results.push([a.username || a.name, { status: 'failed', message: (e as Error)?.message || String(e) }]); }
    }
    const failed = results.filter(([, r]) => r.status === 'failed' || r.status === 'unsupported');
    const needsReview = results.filter(([, r]) => /could not|manual|verify/i.test(r.message));
    const summary = results.map(([name, r]) => `${name}: ${r.message}`).join('  •  ');
    setComposeStatus({ kind: failed.length || needsReview.length ? 'warning' : 'done', text: summary });
  }
  function toggleComposeDestination(id: string): void {
    setState((prev) => {
      const selectedId = prev.selectedCampaignId || prev.campaigns[0]?.id;
      const next = { ...prev, campaigns: prev.campaigns.map((c) => (c.id !== selectedId ? c : { ...c, accounts: c.accounts.map((a) => (a.id === id ? { ...a, composeEnabled: !(a.composeEnabled !== false) } : a)) })) };
      void gs().saveState(next).catch(() => {});
      return next;
    });
  }
  function reorderComposeTiles(ids: string[]): void { modifyCampaign((c) => ({ ...c, composeTileOrder: ids })); }
  function loadInbox(): void { setInbox([]); setPage('inbox'); } // Inbox STUBBED — returns [].
  async function refreshStats(a: SocialAccount): Promise<void> {
    if (!campaign) return;
    setRefreshing((r) => ({ ...r, [a.id]: true }));
    try {
      const stats = await gs().statsRefresh(campaign.id, a);
      modifyCampaign((c) => ({ ...c, accounts: c.accounts.map((x) => (x.id === a.id ? { ...x, profileUrl: stats.resolvedProfileUrl || x.profileUrl, stats } : x)) }));
    } finally { setRefreshing((r) => ({ ...r, [a.id]: false })); }
  }
  async function refreshAll(): Promise<void> { if (!campaign) return; for (const a of campaign.accounts) await refreshStats(a); }

  // ── THE AUTO-POST ARM GATE (constraint 3) ─────────────────────────────────
  function requestArm(): void { setShowArmConfirm(true); } // one-time confirm before arming
  // Finding 1 (renderer half): after arm/disarm succeeds, resync React `state.autoPostArmed` too, so
  // a later unrelated persist() never writes back a STALE flag. MAIN's saveGhostState is the
  // authoritative guard; this keeps the renderer from ever sending a wrong value in the first place.
  async function confirmArm(): Promise<void> { setShowArmConfirm(false); const a = await gs().armSet(true); setArmed(a); setState((s) => ({ ...s, autoPostArmed: a })); }
  async function disarm(): Promise<void> { const a = await gs().armSet(false); setArmed(a); setState((s) => ({ ...s, autoPostArmed: a })); } // disarming is always safe
  async function setAccountEgress(a: SocialAccount, torEnabled: boolean): Promise<{ showWarning: boolean }> {
    if (!campaign) return { showWarning: false };
    const res = await gs().browserApplyEgress(campaign.id, a.id, torEnabled).catch(() => ({ mode: 'clearnet' as const, showWarning: false }));
    modifyCampaign((c) => ({ ...c, accounts: c.accounts.map((x) => (x.id === a.id ? { ...x, torEnabled } : x)) }));
    return { showWarning: res.showWarning };
  }

  if (configured === null) return <div className="gsm-root"><div className="gsm-splash">GHOST SOCIAL MEDIA MANAGER</div></div>;
  if (!unlocked) return <div className="gsm-root"><Auth configured={configured} password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} error={error} setup={setup} unlock={unlock} /></div>;
  if (recovery) return <div className="gsm-root"><Recovery keyText={recovery} close={() => setRecovery(null)} /></div>;

  return <div className="gsm-root"><div className="gsm-shell">
    <aside className="gsm-sidebar">
      <div className="gsm-brand"><div className="gsm-ghost-mark">G</div><div><b>GHOST</b><span>SOCIAL MEDIA MANAGER</span></div></div>
      <div className="gsm-section-label">CAMPAIGNS <button title="New campaign" onClick={() => setShowCampaign(true)}><Plus size={14} /></button></div>
      <div className="gsm-campaign-list">{state.campaigns.map((c) => (
        <button key={c.id} className={'gsm-campaign ' + (c.id === campaign?.id ? 'selected' : '')} onClick={async () => { await gs().browserHide(); setActiveAccount(null); setPage('dashboard'); persist({ ...state, selectedCampaignId: c.id }); }}>
          <ChevronDown size={14} /><span>{c.name}</span><small>{c.accounts.length}</small>
        </button>))}</div>
      {campaign && <div className="gsm-accounts">{campaign.accounts.map((a) => {
        const key = `${campaign.id}::${a.id}`;
        const live = cacheStatus.cachedKeys.includes(key);
        return <div className={'gsm-account-row ' + (activeAccount?.id === a.id && page === 'browser' ? 'active' : '')} key={a.id}>
          <button className="gsm-account-open" onClick={() => openAccount(a)}>{a.favicon ? <img src={a.favicon} alt="" /> : <i>{platformGlyph[a.platform]}</i>}<span>{a.username || a.name}</span><b className={'gsm-status-dot ' + (live ? 'live' : 'suspended')} title={live ? 'Page cached and ready' : 'Page not currently cached'} /></button>
          <button title="Edit account" className="gsm-row-action" onClick={() => setEditAccount(a)}><Pencil size={13} /></button>
          <button title="Delete account" className="gsm-row-action gsm-danger-icon" onClick={() => deleteAccount(a)}><Trash2 size={13} /></button>
        </div>;
      })}</div>}
      <button className="gsm-add-account" onClick={() => setShowAdd(true)}><Plus size={14} /> ADD ACCOUNT</button>
      <nav className="gsm-nav">
        <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}><LayoutDashboard />Dashboard</button>
        <button className={page === 'compose' ? 'active' : ''} onClick={() => setPage('compose')}><Send />Compose</button>
        <button className={page === 'queue' ? 'active' : ''} onClick={() => setPage('queue')}><CalendarClock />Scheduled Queue</button>
        <button className={page === 'inbox' ? 'active' : ''} onClick={loadInbox}><Inbox />Unified Inbox</button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}><History />Post History</button>
      </nav>
      <div className="gsm-sidebar-bottom"><button onClick={() => setPage('settings')}><Settings />Settings</button><button onClick={lock}><Lock />Lock</button></div>
    </aside>
    <main className="gsm-main">
      <header className="gsm-header">
        <div><span className="gsm-eyebrow">CAMPAIGN</span><b>{campaign?.name || 'No Campaign'}</b></div>
        <div className="gsm-header-right">
          {armed && <span className="gsm-armed-marker" title="Scheduled jobs will auto-click Publish on live accounts"><span />AUTO-POSTING ARMED</span>}
          <div className="gsm-vault-ok"><span />LOCAL VAULT UNLOCKED</div>
        </div>
      </header>
      {page === 'dashboard' && <Dashboard campaign={campaign} state={state} compose={() => setPage('compose')} inbox={loadInbox} openAccount={openAccount} refresh={refreshStats} refreshAll={refreshAll} refreshing={refreshing} edit={setEditAccount} />}
      {page === 'compose' && <Composer campaign={campaign} value={composer} setValue={setComposer} publish={publish} toggleCompose={toggleComposeDestination} reorderTiles={reorderComposeTiles} campaignId={campaign?.id} composeStatus={composeStatus} windowActive={windowActive} />}
      {page === 'queue' && <QueuePage campaign={campaign} state={state} persist={persist} armed={armed} requestArm={requestArm} disarm={disarm} />}
      {page === 'inbox' && <InboxPage campaign={campaign} inbox={inbox} openAccount={openAccount} />}
      {page === 'history' && <HistoryPage state={state} />}
      {page === 'settings' && <SettingsPage campaign={campaign} rename={(name: string) => modifyCampaign((c) => ({ ...c, name }))} remove={() => campaign && deleteCampaign(campaign.id)} lock={lock} cacheMode={state.browserCacheMode || 'recent3'} setCacheMode={setCacheMode} />}
      {page === 'browser' && <BrowserPage account={activeAccount} host={browserHost} />}
    </main>
    {showAdd && <AddAccount close={() => setShowAdd(false)} add={addPlatform} />}
    {showCampaign && <CampaignModal close={() => setShowCampaign(false)} add={newCampaign} />}
    {editAccount && <AccountModal account={editAccount} close={() => setEditAccount(null)} save={saveAccount} setEgress={setAccountEgress} />}
    {showArmConfirm && <ArmConfirm close={() => setShowArmConfirm(false)} confirm={confirmArm} />}
  </div></div>;
}

function Auth(p: {
  configured: boolean; password: string; setPassword: (v: string) => void; confirm: string;
  setConfirm: (v: string) => void; error: string; setup: () => void; unlock: () => void;
}): JSX.Element {
  return <div className="gsm-auth-page"><div className="gsm-auth-card">
    <div className="gsm-logo-large">G</div><h1>GHOST</h1><p>SOCIAL MEDIA MANAGER</p>
    <div className="gsm-secure"><ShieldCheck size={16} /> ENCRYPTED LOCAL WORKSPACE</div>
    <label>{p.configured ? 'PASSWORD OR RECOVERY KEY' : 'CREATE MASTER PASSWORD'}</label>
    <input type="password" value={p.password} onChange={(e) => p.setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (p.configured ? p.unlock() : p.setup())} />
    {!p.configured && <><label>CONFIRM PASSWORD</label><input type="password" value={p.confirm} onChange={(e) => p.setConfirm(e.target.value)} /></>}
    {p.error && <div className="gsm-error">{p.error}</div>}
    <button className="gsm-primary" onClick={p.configured ? p.unlock : p.setup}><KeyRound size={17} />{p.configured ? 'UNLOCK' : 'CREATE VAULT'}</button>
  </div></div>;
}

// Recovery-key display + EXPORT (hardening #2): shown once for the user to record; export goes
// ONLY through the native save dialog to a user-chosen path — NEVER auto-written to Desktop.
function Recovery({ keyText, close }: { keyText: string; close: () => void }): JSX.Element {
  const [saved, setSaved] = useState('');
  return <div className="gsm-auth-page"><div className="gsm-auth-card gsm-recovery">
    <KeyRound size={40} /><h2>RECOVERY KEY</h2>
    <p>Store this somewhere private. It can unlock your local Ghost vault.</p>
    <code>{keyText}</code>
    <div className="gsm-recovery-warn">This key can unlock your vault. Save it to an encrypted or offline location — anyone who reads the file can open your workspace. Ghost never writes it anywhere unless you choose a location below.</div>
    <button className="gsm-primary" onClick={async () => {
      const res = await gs().vaultSaveRecoveryKey(keyText);
      setSaved(res.saved ? `Saved: ${res.filePath ?? ''}` : 'Export cancelled — nothing was written.');
    }}><Save size={16} />EXPORT TO FILE…</button>
    {saved && <small>{saved}</small>}
    <button className="gsm-secondary" onClick={close}>CONTINUE TO GHOST</button>
  </div></div>;
}

function ArmConfirm({ close, confirm }: { close: () => void; confirm: () => void }): JSX.Element {
  return <div className="gsm-modal-backdrop"><div className="gsm-modal small">
    <div className="gsm-modal-head"><div><span>SAFETY</span><h2>Arm auto-posting?</h2></div><button onClick={close}><Close /></button></div>
    <div className="gsm-custom-form">
      <div className="gsm-recovery-warn">Arming lets Ghost automatically click <b>Publish</b> on your live accounts at each scheduled job's time — with no per-post review. A wrong or early post to real audiences cannot be undone. Only arm when you are certain your queue is correct.</div>
      <div className="gsm-queue-actions">
        <button className="gsm-secondary" onClick={close}>CANCEL</button>
        <button className="gsm-danger" onClick={confirm}><ShieldAlert size={15} />ARM AUTO-POSTING</button>
      </div>
    </div>
  </div></div>;
}

function Dashboard({ campaign, state, compose, inbox, openAccount, refresh, refreshAll, refreshing, edit }: {
  campaign?: Campaign; state: GhostState; compose: () => void; inbox: () => void; openAccount: (a: SocialAccount) => void;
  refresh: (a: SocialAccount) => void; refreshAll: () => void; refreshing: Record<string, boolean>; edit: (a: SocialAccount) => void;
}): JSX.Element {
  return <section className="gsm-page">
    <div className="gsm-hero"><div><span>CONTROL CENTRE</span><h1>{campaign?.name}</h1><p>Session-only campaign management. No platform API keys or developer accounts required.</p></div>
      <div className="gsm-hero-actions"><button className="gsm-primary" onClick={compose}><Send />CREATE POST</button><button className="gsm-secondary" onClick={inbox}><Inbox />OPEN INBOX</button></div></div>
    <div className="gsm-metrics">
      <Metric n={campaign?.accounts.length || 0} label="ACCOUNTS" />
      <Metric n={campaign?.accounts.filter((a) => a.enabled).length || 0} label="ENABLED" />
      <Metric n={campaign?.accounts.filter((a) => a.stats?.status === 'ok' || a.stats?.status === 'partial').length || 0} label="STATS SYNCED" />
      <Metric n={state.postHistory.length} label="POST RECORDS" />
    </div>
    <div className="gsm-section-head"><h3>CONNECTED ACCOUNTS</h3><button className="gsm-secondary gsm-compact-btn" onClick={refreshAll}><RefreshCw size={14} />REFRESH ALL STATS</button></div>
    <div className="gsm-account-grid">{campaign?.accounts.length
      ? campaign.accounts.map((a) => <AccountCard key={a.id} a={a} open={() => openAccount(a)} refresh={() => refresh(a)} edit={() => edit(a)} spinning={!!refreshing[a.id]} />)
      : <div className="gsm-empty">No accounts yet. Use <b>+ Add Account</b> in the sidebar.</div>}</div>
  </section>;
}
function AccountCard({ a, open, refresh, edit, spinning }: { a: SocialAccount; open: () => void; refresh: () => void; edit: () => void; spinning: boolean }): JSX.Element {
  const s = a.stats;
  return <div className="gsm-account-card">
    <div className="gsm-account-card-top" onClick={open}>{a.favicon ? <img src={a.favicon} alt="" /> : <i>{platformGlyph[a.platform]}</i>}
      <div><b>{a.username || a.name}</b><span>{a.platform === 'custom' ? a.name : a.platform === 'x' ? 'X / Twitter' : a.platform[0].toUpperCase() + a.platform.slice(1)}</span></div>
      <em className={a.enabled ? 'connected' : 'disabled'}>{a.enabled ? 'ENABLED' : 'OFF'}</em><ExternalLink size={15} /></div>
    <div className="gsm-social-stats">
      <div><Users size={15} /><span><small>{s?.followersLabel || 'Followers'}</small><strong>{fmt(s?.followers)}</strong></span></div>
      <div><UserPlus size={15} /><span><small>{s?.followingLabel || 'Following'}</small><strong>{fmt(s?.following)}</strong></span></div></div>
    <div className="gsm-stats-footer"><span>{s?.refreshedAt ? `Updated ${new Date(s.refreshedAt).toLocaleString()}` : (a.profileUrl ? 'Not refreshed yet' : 'Auto-discovery ready')}</span>
      <div><button title="Edit profile URL" onClick={edit}><Edit3 size={14} /></button><button title="Refresh followers/following" onClick={refresh} disabled={spinning}><RefreshCw className={spinning ? 'gsm-spin' : ''} size={14} /></button></div></div>
  </div>;
}
function Metric({ n, label }: { n: number; label: string }): JSX.Element { return <div className="gsm-metric"><strong>{n}</strong><span>{label}</span></div>; }

function Composer({ campaign, campaignId, value, setValue, publish, toggleCompose, reorderTiles, composeStatus, windowActive }: {
  campaign?: Campaign; campaignId?: string; value: { text: string; mediaName: string; mediaType: string };
  setValue: (v: { text: string; mediaName: string; mediaType: string }) => void; publish: () => void;
  toggleCompose: (id: string) => void; reorderTiles: (ids: string[]) => void;
  composeStatus: { kind: string; text: string }; windowActive: boolean;
}): JSX.Element {
  const mediaInput = useRef<HTMLInputElement | null>(null);
  const hosts = useRef<Record<string, HTMLDivElement | null>>({});
  const [refreshingViews, setRefreshingViews] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const rawAccounts: SocialAccount[] = campaign?.accounts || [];
  const order: string[] = campaign?.composeTileOrder || [];
  const rank = new Map(order.map((id, i) => [id, i]));
  const orderedAccounts = [...rawAccounts].sort((a, b) => (rank.get(a.id) ?? 999999) - (rank.get(b.id) ?? 999999));
  const wallAccounts = orderedAccounts.filter((a) => a.enabled && a.composeEnabled !== false);
  useEffect(() => {
    // The Live Account Wall's grid of per-account views is governed by the overlay lifecycle: it
    // only shows while THIS window is active; blur/minimize/unmount hides + tears the grid down.
    if (!campaignId || !windowActive) { void gs().browserHide(); return; }
    let cancelled = false;
    const update = (): void => {
      if (cancelled) return;
      const items = wallAccounts.map((a) => {
        const el = hosts.current[a.id];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const visible = r.bottom > 76 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
        return { account: a, bounds: visible ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) } : { x: -20000, y: -20000, width: 1, height: 1 } };
      }).filter(Boolean) as Array<{ account: SocialAccount; bounds: { x: number; y: number; width: number; height: number } }>;
      if (items.length) void gs().browserShowGrid(campaignId, items); else void gs().browserHide();
    };
    const timer = setTimeout(update, 100);
    const ro = new ResizeObserver(update);
    setTimeout(() => Object.values(hosts.current).forEach((el) => { if (el) ro.observe(el); }), 0);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => { cancelled = true; clearTimeout(timer); ro.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); void gs().browserHide(); };
  }, [campaignId, windowActive, wallAccounts.map((a) => a.id).join('|')]);
  async function refreshView(a: SocialAccount): Promise<void> {
    if (!campaignId) return;
    setRefreshingViews((v) => ({ ...v, [a.id]: true }));
    try { await gs().browserRefresh(campaignId, a.id); } finally { setTimeout(() => setRefreshingViews((v) => ({ ...v, [a.id]: false })), 600); }
  }
  function dropOn(targetId: string): void {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const ids = orderedAccounts.map((a) => a.id);
    const from = ids.indexOf(draggedId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDraggedId(null); return; }
    ids.splice(from, 1); ids.splice(to, 0, draggedId); reorderTiles(ids); setDraggedId(null);
  }
  return <section className="gsm-page gsm-compose-page">
    <div className="gsm-page-title"><div><span>PUBLISHING</span><h1>Universal Composer</h1></div></div>
    <div className="gsm-compose-layout">
      <div className="gsm-panel gsm-composer"><label>MASTER POST</label>
        <textarea placeholder="What do you want to publish?" value={value.text} onChange={(e) => setValue({ ...value, text: e.target.value })} />
        <div className="gsm-media-row">
          <input ref={mediaInput} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setValue({ ...value, mediaName: f.name, mediaType: f.type }); }} />
          <button onClick={() => mediaInput.current?.click()}><Image />PHOTO</button>
          <button onClick={() => mediaInput.current?.click()}><Video />VIDEO</button>
          {value.mediaName && <span>{value.mediaName}<button onClick={() => setValue({ ...value, mediaName: '', mediaType: '' })}><Close size={13} /></button></span>}
        </div>
        <div className="gsm-composer-footer"><span>{value.text.length} characters</span>
          <button className="gsm-primary" onClick={publish} disabled={composeStatus?.kind === 'working'}><Send />{composeStatus?.kind === 'working' ? 'PREPARING…' : 'PREPARE IN OPEN TILES'}</button></div>
        {composeStatus?.text && <div className={'gsm-compose-status ' + composeStatus.kind}>{composeStatus.text}</div>}
      </div>
      <div className="gsm-panel gsm-destinations"><label>DESTINATIONS / LIVE TILES</label>{orderedAccounts.map((a) => {
        const incompatible = (value.mediaType.startsWith('image') && !a.capabilities.image) || (value.mediaType.startsWith('video') && !a.capabilities.video) || (!value.mediaName && !!value.text && !a.capabilities.text);
        const on = a.enabled && a.composeEnabled !== false;
        return <div className="gsm-destination" key={a.id}>
          <div>{a.favicon ? <img src={a.favicon} alt="" /> : <i>{platformGlyph[a.platform]}</i>}<span><b>{a.username || a.name}</b><small>{!a.enabled ? 'Account disabled' : !on ? 'Closed in account wall' : incompatible ? 'Open tile · content may be incompatible' : 'Open in account wall'}</small></span></div>
          <button disabled={!a.enabled} title={on ? 'Close this account tile' : 'Open this account tile'} type="button" aria-pressed={on} className={'gsm-switch ' + (on ? 'on' : '')} onClick={() => toggleCompose(a.id)}><span /></button>
        </div>;
      })}</div>
    </div>
    <div className="gsm-compose-live-head"><div><span>LIVE ACCOUNT WALL</span><h2>Campaign Accounts</h2></div><p>Two accounts per row. Drag a tile header to rearrange it. Destination switches control which tiles are open.</p></div>
    <div className="gsm-compose-browser-grid">{wallAccounts.length
      ? wallAccounts.map((a) => <div className={'gsm-compose-browser-card ' + (draggedId === a.id ? 'dragging' : '')} key={a.id} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(a.id)}>
        <div className="gsm-compose-browser-title" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDraggedId(a.id); }} onDragEnd={() => setDraggedId(null)}>
          <div><GripVertical className="gsm-drag-grip" size={14} />{a.favicon ? <img src={a.favicon} alt="" /> : <i>{platformGlyph[a.platform]}</i>}<span><b>{a.username || a.name}</b><small>{a.name} · drag to rearrange</small></span></div>
          <button title="Refresh this account window" onClick={(e) => { e.stopPropagation(); refreshView(a); }}><RefreshCw className={refreshingViews[a.id] ? 'gsm-spin' : ''} size={14} /> REFRESH</button>
        </div>
        <div className="gsm-compose-browser-host" ref={(el) => { hosts.current[a.id] = el; }} />
      </div>)
      : <div className="gsm-panel gsm-empty gsm-compose-empty">Turn on a Destination above to open its authenticated account tile here.</div>}</div>
  </section>;
}

function InboxPage({ campaign, inbox, openAccount }: { campaign?: Campaign; inbox: InboxItem[]; openAccount: (a: SocialAccount) => void }): JSX.Element {
  const [q, setQ] = useState('');
  return <section className="gsm-page"><div className="gsm-page-title"><div><span>COMMUNICATIONS</span><h1>Unified Inbox</h1></div>
    <div className="gsm-search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages..." /></div></div>
    <div className="gsm-inbox-layout"><div className="gsm-panel">{inbox.length
      ? inbox.filter((i) => i.sender.toLowerCase().includes(q.toLowerCase()) || i.preview.toLowerCase().includes(q.toLowerCase())).map((i) => <div className="gsm-history-row" key={i.id}><i>{platformGlyph[i.platform]}</i><div><b>{i.sender}</b><span>{i.preview}</span></div><small>{i.timestamp}</small></div>)
      : <div className="gsm-empty"><MessageSquare size={36} /><b>No captured messages yet.</b><p>Ghost reads messages against your authenticated Chromium sessions. This reader is not yet available; open an account to work with it directly.</p>{campaign?.accounts.filter((a) => a.capabilities.messages).map((a) => <button className="gsm-secondary" key={a.id} onClick={() => openAccount(a)}>OPEN {(a.username || a.name).toUpperCase()}</button>)}</div>}</div>
      <div className="gsm-panel"><div className="gsm-empty">Select a conversation when captured messages are available.</div></div></div>
  </section>;
}

function QueuePage({ campaign, state, persist, armed, requestArm, disarm }: {
  campaign?: Campaign; state: GhostState; persist: (s: GhostState) => void; armed: boolean; requestArm: () => void; disarm: () => void;
}): JSX.Element {
  const nowLocal = (): string => { const d = new Date(Date.now() + 30 * 60 * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const emptyDraft = () => ({ id: '', text: '', scheduledFor: nowLocal(), destinationAccountIds: (campaign?.accounts || []).filter((a) => a.enabled && a.capabilities.text).map((a) => a.id) });
  const [draft, setDraft] = useState<{ id: string; text: string; scheduledFor: string; destinationAccountIds: string[] }>(emptyDraft());
  const [editing, setEditing] = useState<string | null>(null);
  const [runNote, setRunNote] = useState('');
  const posts: ScheduledPost[] = (state.scheduledPosts || []).filter((p) => p.campaignId === campaign?.id).sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  useEffect(() => { setEditing(null); setDraft(emptyDraft()); }, [campaign?.id]);
  function save(): void {
    if (!campaign || !draft.text.trim() || !draft.destinationAccountIds.length) return;
    const when = new Date(draft.scheduledFor);
    if (Number.isNaN(when.getTime())) return;
    const all: ScheduledPost[] = state.scheduledPosts || [];
    const t = new Date().toISOString();
    if (editing) { const next = all.map((p) => (p.id === editing ? { ...p, text: draft.text.trim(), scheduledFor: when.toISOString(), destinationAccountIds: [...draft.destinationAccountIds], status: 'scheduled' as const, updatedAt: t, results: {} } : p)); persist({ ...state, scheduledPosts: next }); }
    else { const p: ScheduledPost = { id: uid(), campaignId: campaign.id, text: draft.text.trim(), scheduledFor: when.toISOString(), destinationAccountIds: [...draft.destinationAccountIds], status: 'scheduled', createdAt: t, updatedAt: t, results: {} }; persist({ ...state, scheduledPosts: [...all, p] }); }
    setEditing(null); setDraft(emptyDraft());
  }
  function edit(p: ScheduledPost): void { const d = new Date(p.scheduledFor); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); setEditing(p.id); setDraft({ id: p.id, text: p.text, scheduledFor: d.toISOString().slice(0, 16), destinationAccountIds: [...p.destinationAccountIds] }); }
  async function remove(id: string): Promise<void> { if (!(await confirmDialog('Remove this scheduled post from the queue?', 'Remove'))) return; persist({ ...state, scheduledPosts: (state.scheduledPosts || []).filter((p) => p.id !== id) }); if (editing === id) { setEditing(null); setDraft(emptyDraft()); } }
  function toggleDestination(id: string): void { setDraft((d) => ({ ...d, destinationAccountIds: d.destinationAccountIds.includes(id) ? d.destinationAccountIds.filter((x) => x !== id) : [...d.destinationAccountIds, id] })); }
  function togglePause(p: ScheduledPost): void { persist({ ...state, scheduledPosts: (state.scheduledPosts || []).map((x) => (x.id === p.id ? { ...x, status: x.status === 'paused' ? 'scheduled' : 'paused', updatedAt: new Date().toISOString() } : x)) }); }
  async function runNow(id: string): Promise<void> {
    const res = await gs().scheduledRunNow(id);
    setRunNote(res.disarmed ? 'Auto-posting is disarmed — nothing was published. Arm auto-posting or publish manually.' : res.ran ? 'Job published.' : 'Job could not run.');
    window.setTimeout(() => setRunNote(''), 5000);
  }
  return <section className="gsm-page gsm-queue-page">
    <div className="gsm-page-title"><div><span>AUTOMATION</span><h1>Scheduled Queue</h1></div>
      <div className="gsm-queue-engine"><span className="gsm-cache-dot live" /> Scheduler active while Ghost is open and the vault is unlocked</div></div>

    {/* THE AUTO-POST ARM GATE (constraint 3) — default-OFF; arming needs a one-time confirm. */}
    <div className={'gsm-panel gsm-arm-panel ' + (armed ? 'armed' : '')}>
      <div>
        <h3>{armed ? 'AUTO-POSTING ARMED' : 'AUTO-POSTING DISARMED'}</h3>
        <p>{armed
          ? 'Ghost will automatically click Publish on your live accounts at each scheduled job’s time. Disarm to require manual review.'
          : 'Scheduled jobs are prepared but Ghost will NOT click Publish. Arm auto-posting to allow automatic posting to live accounts.'}</p>
      </div>
      <div className="gsm-arm-switch">
        <label>{armed ? 'ARMED' : 'ARM'}</label>
        <button type="button" role="switch" aria-checked={armed} aria-label="Arm auto-posting" className={'gsm-switch ' + (armed ? 'on' : '')} onClick={() => (armed ? disarm() : requestArm())}><span /></button>
      </div>
    </div>
    {runNote && <div className="gsm-compose-status warning">{runNote}</div>}

    <div className="gsm-queue-layout">
      <div className="gsm-panel gsm-queue-editor"><label>{editing ? 'EDIT QUEUED POST' : 'CREATE QUEUED POST'}</label>
        <textarea placeholder="Type the message Ghost should publish automatically..." value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <div className="gsm-queue-date"><label>SCHEDULE DATE &amp; TIME<div><input type="datetime-local" value={draft.scheduledFor} onChange={(e) => setDraft({ ...draft, scheduledFor: e.target.value })} /></div></label></div>
        <label>DESTINATIONS</label>
        <div className="gsm-queue-destinations">{campaign?.accounts.map((a) => {
          const selected = draft.destinationAccountIds.includes(a.id);
          const supported = a.enabled && a.capabilities.text && a.platform !== 'messenger';
          return <button key={a.id} type="button" disabled={!supported} className={selected && supported ? 'selected' : ''} onClick={() => supported && toggleDestination(a.id)}>
            {a.favicon ? <img src={a.favicon} alt="" /> : <i>{platformGlyph[a.platform]}</i>}
            <span>{a.username || a.name}<small>{!a.enabled ? 'Disabled' : !a.capabilities.text ? 'Text-only posting unavailable' : 'Automatic text post'}</small></span>
            <b>{selected && supported ? 'ON' : 'OFF'}</b></button>;
        })}</div>
        <div className="gsm-queue-actions">{editing && <button className="gsm-secondary" onClick={() => { setEditing(null); setDraft(emptyDraft()); }}>CANCEL EDIT</button>}
          <button className="gsm-primary" onClick={save}><CalendarClock size={15} />{editing ? 'SAVE CHANGES' : 'ADD TO QUEUE'}</button></div>
      </div>
      <div className="gsm-queue-list"><div className="gsm-section-head"><h3>UPCOMING / RECENT</h3><span>{posts.length} POST{posts.length === 1 ? '' : 'S'}</span></div>
        {posts.length ? posts.map((p) => {
          const names = p.destinationAccountIds.map((id) => campaign?.accounts.find((a) => a.id === id)?.username || campaign?.accounts.find((a) => a.id === id)?.name).filter(Boolean);
          return <div className={'gsm-queue-card status-' + p.status} key={p.id}>
            <div className="gsm-queue-card-head"><div><b>{new Date(p.scheduledFor).toLocaleString()}</b><span>{p.status.toUpperCase()}</span></div>
              <div><button title="Edit" onClick={() => edit(p)}><Edit3 size={14} /></button>
                <button title={p.status === 'paused' ? 'Resume' : 'Pause'} onClick={() => togglePause(p)} disabled={p.status === 'running' || p.status === 'complete'}>{p.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}</button>
                <button title="Run now" onClick={() => runNow(p.id)} disabled={p.status === 'running'}><Play size={14} /></button>
                <button title="Remove" onClick={() => remove(p.id)}><Trash2 size={14} /></button></div></div>
            <p>{p.text}</p><small>{names.join(' • ') || 'No destinations'}</small>
            {p.results && Object.keys(p.results).length > 0 && <div className="gsm-queue-results">{Object.entries(p.results).map(([id, r]) => <span key={id} className={r.status}>{campaign?.accounts.find((a) => a.id === id)?.name || id}: {r.status}</span>)}</div>}
          </div>;
        }) : <div className="gsm-panel gsm-empty">No scheduled posts yet. Create several posts here and Ghost will work through them at their scheduled times.</div>}</div>
    </div>
  </section>;
}

function HistoryPage({ state }: { state: GhostState }): JSX.Element {
  return <section className="gsm-page"><div className="gsm-page-title"><div><span>ARCHIVE</span><h1>Post History</h1></div></div>
    <div className="gsm-panel">{state.postHistory.length
      ? state.postHistory.map((h) => <div className="gsm-history-row" key={h.id}><History /><div><b>{h.text || '[Media post]'}</b><span>{h.destinations.join(' • ')}</span></div><time>{new Date(h.at).toLocaleString()}</time></div>)
      : <div className="gsm-empty">No publication records yet.</div>}</div>
  </section>;
}

function SettingsPage({ campaign, rename, remove, lock, cacheMode, setCacheMode }: {
  campaign?: Campaign; rename: (name: string) => void; remove: () => void; lock: () => void; cacheMode: BrowserCacheMode; setCacheMode: (m: BrowserCacheMode) => void;
}): JSX.Element {
  const [name, setName] = useState(campaign?.name || '');
  useEffect(() => setName(campaign?.name || ''), [campaign?.id]);
  return <section className="gsm-page"><div className="gsm-page-title"><div><span>SYSTEM</span><h1>Settings</h1></div></div>
    <div className="gsm-settings-grid">
      <div className="gsm-panel gsm-settings-card"><h3>CAMPAIGN</h3><label>Campaign name</label><div className="gsm-inline"><input value={name} onChange={(e) => setName(e.target.value)} /><button className="gsm-secondary" onClick={() => rename(name)}><Edit3 />RENAME</button></div><button className="gsm-danger" onClick={remove}><Trash2 />DELETE CAMPAIGN</button></div>
      <div className="gsm-panel gsm-settings-card"><h3>ACCOUNT PAGE CACHE</h3><p>Choose how many authenticated social pages Ghost keeps alive. Cached pages preserve their scroll position, navigation state and rendered page when you switch accounts.</p><label>BROWSER CACHE MODE</label>
        <select className="gsm-select" value={cacheMode} onChange={(e) => setCacheMode(e.target.value as BrowserCacheMode)}>
          <option value="all">Keep all account pages loaded</option>
          <option value="recent3">Keep last 3 accounts loaded (recommended)</option>
          <option value="reload">Reload inactive accounts</option></select>
        <div className="gsm-cache-legend"><span><i className="gsm-cache-dot live" /> LIVE — kept loaded</span><span><i className="gsm-cache-dot suspended" /> SUSPENDED — reloads when opened</span></div></div>
      <div className="gsm-panel gsm-settings-card"><h3>ARCHITECTURE</h3><p>Ghost separates the UI, job queue, platform adapters and authenticated browser sessions. The app is API-free by design — no platform keys, no OAuth.</p><button className="gsm-secondary" onClick={lock}><Lock />LOCK NOW</button></div>
    </div>
  </section>;
}

function BrowserPage({ account, host }: { account: SocialAccount | null; host: React.RefObject<HTMLDivElement> }): JSX.Element {
  const tor = account?.torEnabled === true;
  return <section className="gsm-browser-page">
    <div className="gsm-browser-toolbar"><div className="gsm-traffic"><span /><span /><span /></div>
      <button title="Back" onClick={() => gs().browserNav('back')}><ArrowLeft /></button>
      <button title="Forward" onClick={() => gs().browserNav('forward')}><ArrowRight /></button>
      <button title="Reload" onClick={() => gs().browserNav('reload')}><RotateCw /></button>
      <button title="Home" onClick={() => gs().browserNav('home')}><Home /></button>
      <div className="gsm-address"><Lock size={13} />{account?.url}</div>
      <span className={'gsm-egress-marker ' + (tor ? 'tor' : 'clearnet')} title={tor ? 'This account routes over Tor' : 'This account connects over the clear net'}>{tor ? <><ShieldCheck size={11} />TOR</> : <><ShieldOff size={11} />CLEARNET</>}</span>
      <button title="Open externally" onClick={() => account && gs().openExternal(account.url)}><ExternalLink /></button>
    </div>
    <div className="gsm-browser-host" ref={host} />
  </section>;
}

function AddAccount({ close, add }: { close: () => void; add: (key: PlatformKey, custom?: { name: string; url?: string; profileUrl?: string; username?: string }) => void }): JSX.Element {
  const [mode, setMode] = useState<PlatformKey | 'pick'>('pick');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [profileUrl, setProfileUrl] = useState('');
  const [username, setUsername] = useState('');
  return <div className="gsm-modal-backdrop"><div className="gsm-modal">
    <div className="gsm-modal-head"><div><span>CAMPAIGN ACCOUNT</span><h2>Add Social Platform</h2></div><button onClick={close}><Close /></button></div>
    {mode === 'pick'
      ? <div className="gsm-platform-grid">{platformOrder.map((k) => <button key={k} onClick={() => { setMode(k); if (k !== 'custom') setName(k === 'x' ? 'X / Twitter' : k[0].toUpperCase() + k.slice(1)); }}><i>{platformGlyph[k]}</i><b>{k === 'x' ? 'X / Twitter' : k[0].toUpperCase() + k.slice(1)}</b></button>)}</div>
      : <div className="gsm-custom-form"><label>ACCOUNT LABEL / USERNAME</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@youraccount" />
        <label>{mode === 'custom' ? 'PLATFORM NAME' : 'PLATFORM'}</label><input value={name} onChange={(e) => setName(e.target.value)} disabled={mode !== 'custom'} />
        {mode === 'custom' && <><label>WEBSITE / LOGIN URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></>}
        <label>PROFILE URL <small>used for follower/following counts</small></label><input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://social.example/your-profile" />
        <p>You can leave the profile URL blank and add it later. Login happens normally inside Ghost.</p>
        <button className="gsm-primary" onClick={() => add(mode, { name: name || 'Custom Platform', url: mode === 'custom' ? url : undefined, profileUrl, username })}>ADD ACCOUNT</button></div>}
  </div></div>;
}

function AccountModal({ account, close, save, setEgress }: {
  account: SocialAccount; close: () => void; save: (a: SocialAccount) => void;
  setEgress: (a: SocialAccount, torEnabled: boolean) => Promise<{ showWarning: boolean }>;
}): JSX.Element {
  const [a, setA] = useState<SocialAccount>({ ...account });
  const [torWarn, setTorWarn] = useState(false);
  async function toggleTor(): Promise<void> {
    const next = !(a.torEnabled === true);
    const res = await setEgress(account, next);
    setA((x) => ({ ...x, torEnabled: next }));
    setTorWarn(next && res.showWarning);
  }
  return <div className="gsm-modal-backdrop"><div className="gsm-modal small">
    <div className="gsm-modal-head"><div><span>ACCOUNT SETTINGS</span><h2>{account.username || account.name}</h2></div><button onClick={close}><Close /></button></div>
    <div className="gsm-custom-form">
      <label>ACCOUNT LABEL / USERNAME</label><input value={a.username || ''} onChange={(e) => setA({ ...a, username: e.target.value })} />
      <label>LOGIN / HOME URL</label><input value={a.url} onChange={(e) => setA({ ...a, url: e.target.value })} />
      <label>PROFILE URL</label><input value={a.profileUrl || ''} onChange={(e) => setA({ ...a, profileUrl: e.target.value })} />
      <label>EGRESS</label>
      <div className="gsm-egress-row"><div><b>Route this account over Tor</b><small>Clearnet by default. Tor usually breaks logged-in social sessions (checkpoints/lockouts).</small></div>
        <button type="button" role="switch" aria-checked={a.torEnabled === true} aria-label="Route this account over Tor" className={'gsm-switch ' + (a.torEnabled === true ? 'on' : '')} onClick={toggleTor}><span /></button></div>
      {torWarn && <div className="gsm-recovery-warn">Tor is now enabled for this account. Logged-in social platforms frequently block or checkpoint Tor exits — if the account stops loading or asks for re-verification, disable Tor here.</div>}
      <p>Ghost visits the profile URL using this account's existing authenticated Chromium session to read visible follower/following statistics.</p>
      <button className="gsm-primary" onClick={() => save(a)}>SAVE ACCOUNT</button>
    </div>
  </div></div>;
}

function CampaignModal({ close, add }: { close: () => void; add: (name: string) => void }): JSX.Element {
  const [name, setName] = useState('');
  return <div className="gsm-modal-backdrop"><div className="gsm-modal small">
    <div className="gsm-modal-head"><div><span>WORKSPACE</span><h2>New Campaign</h2></div><button onClick={close}><Close /></button></div>
    <div className="gsm-custom-form"><label>CAMPAIGN NAME</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(name)} placeholder="Client Campaign" /><button className="gsm-primary" onClick={() => add(name)}>CREATE CAMPAIGN</button></div>
  </div></div>;
}
