/**
 * Ghost Social Media Manager (hardened GI98 port) — per-platform DOM stat readers + defaults.
 *
 * Ported VERBATIM from his `electron/adapters/index.ts` (the `extractStatsScript` bodies) and
 * his `platformDefaults` map (electron/main.ts). These scripts run in the AUTHENTICATED profile
 * page (visible-DOM scrape, never a platform API) to read follower/following counts; they are
 * isolated here so a platform layout change is a one-file fix. No behaviour is altered — the
 * regexes/selectors are his. `getAdapter` falls back to the generic `custom` reader.
 *
 * Determinism: pure data + pure factory; no clock, no RNG, no electron import.
 */

import type { PlatformAdapter, PlatformDefault, PlatformKey } from '@shared/ghost-social/types';

const generic = (key: PlatformKey, followers = 'Followers', following = 'Following'): PlatformAdapter => ({
  key,
  labels: { followers, following },
  extractStatsScript: () => `(() => {
    const txt = document.body?.innerText || '';
    const compact = (s) => s.replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
    const find = (label) => {
      const patterns = [
        new RegExp('([0-9][0-9,._+\\\\s]*[KMBkmb]?)\\\\s+' + label, 'i'),
        new RegExp(label + '\\\\s*[:\\\\n ]+([0-9][0-9,._+\\\\s]*[KMBkmb]?)', 'i')
      ];
      for (const p of patterns) { const m = txt.match(p); if (m) return compact(m[1]); }
      return null;
    };
    return {followers: find('${followers.toLowerCase()}'), following: find('${following.toLowerCase()}')};
  })()`,
});

const x: PlatformAdapter = {
  key: 'x',
  labels: { followers: 'Followers', following: 'Following' },
  extractStatsScript: () => `(() => {
    const textOf=(el)=>el?.innerText?.replace(/\\s+/g,' ').trim()||null;
    const f=document.querySelector('a[href$="/followers"],a[href*="/verified_followers"]');
    const g=document.querySelector('a[href$="/following"]');
    const body=document.body?.innerText||'';
    const rx=(label)=>{const m=body.match(new RegExp('([0-9][0-9,.+KMBkmb]*)\\\\s+'+label,'i'));return m?.[1]||null};
    return {followers:textOf(f)?.match(/[0-9][0-9,.+KMBkmb]*/)?.[0]||rx('Followers'), following:textOf(g)?.match(/[0-9][0-9,.+KMBkmb]*/)?.[0]||rx('Following')};
  })()`,
};

const instagram: PlatformAdapter = {
  key: 'instagram',
  labels: { followers: 'Followers', following: 'Following' },
  extractStatsScript: () => `(() => {
    const grab=(sel,label)=>{const el=document.querySelector(sel);const t=el?.innerText||el?.textContent||'';const m=t.match(/[0-9][0-9,.+KMBkmb]*/);if(m)return m[0];const body=document.body?.innerText||'';const r=body.match(new RegExp('([0-9][0-9,.+KMBkmb]*)\\\\s+'+label,'i'));return r?.[1]||null};
    return {followers:grab('a[href*="/followers/"]','followers'),following:grab('a[href*="/following/"]','following')};
  })()`,
};

const tiktok: PlatformAdapter = {
  key: 'tiktok',
  labels: { followers: 'Followers', following: 'Following' },
  extractStatsScript: () => `(() => {
    const read=(name,label)=>{const el=document.querySelector('[data-e2e="'+name+'-count"]');if(el)return el.textContent?.trim()||null;const body=document.body?.innerText||'';const m=body.match(new RegExp('([0-9][0-9,.+KMBkmb]*)\\\\s+'+label,'i'));return m?.[1]||null};
    return {followers:read('followers','Followers'),following:read('following','Following')};
  })()`,
};

const youtube: PlatformAdapter = {
  key: 'youtube',
  labels: { followers: 'Subscribers', following: 'Following' },
  extractStatsScript: () => `(() => {
    const body=document.body?.innerText||'';
    const el=document.querySelector('#subscriber-count, yt-content-metadata-view-model span');
    const raw=el?.textContent||body.match(/([0-9][0-9,.+KMBkmb]*)\\s+subscribers?/i)?.[1]||null;
    const m=String(raw||'').match(/[0-9][0-9,.+KMBkmb]*/);
    return {followers:m?.[0]||null, following:null};
  })()`,
};

const bluesky = generic('bluesky');

const linkedin: PlatformAdapter = {
  key: 'linkedin',
  labels: { followers: 'Followers', following: 'Connections' },
  extractStatsScript: () => `(() => {
    const norm=(v)=>String(v||'').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
    const number=(v)=>norm(v).match(/[0-9][0-9,.+KMBkmb]*/)?.[0]||null;
    const body=norm(document.body?.innerText||'');
    const scan=(labels)=>{
      for(const label of labels){
        const esc=label;
        const patterns=[
          new RegExp('([0-9][0-9,.+KMBkmb]*)\\\\s+'+esc,'i'),
          new RegExp(esc+'\\\\s*[:•·\\\\-]?\\\\s*([0-9][0-9,.+KMBkmb]*)','i')
        ];
        for(const rx of patterns){const m=body.match(rx);if(m)return m[1]}
      }
      return null;
    };
    const candidates=[...document.querySelectorAll('a,span,li,div')];
    const fromElements=(label)=>{
      for(const el of candidates){
        const t=norm(el.textContent);
        if(t.length>120||!new RegExp(label,'i').test(t))continue;
        const n=number(t);if(n)return n;
      }
      return null;
    };
    const followers=fromElements('followers?')||scan(['followers?']);
    const connections=fromElements('connections?')||scan(['connections?']);
    return {followers, following:connections};
  })()`,
};

const facebook: PlatformAdapter = {
  key: 'facebook',
  labels: { followers: 'Followers', following: 'Following' },
  extractStatsScript: () => `(() => {
    const norm=(v)=>String(v||'').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim();
    const count=(v)=>norm(v).match(/[0-9][0-9,.+KMBkmb]*/)?.[0]||null;
    const anchors=[...document.querySelectorAll('a[href]')];
    const byHref=(word)=>{
      const rx=new RegExp(word,'i');
      for(const a of anchors){
        const href=a.getAttribute('href')||'';
        const aria=a.getAttribute('aria-label')||'';
        const title=a.getAttribute('title')||'';
        const text=norm(a.textContent);
        if(rx.test(href)||rx.test(aria)||rx.test(title)||rx.test(text)){
          const n=count(text)||count(aria)||count(title);if(n)return n;
        }
      }
      return null;
    };
    const body=norm(document.body?.innerText||'');
    const bodyCount=(label)=>{
      const patterns=[
        new RegExp('([0-9][0-9,.+KMBkmb]*)\\\\s+'+label,'i'),
        new RegExp(label+'\\\\s*[:•·\\\\-]?\\\\s*([0-9][0-9,.+KMBkmb]*)','i')
      ];
      for(const rx of patterns){const m=body.match(rx);if(m)return m[1]}
      return null;
    };
    return {
      followers:byHref('followers?')||bodyCount('followers?'),
      following:byHref('following')||bodyCount('following')
    };
  })()`,
};

const messenger = generic('messenger');
const custom = generic('custom');

const map: Record<PlatformKey, PlatformAdapter> = {
  facebook,
  messenger,
  instagram,
  tiktok,
  linkedin,
  x,
  youtube,
  bluesky,
  custom,
};

/** Resolve a platform's DOM stat reader; unknown keys fall back to the generic `custom` reader. */
export function getAdapter(key: PlatformKey): PlatformAdapter {
  return map[key] || custom;
}

/**
 * His `platformDefaults` map (electron/main.ts) — the default home URL + capability profile per
 * platform, used when the user adds an account. Verbatim; no URL or capability is invented.
 */
export const platformDefaults: Record<string, PlatformDefault> = {
  facebook: { name: 'Facebook', url: 'https://www.facebook.com/', capabilities: { text: true, image: true, video: true, messages: true, comments: true } },
  messenger: { name: 'Messenger', url: 'https://www.messenger.com/', capabilities: { text: false, image: false, video: false, messages: true, comments: false } },
  instagram: { name: 'Instagram', url: 'https://www.instagram.com/', capabilities: { text: false, image: true, video: true, messages: true, comments: true } },
  tiktok: { name: 'TikTok', url: 'https://www.tiktok.com/', capabilities: { text: false, image: true, video: true, messages: true, comments: true } },
  linkedin: { name: 'LinkedIn', url: 'https://www.linkedin.com/', capabilities: { text: true, image: true, video: true, messages: true, comments: true } },
  x: { name: 'X / Twitter', url: 'https://x.com/', capabilities: { text: true, image: true, video: true, messages: true, comments: true } },
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/', capabilities: { text: false, image: false, video: true, messages: false, comments: true } },
  bluesky: { name: 'Bluesky', url: 'https://bsky.app/', capabilities: { text: true, image: true, video: true, messages: true, comments: true } },
  custom: { name: 'Custom Platform', url: 'https://', capabilities: { text: false, image: false, video: false, messages: false, comments: false } },
};

/** His `platformDefaults[key] || platformDefaults.custom` resolution. */
export function getPlatformDefault(key: string): PlatformDefault {
  return platformDefaults[key] || platformDefaults.custom;
}
