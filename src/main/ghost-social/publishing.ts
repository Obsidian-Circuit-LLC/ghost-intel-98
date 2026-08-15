/**
 * Ghost Social Media Manager (hardened GI98 port) — publishing service + THE AUTO-POST ARM GATE
 * (Phase 3, G5/G7, constraint 3). SAFETY-CRITICAL.
 *
 * Ports his `electron/core/PublishingService.ts` behaviour VERBATIM (the composer-URL map, the
 * focus/insert/paste/verify DOM heuristics, the per-platform Publish-button clicker) with ONE
 * hardening addition that never existed in his source:
 *
 *   THE AUTO-POST ARM GATE (G7). His scheduler auto-CLICKED Publish on live accounts with no
 *   per-post human gate. Here, `autoPublish` refuses to reach `clickPublish` unless auto-posting
 *   is ARMED — the flag is read from the encrypted module state in MAIN (`isAutoPostArmed`), so a
 *   renderer bug can NEVER drive a live Publish click while disarmed. Disarmed is the default and
 *   short-circuits BEFORE any window is opened or composer touched: no side effect on the live
 *   account whatsoever, and `clickPublish` is provably unreachable. Manual `publish` stays
 *   PREPARE-only (his already-safe path) — it fills the composer, shows the window for review, and
 *   NEVER clicks.
 *
 * The service is PURE over injected seams (no `electron`/`node` import) so the whole gate is unit-
 * testable with fakes: `publishing-ipc.ts` wires the production seams (a hidden `BrowserWindow` on
 * the account partition, the real clipboard, a real sleep, the store-backed arm-flag reader, and a
 * `clickPublish` that runs the verbatim DOM script). Determinism: no clock/RNG on any path here —
 * the only timing is the injected `sleep`.
 */

import type { AccountLike, PublishRequest, PublishResult } from '@shared/ghost-social/types';

// ---- injectable electron-shaped seams ----------------------------------
// Structural shapes of exactly the WebContents/BrowserWindow surface the service drives — kept
// structural (not `import type` from electron) so a test injects a fake with zero electron runtime.

export interface PublishWc {
  loadURL(url: string): Promise<unknown>;
  getURL(): string;
  /** Run a DOM script in the authenticated page. `userGesture` mirrors his `executeJavaScript(_,true)`. */
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>;
  focus(): void;
  paste(): void;
  insertText(text: string): void;
  isDestroyed(): boolean;
}

export interface PublishWindow {
  webContents: PublishWc;
  show(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface ClipboardLike {
  readText(): string;
  writeText(text: string): void;
}

export interface PublishingDeps {
  /** His `partitionFor` — the account's `persist:` session partition. */
  partitionFor(campaignId: string, accountId: string): string;
  /** Build a HIDDEN window on the account partition (his `new BrowserWindow({show:false,…})`). */
  createWindow(partition: string): PublishWindow;
  /** The system clipboard (his `clipboard` — used by the LinkedIn native-paste path). */
  clipboard: ClipboardLike;
  /** Injected delay (his `sleep`); tests pass a no-op so nothing actually waits. */
  sleep(ms: number): Promise<void>;
  /**
   * SAFETY-CRITICAL (G7): reads the default-OFF auto-post ARM flag from the encrypted module
   * state in MAIN. `autoPublish` consults this before it may ever click Publish. This is the
   * single authoritative gate — the renderer flag is advisory only.
   */
  isAutoPostArmed(): Promise<boolean>;
  /**
   * The per-platform Publish-button clicker (his `clickPublish`). Injected as a seam so the
   * safety test can assert it is NEVER called while disarmed. Production runs
   * `wc.executeJavaScript(clickPublishScript(platform), true)`.
   */
  clickPublish(wc: PublishWc, platform: string): Promise<boolean>;
  /**
   * MANUAL PREPARE (G5, Finding 2/6): open-or-reuse the account's LIFECYCLE-MANAGED embedded view
   * through the view manager and return its webContents. His `publish:account` prepared into the
   * account's ALREADY-OPEN cached view; the port routes manual prepare the same way so the view is
   * tracked, governed by the overlay lifecycle, and torn down by the view manager's
   * `closeAll()`/teardown/lock. NO untracked top-level window is ever created for a manual prepare
   * (the old leak). Returns null when no managed view can be opened.
   */
  openManagedView(campaignId: string, account: AccountLike): Promise<PublishWc | null>;
}

export interface PublishingService {
  /** Manual Composer publish — PREPARE-ONLY (his `publish`): fill the composer + show for review,
   *  never click. */
  publish(campaignId: string, account: AccountLike, post: PublishRequest): Promise<PublishResult>;
  /** Prepare a post in an already-open WebContents (his `prepareInWebContents`) — fill only. */
  prepareInWebContents(wc: PublishWc, account: AccountLike, post: PublishRequest): Promise<PublishResult>;
  /** Auto-publish (his `autoPublish` = prepare + click), GATED by the MAIN arm flag (G7). */
  autoPublish(campaignId: string, account: AccountLike, post: PublishRequest): Promise<PublishResult>;
}

// ---- his DOM heuristics, ported VERBATIM as pure script builders -------
// These strings are his `PublishingService` private-method scripts, unchanged. Isolated here (pure,
// no seam) so production and the click seam share them and a platform change is a one-place fix.

/** His `composeUrl(a)`: the platform's compose/home entry point. */
export function composeUrl(a: AccountLike): string {
  switch (a.platform) {
    case 'x':
      return 'https://x.com/compose/post';
    case 'linkedin':
      return 'https://www.linkedin.com/feed/?shareActive=true';
    case 'facebook':
      return 'https://www.facebook.com/';
    case 'bluesky':
      return 'https://bsky.app/';
    case 'instagram':
      return 'https://www.instagram.com/';
    case 'tiktok':
      return 'https://www.tiktok.com/upload';
    case 'youtube':
      return 'https://www.youtube.com/upload';
    default:
      return a.url;
  }
}

/** His `isAlreadyOnUsefulPage(url,platform)`. */
export function isAlreadyOnUsefulPage(url: string, platform: string): boolean {
  if (!url) return false;
  if (platform === 'linkedin') return /linkedin\.com\/(feed|posts|in)\//i.test(url);
  if (platform === 'facebook') return /facebook\.com\//i.test(url);
  if (platform === 'x') return /x\.com\/compose\/post/i.test(url);
  if (platform === 'bluesky') return /bsky\.app\//i.test(url);
  return false;
}

/** His `clickPublish` DOM script — the per-platform enabled-Publish-button clicker (VERBATIM). */
export function clickPublishScript(platform: string): string {
  return `(()=>{
      const p=${JSON.stringify(platform)};
      const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
      const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true';
      const txt=e=>String(e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();
      const exact=(words)=>{for(const e of document.querySelectorAll('button,[role="button"]')){if(!visible(e)||!enabled(e))continue;const t=txt(e);if(words.some(w=>t.toLowerCase()===w.toLowerCase())){e.click();return true}}return false};
      if(p==='x'){
        for(const s of ['[data-testid="tweetButton"]','[data-testid="tweetButtonInline"]']){const e=document.querySelector(s);if(visible(e)&&enabled(e)){e.click();return true}}
        return exact(['Post']);
      }
      if(p==='linkedin'){
        for(const s of ['button.share-actions__primary-action','[role="dialog"] button.artdeco-button--primary']){for(const e of document.querySelectorAll(s)){if(visible(e)&&enabled(e)&&/post/i.test(txt(e))){e.click();return true}}}
        return exact(['Post']);
      }
      if(p==='facebook') return exact(['Post']);
      if(p==='bluesky') return exact(['Post','Publish']);
      return exact(['Post','Publish','Share']);
    })()`;
}

/** His `focusComposer` DOM script (VERBATIM). */
export function focusComposerScript(platform: string): string {
  return `(async()=>{
      const sleep=m=>new Promise(r=>setTimeout(r,m));
      const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();
      const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none'};
      const clickMatching=(patterns)=>{for(const e of [...document.querySelectorAll('button,[role="button"],a')]){if(!visible(e))continue;const t=norm(e.innerText)+' '+norm(e.getAttribute('aria-label'))+' '+norm(e.getAttribute('title'));if(patterns.some(p=>new RegExp(p,'i').test(t))){e.click();return true}}return false};
      const focusFirst=(sels)=>{for(const s of sels){for(const e of document.querySelectorAll(s)){if(visible(e)){e.scrollIntoView({block:'center',inline:'nearest'});try{e.click()}catch{};e.focus();try{const range=document.createRange();range.selectNodeContents(e);range.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(range)}catch{}return true}}}return false};
      const waitFor=async(sels,tries=16,delay=350)=>{for(let i=0;i<tries;i++){if(focusFirst(sels))return true;await sleep(delay)}return false};
      const platform=${JSON.stringify(platform)};
      if(platform==='x') return waitFor(['[data-testid="tweetTextarea_0"]','[role="textbox"][contenteditable="true"]','[contenteditable="true"]'],10,250);
      if(platform==='linkedin'){
        const sels=['[role="dialog"] .ql-editor[contenteditable="true"]','[role="dialog"] [contenteditable="true"][role="textbox"]','[role="dialog"] div[contenteditable="true"]','.share-creation-state__text-editor .ql-editor','[data-placeholder*="What do you want to talk about" i]','[aria-placeholder*="What do you want to talk about" i]','[aria-label*="text editor" i][contenteditable="true"]','[data-test-ql-editor-contenteditable="true"]','[contenteditable="true"][data-placeholder]','.ql-editor[contenteditable="true"]'];
        if(await waitFor(sels,6,250))return true;
        clickMatching(['start a post','create a post','share a post']);
        return waitFor(sels,20,350);
      }
      if(platform==='facebook'){
        const sels=['[role="dialog"] [contenteditable="true"][role="textbox"]','[role="dialog"] [contenteditable="true"]','[contenteditable="true"][role="textbox"]'];
        if(await waitFor(sels,5,200))return true;
        clickMatching(['what.?s on your mind','create post']);
        return waitFor(sels,16,300);
      }
      if(platform==='bluesky'){
        if(!(await waitFor(['textarea','[contenteditable="true"][role="textbox"]'],3,150))){clickMatching(['new post','compose','create post'])}
        return waitFor(['textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],10,250);
      }
      if(platform==='instagram'){clickMatching(['create','new post']);return waitFor(['textarea','[contenteditable="true"]'],10,250)}
      if(platform==='tiktok')return waitFor(['[contenteditable="true"]','textarea'],12,250);
      if(platform==='youtube')return waitFor(['[contenteditable="true"]','textarea','input[type="text"]'],12,250);
      return waitFor(['textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],8,250);
    })()`;
}

/** His `insertComposerText` DOM script for LinkedIn (VERBATIM). */
export function insertComposerScript(text: string): string {
  return `(()=>{
      const text=${JSON.stringify(text)};
      const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>2&&r.height>2};
      const selectors=['[role="dialog"] .ql-editor[contenteditable="true"]','[role="dialog"] [contenteditable="true"][role="textbox"]','[role="dialog"] div[contenteditable="true"]','[data-placeholder*="What do you want to talk about" i]','[aria-placeholder*="What do you want to talk about" i]','[data-test-ql-editor-contenteditable="true"]','[contenteditable="true"][data-placeholder]','[contenteditable="true"][role="textbox"]','.ql-editor[contenteditable="true"]'];
      let el=document.activeElement;
      if(!el||!el.isContentEditable||!visible(el)){
        el=null;
        outer:for(const s of selectors){for(const candidate of document.querySelectorAll(s)){if(visible(candidate)){el=candidate;break outer}}}
      }
      if(!el)return false;
      el.focus();
      try{
        const sel=getSelection(), range=document.createRange();
        range.selectNodeContents(el); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
      }catch{}
      try{
        if(document.execCommand && document.execCommand('insertText',false,text)){
          el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
          return true;
        }
      }catch{}
      try{
        el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:text}));
        const sel=getSelection();
        if(sel&&sel.rangeCount){const r=sel.getRangeAt(0);r.deleteContents();r.insertNode(document.createTextNode(text));r.collapse(false);sel.removeAllRanges();sel.addRange(r)}
        else el.textContent=(el.textContent||'')+text;
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
        return true;
      }catch{return false}
    })()`;
}

/** His `verifyText` DOM script (VERBATIM). */
export function verifyTextScript(text: string): string {
  const needle = text.trim().slice(0, 60);
  return `(()=>{const n=${JSON.stringify(needle)};const a=document.activeElement;const v=(a&&'value' in a)?String(a.value||''):String(a?.innerText||a?.textContent||'');return v.includes(n)||(document.body?.innerText||'').includes(n)})()`;
}

function errMessage(e: unknown, fallback: string): string {
  return (e as { message?: string })?.message || fallback;
}

// ---- factory -----------------------------------------------------------

export function makePublishingService(deps: PublishingDeps): PublishingService {
  async function runBool(wc: PublishWc, script: string): Promise<boolean> {
    return !!(await wc.executeJavaScript(script, true).catch(() => false));
  }

  /** His `verifyText`. */
  async function verifyText(wc: PublishWc, text: string): Promise<boolean> {
    if (!text.trim().slice(0, 60)) return true;
    return runBool(wc, verifyTextScript(text));
  }

  /** His `pasteComposerText` — native Chromium paste (LinkedIn-sensitive editors), restoring the
   *  user's clipboard afterwards. */
  async function pasteComposerText(wc: PublishWc, text: string): Promise<boolean> {
    const previous = deps.clipboard.readText();
    try {
      deps.clipboard.writeText(text);
      wc.focus();
      wc.paste();
      await deps.sleep(500);
      return await verifyText(wc, text);
    } catch {
      return false;
    } finally {
      try {
        deps.clipboard.writeText(previous);
      } catch {
        /* clipboard restore best-effort (his) */
      }
    }
  }

  /** His `prepareInWebContents` — navigate, focus the composer, insert/paste the text, verify. */
  async function prepareInWebContents(
    wc: PublishWc,
    a: AccountLike,
    p: PublishRequest,
  ): Promise<PublishResult> {
    if (a.platform === 'messenger')
      return { status: 'unsupported', message: 'Messenger is not a public-post destination.' };
    try {
      const url = composeUrl(a);
      if (url && !isAlreadyOnUsefulPage(wc.getURL(), a.platform)) {
        await wc.loadURL(url);
        await deps.sleep(a.platform === 'linkedin' || a.platform === 'facebook' ? 3200 : 2200);
      }
      const focused = await runBool(wc, focusComposerScript(a.platform));
      if (p.text && focused) {
        let inserted = false;
        // LinkedIn's editor prefers a native paste over synthetic DOM changes (his note).
        if (a.platform === 'linkedin') inserted = await pasteComposerText(wc, p.text);
        if (!inserted && a.platform === 'linkedin') inserted = await runBool(wc, insertComposerScript(p.text));
        if (!inserted) {
          wc.focus();
          wc.insertText(p.text);
        }
        await deps.sleep(650);
      }
      const verified = p.text ? await verifyText(wc, p.text) : true;
      if (!focused && p.text)
        return {
          status: 'prepared',
          message:
            'Ghost opened the destination tile, but could not identify its text composer automatically.',
          url: wc.getURL(),
        };
      if (p.text && !verified)
        return {
          status: 'prepared',
          message:
            'Ghost focused the composer, but could not verify that the text was accepted. The tile is open for manual review.',
          url: wc.getURL(),
        };
      return {
        status: 'prepared',
        message: 'Ghost placed the composed text into this live account tile.',
        url: wc.getURL(),
      };
    } catch (e) {
      return { status: 'failed', message: errMessage(e, 'Could not prepare this account tile.'), url: wc.getURL() };
    }
  }

  return {
    prepareInWebContents,

    async publish(campaignId, account, post) {
      // His manual publish: PREPARE-ONLY. Fill the composer and STOP; the human clicks Publish.
      // Finding 2/6: prepare into the account's LIFECYCLE-MANAGED embedded view (his
      // `publish:account` → prepare-in-already-open-cached-view), NOT an untracked top-level window.
      // The view is tracked + governed + torn down by the view manager (closeAll/teardown/lock), so
      // no authenticated window can outlive the module, the vault lock, or unmount.
      if (account.platform === 'messenger')
        return {
          status: 'unsupported',
          message: 'Messenger is a messaging destination, not a public-post destination.',
        };
      try {
        const wc = await deps.openManagedView(campaignId, account);
        if (!wc)
          return {
            status: 'failed',
            message: 'Could not open a managed account view to prepare this post. Open the account first.',
          };
        const r = await prepareInWebContents(wc, account, post);
        if (r.status !== 'prepared') return r;
        // No window.show()/destroy() here — the overlay governor already shows the account's view
        // and the view manager owns its teardown.
        return { ...r, message: r.message + ' Review the prepared post and click the platform Publish/Post button.' };
      } catch (e) {
        return { status: 'failed', message: errMessage(e, 'Could not prepare post.') };
      }
    },

    async autoPublish(campaignId, account, post) {
      // His content guards (unchanged).
      if (account.platform === 'messenger')
        return { status: 'unsupported', message: 'Messenger is not a public-post destination.' };
      if (!post.text?.trim())
        return { status: 'unsupported', message: 'This scheduled publisher currently requires post text.' };
      if (['instagram', 'tiktok', 'youtube'].includes(account.platform) && !post.mediaPath)
        return { status: 'unsupported', message: 'This platform requires media for this type of automatic post.' };

      // ── THE AUTO-POST ARM GATE (G7, constraint 3) — SAFETY-CRITICAL ─────────────────────────
      // MAIN refuses to auto-click Publish on a LIVE account unless auto-posting is ARMED. Checked
      // HERE, before any window is created or composer touched, so `clickPublish` is provably
      // unreachable while disarmed and the live account is never even navigated. Default is OFF.
      if (!(await deps.isAutoPostArmed())) {
        return {
          status: 'blocked_disarmed',
          message:
            'Auto-posting is disarmed. Ghost did not open the account, prepare anything, or click Publish. Arm auto-posting or publish this manually.',
        };
      }

      const win = deps.createWindow(deps.partitionFor(campaignId, account.id));
      try {
        const prepared = await prepareInWebContents(win.webContents, account, post);
        if (prepared.status !== 'prepared') return prepared;
        const clicked = await deps.clickPublish(win.webContents, account.platform);
        if (!clicked)
          return {
            status: 'failed',
            message: 'Ghost prepared the post but could not identify an enabled Publish/Post button.',
            url: win.webContents.getURL(),
          };
        await deps.sleep(1600);
        return {
          status: 'published',
          message: 'Ghost sent the final Publish/Post command through the authenticated session.',
          url: win.webContents.getURL(),
        };
      } catch (e) {
        return { status: 'failed', message: errMessage(e, 'Automatic publishing failed.') };
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
