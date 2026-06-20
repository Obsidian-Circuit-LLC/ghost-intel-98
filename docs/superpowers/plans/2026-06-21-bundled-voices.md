# Bundled Character Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle four character Piper voices (Jarvis, HAL 9000, GLaDOS, Wheatley) in the installer, selectable in the assistant; LJ Speech stays the default.

**Architecture:** Generalize `fetch-piper.mjs` to fetch multiple SHA-pinned voices; add bundled-voice enumeration + traversal-safe resolution to `piper-voices.ts` (mirroring the v3.16.1 user-voice functions); make `piper-tts.ts` resolve a chosen voice as bundled-then-user-then-default and pin the default; merge bundled+user in `tts.listVoices`.

**Tech Stack:** Electron main (node:fs), a Node build script, vitest (node env, pure-ish tests over injected dirs).

**Spec:** `docs/superpowers/specs/2026-06-21-bundled-voices-design.md`

## Global Constraints

- **LJ Speech (`en_US-ljspeech-high.onnx`) stays the default** (public-domain); character voices are opt-in selections. `piperVoice` null/'' → default.
- **Traversal-safe** voice-id → path resolution (renderer untrusted): a path is returned only for an id that exactly matches a scanned bundled/user basename; unknown/`../`/absolute/null → null → default. Never `join(dir, rawInput)`.
- Every bundled voice model+config is **SHA-256 pinned, fail-closed** in `fetch-piper.mjs` (a wrong/tampered model aborts the build). The piper **binary keeps its verify-before-exec gate**.
- No runtime network/egress/telemetry; voices fetched only at build time from pinned URLs.
- Test style: vitest **node** env, pure-ish tests over injected `VoicesDeps`. No React render harness.
- Bundled-voice resolution is checked **before** user voices (bundled id authoritative on collision).

## Task 1: `piper-voices.ts` — bundled enumeration + resolution

**Files:**
- Modify: `src/main/services/piper-voices.ts`
- Test: `test/piper-voices.test.ts` (extend)

- [ ] **Step 1: Add the failing tests**

Append to `test/piper-voices.test.ts` (import the new symbols at the top alongside the existing imports):

```ts
import { listBundledVoices, resolveBundledModelPath, DEFAULT_BUNDLED_ID } from '../src/main/services/piper-voices';

function bdeps(files: string[], json: Record<string, string> = {}): import('../src/main/services/piper-voices').VoicesDeps {
  return {
    dir: '/bundled',
    readdir: async () => files,
    readText: async (p: string) => { const n = p.replace('/bundled/', ''); if (n in json) return json[n]; throw new Error('no'); }
  };
}
const J = '{}';

describe('listBundledVoices', () => {
  it('lists valid pairs with friendly names and EXCLUDES the default voice', async () => {
    const d = bdeps(
      [DEFAULT_BUNDLED_ID, `${DEFAULT_BUNDLED_ID}.json`, 'jarvis-medium.onnx', 'jarvis-medium.onnx.json', 'hal.onnx', 'hal.onnx.json'],
      { [`${DEFAULT_BUNDLED_ID}.json`]: J, 'jarvis-medium.onnx.json': J, 'hal.onnx.json': J }
    );
    const got = await listBundledVoices(d);
    expect(got.find((v) => v.id === DEFAULT_BUNDLED_ID)).toBeUndefined(); // default excluded
    expect(got).toEqual([
      { id: 'hal.onnx', name: 'HAL 9000' },
      { id: 'jarvis-medium.onnx', name: 'Jarvis' }
    ]); // sorted by name
  });
  it('falls back to the filename (minus .onnx) for an unmapped voice', async () => {
    const d = bdeps(['custom.onnx', 'custom.onnx.json'], { 'custom.onnx.json': J });
    expect(await listBundledVoices(d)).toEqual([{ id: 'custom.onnx', name: 'custom' }]);
  });
  it('ignores lone .onnx / bad-JSON sidecar; missing dir → []', async () => {
    const lone = bdeps(['x.onnx']);
    expect(await listBundledVoices(lone)).toEqual([]);
    const bad = bdeps(['x.onnx', 'x.onnx.json'], { 'x.onnx.json': '{ no' });
    expect(await listBundledVoices(bad)).toEqual([]);
  });
});

describe('resolveBundledModelPath', () => {
  const d = bdeps(['jarvis-medium.onnx', 'jarvis-medium.onnx.json', DEFAULT_BUNDLED_ID, `${DEFAULT_BUNDLED_ID}.json`],
    { 'jarvis-medium.onnx.json': J, [`${DEFAULT_BUNDLED_ID}.json`]: J });
  it('resolves a known bundled id (incl. the default id when passed explicitly)', async () => {
    expect(await resolveBundledModelPath('jarvis-medium.onnx', d)).toBe('/bundled/jarvis-medium.onnx');
    expect(await resolveBundledModelPath(DEFAULT_BUNDLED_ID, d)).toBe(`/bundled/${DEFAULT_BUNDLED_ID}`);
  });
  it('returns null for traversal / absolute / unknown / null (security)', async () => {
    expect(await resolveBundledModelPath('../../etc/passwd', d)).toBeNull();
    expect(await resolveBundledModelPath('/etc/passwd', d)).toBeNull();
    expect(await resolveBundledModelPath('nope.onnx', d)).toBeNull();
    expect(await resolveBundledModelPath(null, d)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: FAIL — `listBundledVoices`/`resolveBundledModelPath`/`DEFAULT_BUNDLED_ID` not exported.

- [ ] **Step 3: Extend `piper-voices.ts`**

Refactor the shared scan into a helper and add the bundled functions. Add `import { app } from 'electron';` at the top. Replace the body from `listUserVoices` onward with:

```ts
/** Shared scan: complete, JSON-valid `<name>.onnx`+`.onnx.json` pairs in deps.dir, mapped to
 *  {id,name} via nameOf, optionally excluding one id, sorted by name. Missing dir → []. Never throws. */
async function scanVoices(deps: VoicesDeps, nameOf: (file: string) => string, excludeId?: string): Promise<{ id: string; name: string }[]> {
  let entries: string[];
  try { entries = await deps.readdir(deps.dir); }
  catch { return []; }
  const set = new Set(entries);
  const out: { id: string; name: string }[] = [];
  for (const e of entries) {
    if (!e.endsWith('.onnx')) continue;
    if (excludeId && e === excludeId) continue;
    if (!set.has(`${e}.json`)) continue;
    try { JSON.parse(await deps.readText(join(deps.dir, `${e}.json`))); }
    catch { continue; }
    out.push({ id: e, name: nameOf(e) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const stripOnnx = (file: string): string => file.slice(0, -'.onnx'.length);

export async function listUserVoices(deps: VoicesDeps = realVoicesDeps()): Promise<{ id: string; name: string }[]> {
  return scanVoices(deps, stripOnnx);
}

export async function resolveUserModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realVoicesDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const hit = (await listUserVoices(deps)).find((v) => v.id === voiceId);
  return hit ? join(deps.dir, hit.id) : null;
}

// ---- Bundled voices (shipped in resources/piper/<platform>/) ----

/** The default shipped voice (public-domain). Selected when piperVoice is null/''. */
export const DEFAULT_BUNDLED_ID = 'en_US-ljspeech-high.onnx';

/** Friendly display names for the bundled voices; unknown ids fall back to the filename. */
const BUNDLED_NAMES: Record<string, string> = {
  'en_US-ljspeech-high.onnx': 'Bundled neural (LJ Speech)',
  'jarvis-medium.onnx': 'Jarvis',
  'hal.onnx': 'HAL 9000',
  'wheatley1.onnx': 'Wheatley',
  'en_US-glados-high.onnx': 'GLaDOS'
};

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
export function bundledVoicesDir(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'piper', platformDir());
}
function realBundledDeps(): VoicesDeps {
  const dir = bundledVoicesDir();
  return { dir, readdir: (p) => readdir(p), readText: (p) => readFile(p, 'utf8') };
}

/** Bundled voices for the picker — friendly names, the default EXCLUDED (it's the picker's default
 *  option). Same validation/traversal posture as user voices. */
export async function listBundledVoices(deps: VoicesDeps = realBundledDeps()): Promise<{ id: string; name: string }[]> {
  return scanVoices(deps, (f) => BUNDLED_NAMES[f] ?? stripOnnx(f), DEFAULT_BUNDLED_ID);
}

/** Resolve a bundled voice id (incl. the default id) to a path, or null. Traversal-safe: scans the
 *  bundled dir and only joins an id that matches a scanned basename. */
export async function resolveBundledModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realBundledDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const all = await scanVoices(deps, stripOnnx); // no exclude — the default id must resolve too
  return all.some((v) => v.id === voiceId) ? join(deps.dir, voiceId) : null;
}
```

(Keep the existing `VoicesDeps`, `userVoicesDir`, `realVoicesDeps` above this block unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: PASS (the existing user-voice tests + the new bundled tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/piper-voices.ts test/piper-voices.test.ts
git commit -m "feat(voices): bundled-voice enumeration + traversal-safe resolution"
```

---

## Task 2: `fetch-piper.mjs` — multi-voice fetch (SHA-pinned)

**Files:**
- Modify: `scripts/fetch-piper.mjs`
- Modify: `resources/piper/README-PIPER.txt` (provenance)

- [ ] **Step 1: Compute the SHA-256 pins for the four new voices**

Download each model + config once and hash it (these are the values to pin). Run:

```bash
cd /dcs98
for u in \
 "jarvis-medium|https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/jarvis-medium.onnx" \
 "hal|https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx" \
 "wheatley1|https://huggingface.co/davet2001/wheatley1/resolve/main/wheatley1.onnx" \
 "en_US-glados-high|https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high/resolve/main/en_US-glados-high.onnx"; do
  name=${u%%|*}; url=${u#*|}
  curl -sL "$url" -o /tmp/v.onnx && echo "$name.onnx  $(sha256sum /tmp/v.onnx | cut -d' ' -f1)"
  curl -sL "$url.json" -o /tmp/v.json && echo "$name.onnx.json  $(sha256sum /tmp/v.json | cut -d' ' -f1)"
done
```

Record the 8 digests for Step 2.

- [ ] **Step 2: Generalize the script to a `VOICES` array**

Replace the single `VOICE`/`VOICE_BASE`/`MODEL_URL`/`MODEL_SHA256`/`CONFIG_URL`/`CONFIG_SHA256` block (and the single-voice markers) with a list. Each entry names the on-disk `.onnx` filename plus its model/config URL + pinned SHA. The first entry is the existing public-domain default (unchanged pins):

```js
// Each voice ships as <onnx>.onnx + <onnx>.onnx.json in resources/piper/win-x64/. The first is the
// public-domain default; the rest are opt-in character voices (studio-copyright; see README-PIPER.txt).
const VOICES = [
  {
    onnx: 'en_US-ljspeech-high.onnx',
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx',
    modelSha: '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx.json',
    configSha: '7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14'
  },
  {
    onnx: 'jarvis-medium.onnx',
    modelUrl: 'https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/jarvis-medium.onnx',
    modelSha: '<JARVIS_ONNX_SHA>',
    configUrl: 'https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/jarvis-medium.onnx.json',
    configSha: '<JARVIS_JSON_SHA>'
  },
  {
    onnx: 'hal.onnx',
    modelUrl: 'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx',
    modelSha: '<HAL_ONNX_SHA>',
    configUrl: 'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx.json',
    configSha: '<HAL_JSON_SHA>'
  },
  {
    onnx: 'wheatley1.onnx',
    modelUrl: 'https://huggingface.co/davet2001/wheatley1/resolve/main/wheatley1.onnx',
    modelSha: '<WHEATLEY_ONNX_SHA>',
    configUrl: 'https://huggingface.co/davet2001/wheatley1/resolve/main/wheatley1.onnx.json',
    configSha: '<WHEATLEY_JSON_SHA>'
  },
  {
    onnx: 'en_US-glados-high.onnx',
    modelUrl: 'https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high/resolve/main/en_US-glados-high.onnx',
    modelSha: '<GLADOS_ONNX_SHA>',
    configUrl: 'https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high/resolve/main/en_US-glados-high.onnx.json',
    configSha: '<GLADOS_JSON_SHA>'
  }
];
```

Replace the `<…_SHA>` placeholders with the Step 1 digests.

- [ ] **Step 3: Loop the fetch + the idempotency check over `VOICES`**

The idempotency early-exit becomes "binary present AND every voice's `.onnx`+`.onnx.json` present". The fetch section, after the binary, loops:

```js
  for (const v of VOICES) {
    const model = join(outDir, v.onnx);
    await fetchVerify(v.modelUrl, model, v.modelSha);
    await fetchVerify(v.configUrl, `${model}.json`, v.configSha);
  }
  console.log(`[fetch-piper] ready: ${binMarker} + ${VOICES.length} voice(s)`);
```

And the top-of-file presence check:

```js
const haveAllVoices = VOICES.every((v) => existsSync(join(outDir, v.onnx)) && existsSync(join(outDir, `${v.onnx}.json`)));
if (existsSync(binMarker) && haveAllVoices) {
  console.log(`[fetch-piper] present: binary + ${VOICES.length} voice(s) (skipping)`);
  process.exit(0);
}
```

(`fetchVerify`, `download`, `sha256`, the binary fetch/unzip/flatten all stay as-is.)

- [ ] **Step 4: Update `resources/piper/README-PIPER.txt`**

Add a provenance + license block listing all five voices: `en_US-ljspeech-high` (LJ Speech, public
domain); `jarvis-medium` (jgkawell/jarvis, MIT); `hal` (campwill/HAL-9000-Piper-TTS, Apache-2.0);
`wheatley1` (davet2001/wheatley1, no declared upstream license); `en_US-glados-high`
(csukuangfj, no declared upstream license). Note the four character voices are studio-character-derived
and bundled per operator decision; LJ Speech is the default.

- [ ] **Step 5: Run the fetch to verify all voices download + pass the hash gate**

Run: `pnpm exec node scripts/fetch-piper.mjs`
Expected: each voice "verified ✓"; final "ready: … + 5 voice(s)". (A wrong pin aborts fail-closed.)
Then confirm: `ls resources/piper/win-x64/*.onnx` shows all five.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-piper.mjs resources/piper/README-PIPER.txt
git commit -m "build(voices): fetch-piper bundles Jarvis/HAL/GLaDOS/Wheatley (SHA-pinned)"
```

(The fetched `.onnx`/`.onnx.json` blobs are git-ignored build artifacts, as today — not committed.)

---

## Task 3: `piper-tts.ts` default+resolution + `listVoices` merge + picker label

**Files:**
- Modify: `src/main/services/piper-tts.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`

- [ ] **Step 1: Pin the default model in `resolvePaths` (`piper-tts.ts`)**

Add `DEFAULT_BUNDLED_ID` to the existing piper-voices import. In `resolvePaths`, replace the
"first `.onnx`" discovery:

```ts
    const entries = await readdir(dir);
    const onnx = entries.find((e) => e.endsWith('.onnx'));
    if (onnx && entries.includes(`${onnx}.json`)) model = join(dir, onnx);
```

with a pinned-default lookup that falls back to the first `.onnx`:

```ts
    const entries = await readdir(dir);
    const pick = entries.includes(DEFAULT_BUNDLED_ID) && entries.includes(`${DEFAULT_BUNDLED_ID}.json`)
      ? DEFAULT_BUNDLED_ID
      : entries.find((e) => e.endsWith('.onnx') && entries.includes(`${e}.json`));
    if (pick) model = join(dir, pick);
```

- [ ] **Step 2: Resolve bundled-then-user-then-default in `synthesize` (`piper-tts.ts`)**

Add `resolveBundledModelPath` to the piper-voices import. Replace the v3.16.1 model-selection lines:

```ts
  const userModel = voiceId ? await resolveUserModelPath(voiceId) : null;
  const model = userModel ?? r.model;
```

with:

```ts
  // Bundled voices win over user voices on an id collision; an unknown/invalid id → the default model.
  const chosen = voiceId ? (await resolveBundledModelPath(voiceId)) ?? (await resolveUserModelPath(voiceId)) : null;
  const model = chosen ?? r.model;
```

- [ ] **Step 3: Merge bundled+user in the `listVoices` handler (`register.ts`)**

Add `listBundledVoices` to the existing `piper-voices` import (line 48). Change the handler (line 333):

```ts
  safeHandle(channels.tts.listVoices, async () => [...await listBundledVoices(), ...await listUserVoices()]);
```

- [ ] **Step 4: Update the picker's default-option label (`AiAssistantModule.tsx`)**

Change the default `<option>` (line ~540):

```tsx
                  <option value="">🧠 Bundled neural (LJ Speech)</option>
```

(The `piperVoices.map(...)` below it now renders the four bundled character voices + any user voices, since `listVoices` returns both — no other renderer change.)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK (both targets).

- [ ] **Step 6: Run the voice tests + commit**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: PASS.

```bash
git add src/main/services/piper-tts.ts src/main/ipc/register.ts src/renderer/modules/ai-assistant/AiAssistantModule.tsx
git commit -m "feat(voices): pinned default + bundled-or-user synth resolution; picker lists bundled"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `pnpm typecheck` — OK.
- [ ] `pnpm test` — full suite green (extended `piper-voices`).
- [ ] `pnpm exec node scripts/fetch-piper.mjs` then `ls resources/piper/win-x64/*.onnx` — all five present.
- [ ] Security audit: `resolveBundledModelPath`/`resolveUserModelPath` never join raw `voiceId`; grep for `join(.*voiceId`; no new runtime egress (fetch is build-time only); the binary hash gate + per-voice model SHA pins intact; no `dangerouslySetInnerHTML`.
- [ ] Manual smoke (operator, Windows): the assistant voice dropdown lists **Bundled neural (LJ Speech)** + **Jarvis / HAL 9000 / GLaDOS / Wheatley** (+ any user voices); default (no pick) speaks in LJ Speech; picking each character voice speaks in it; a removed/garbage selection falls back to LJ Speech.

## Parked / out of scope

- Federation Computer (no fetchable model); real-person voices (publicity-rights tier); an in-app voice downloader; per-voice rate/pitch.
