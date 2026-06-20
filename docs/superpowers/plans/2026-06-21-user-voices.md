# User-Supplied Piper Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add their own Piper voices (drop a `<name>.onnx` + `<name>.onnx.json` pair into `<dataRoot>/voices/`) and pick one in the AI assistant TTS controls; default stays the bundled voice.

**Architecture:** A new traversal-safe `piper-voices.ts` (scan + resolve, dep-injected for tests); `piper-tts.ts synthesize` gains an optional `voiceId` resolved per-call to a model path (user voice or bundled fallback); new `tts.listVoices` / `tts.revealVoicesFolder` IPC; an `ai.piperVoice` setting; a renderer voice dropdown + reveal button.

**Tech Stack:** Electron main (node:fs, spawn), React renderer, vitest (node env, pure-ish tests over injected fs).

**Spec:** `docs/superpowers/specs/2026-06-21-user-voices-design.md`

## Global Constraints

- **Renderer is untrusted → traversal-safe resolution in main.** `resolveUserModelPath(voiceId)` returns a path ONLY when `voiceId` exactly matches a basename discovered by scanning the voices dir; an unknown id, `null`/empty, a `../…` traversal, or an absolute path → `null` (→ bundled fallback). NEVER `join(dir, rawRendererInput)`.
- The bundled piper **binary keeps its verify-before-exec SHA gate**; user-supplied `.onnx` models are user-chosen data (no hash gate — can't pin user files).
- No network, no telemetry, no new egress host. Nothing copyrighted is bundled (user supplies voices locally).
- A selected-but-missing/invalid voice must **silently fall back to the bundled voice** (never throw).
- Test style: vitest **node** env, pure-ish tests over injected fs deps. No React render harness.

---

## Task 1: `piper-voices.ts` — scan + traversal-safe resolve

**Files:**
- Create: `src/main/services/piper-voices.ts`
- Test: `test/piper-voices.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/piper-voices.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listUserVoices, resolveUserModelPath, type VoicesDeps } from '../src/main/services/piper-voices';

/** Fake voices dir: `files` lists readdir entries; `json` maps a sidecar name → its text content. */
function deps(files: string[], json: Record<string, string> = {}, throwReaddir = false): VoicesDeps {
  return {
    dir: '/voices',
    readdir: async () => { if (throwReaddir) throw new Error('ENOENT'); return files; },
    readText: async (p: string) => {
      const name = p.replace('/voices/', '');
      if (name in json) return json[name];
      throw new Error('no such file');
    }
  };
}

describe('listUserVoices', () => {
  it('returns a complete .onnx + valid-JSON .onnx.json pair', async () => {
    const d = deps(['jarvis.onnx', 'jarvis.onnx.json'], { 'jarvis.onnx.json': '{"sample_rate":22050}' });
    expect(await listUserVoices(d)).toEqual([{ id: 'jarvis.onnx', name: 'jarvis' }]);
  });
  it('ignores a lone .onnx with no sidecar', async () => {
    expect(await listUserVoices(deps(['lone.onnx']))).toEqual([]);
  });
  it('ignores a pair whose sidecar is not valid JSON', async () => {
    const d = deps(['bad.onnx', 'bad.onnx.json'], { 'bad.onnx.json': '{ not json' });
    expect(await listUserVoices(d)).toEqual([]);
  });
  it('a missing/unreadable dir is empty, not an error', async () => {
    expect(await listUserVoices(deps([], {}, true))).toEqual([]);
  });
  it('sorts results by name', async () => {
    const d = deps(['z.onnx', 'z.onnx.json', 'a.onnx', 'a.onnx.json'], { 'z.onnx.json': '{}', 'a.onnx.json': '{}' });
    expect((await listUserVoices(d)).map((v) => v.name)).toEqual(['a', 'z']);
  });
});

describe('resolveUserModelPath', () => {
  const ok = deps(['v.onnx', 'v.onnx.json'], { 'v.onnx.json': '{}' });
  it('resolves a known id to a path under the voices dir', async () => {
    expect(await resolveUserModelPath('v.onnx', ok)).toBe('/voices/v.onnx');
  });
  it('returns null for an unknown id', async () => {
    expect(await resolveUserModelPath('nope.onnx', ok)).toBeNull();
  });
  it('returns null for a path-traversal id (security)', async () => {
    expect(await resolveUserModelPath('../../etc/passwd', ok)).toBeNull();
  });
  it('returns null for an absolute path (security)', async () => {
    expect(await resolveUserModelPath('/etc/passwd', ok)).toBeNull();
  });
  it('returns null for null/empty', async () => {
    expect(await resolveUserModelPath(null, ok)).toBeNull();
    expect(await resolveUserModelPath('', ok)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: FAIL — cannot resolve `piper-voices`.

- [ ] **Step 3: Create `piper-voices.ts`**

```ts
/**
 * User-supplied Piper voices. The user drops a `<name>.onnx` + `<name>.onnx.json` pair into
 * <dataRoot>/voices/; this module scans + validates them and resolves a chosen voice id to a model
 * path. The renderer is untrusted, so resolveUserModelPath is TRAVERSAL-SAFE: it accepts an id only
 * when it exactly matches a basename we discovered by scanning the dir, and joins that discovered
 * name — never raw renderer input. fs deps are injected for unit testing; realVoicesDeps() wires the
 * vault path + node:fs (evaluated per-call, so dataRoot()/Electron is never touched at import time).
 */
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';

export interface VoicesDeps {
  dir: string;
  readdir(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
}

export function userVoicesDir(): string {
  return join(dataRoot(), 'voices');
}

export function realVoicesDeps(): VoicesDeps {
  const dir = userVoicesDir();
  return { dir, readdir: (p) => readdir(p), readText: (p) => readFile(p, 'utf8') };
}

/** Scan the voices dir for complete, JSON-valid voice pairs. Missing/unreadable dir → []. Never
 *  throws. id = the `.onnx` filename; name = that filename without the `.onnx` extension. */
export async function listUserVoices(deps: VoicesDeps = realVoicesDeps()): Promise<{ id: string; name: string }[]> {
  let entries: string[];
  try { entries = await deps.readdir(deps.dir); }
  catch { return []; }
  const set = new Set(entries);
  const out: { id: string; name: string }[] = [];
  for (const e of entries) {
    if (!e.endsWith('.onnx')) continue;
    if (!set.has(`${e}.json`)) continue;
    try { JSON.parse(await deps.readText(join(deps.dir, `${e}.json`))); }
    catch { continue; } // unreadable / non-JSON sidecar → skip
    out.push({ id: e, name: e.slice(0, -'.onnx'.length) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a chosen voice id to a model path, or null. Traversal-safe: only ids that match a
 *  scanned basename resolve (to a path WE construct); anything else (unknown, '', '../…', absolute)
 *  → null, so the caller falls back to the bundled voice. */
export async function resolveUserModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realVoicesDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const hit = (await listUserVoices(deps)).find((v) => v.id === voiceId);
  return hit ? join(deps.dir, hit.id) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/piper-voices.ts test/piper-voices.test.ts
git commit -m "feat(voices): traversal-safe user-voice scan + model resolution"
```

---

## Task 2: `synthesize(voiceId)` + reveal + IPC plumbing

**Files:**
- Modify: `src/main/services/piper-tts.ts` (synthesize voiceId; revealVoicesFolder)
- Modify: `src/shared/ipc-contracts.ts` (tts channels)
- Modify: `src/main/ipc/register.ts` (handlers)
- Modify: `src/preload/index.ts` (bridge)
- Modify: `src/preload/api.d.ts` (types)

This task is glue verified by `pnpm typecheck` + the Task 1 test staying green; no new pure unit.

- [ ] **Step 1: `synthesize` gains `voiceId` in `piper-tts.ts`**

Add imports near the top (with the existing imports):

```ts
import { mkdir } from 'node:fs/promises';
import { shell } from 'electron';
import { resolveUserModelPath, userVoicesDir } from './piper-voices';
```

Change the `synthesize` signature + model selection. Replace:

```ts
export async function synthesize(text: string, rate?: number): Promise<Uint8Array> {
  const r = await resolvePaths();
  if (!r) throw new Error('Piper voice is not installed.');
  const tmp = join(app.getPath('temp'), `ga98-piper-${randomUUID().slice(0, 8)}.wav`);
  const args = buildPiperArgs(r.model, rateToLengthScale(rate), tmp);
```

with:

```ts
export async function synthesize(text: string, rate?: number, voiceId?: string): Promise<Uint8Array> {
  const r = await resolvePaths();
  if (!r) throw new Error('Piper voice is not installed.');
  // A chosen user voice (traversal-safe); a missing/invalid/absent id falls back to the bundled model.
  const userModel = voiceId ? await resolveUserModelPath(voiceId) : null;
  const model = userModel ?? r.model;
  const tmp = join(app.getPath('temp'), `ga98-piper-${randomUUID().slice(0, 8)}.wav`);
  const args = buildPiperArgs(model, rateToLengthScale(rate), tmp);
```

(The rest of the function body is unchanged.)

- [ ] **Step 2: Add `revealVoicesFolder` to `piper-tts.ts`**

After `cancelActive()` (end of file):

```ts
/** Create (if needed) and open the user voices folder so the user can drop in <name>.onnx +
 *  <name>.onnx.json pairs. */
export async function revealVoicesFolder(): Promise<void> {
  const dir = userVoicesDir();
  await mkdir(dir, { recursive: true });
  await shell.openPath(dir);
}
```

- [ ] **Step 3: Add IPC channels in `ipc-contracts.ts`**

```ts
  tts: {
    piperStatus: 'tts:piperStatus',
    synthesize: 'tts:synthesize',
    cancel: 'tts:cancel',
    listVoices: 'tts:listVoices',
    revealVoicesFolder: 'tts:revealVoicesFolder'
  },
```

- [ ] **Step 4: Wire handlers in `register.ts`**

Add the import (with the other service imports):

```ts
import { listUserVoices } from '../services/piper-voices';
```

Replace the existing `tts.synthesize` handler and add the two new handlers (the `tts` section ~:329-331):

```ts
  safeHandle(channels.tts.synthesize, (...a) => piperTts.synthesize(ensureTtsText(a[0]), ensureRate(a[1]), typeof a[2] === 'string' ? a[2] : undefined));
  safeHandle(channels.tts.listVoices, () => listUserVoices());
  safeHandle(channels.tts.revealVoicesFolder, () => piperTts.revealVoicesFolder());
```

(Keep the existing `piperStatus` and `cancel` handlers as-is.)

- [ ] **Step 5: Preload bridge in `index.ts`**

Replace the `tts` bridge block with:

```ts
  tts: {
    piperStatus: () => ipcRenderer.invoke(channels.tts.piperStatus),
    synthesize: (text: string, rate?: number, voiceId?: string) => ipcRenderer.invoke(channels.tts.synthesize, text, rate, voiceId),
    cancel: () => ipcRenderer.invoke(channels.tts.cancel),
    listVoices: () => ipcRenderer.invoke(channels.tts.listVoices),
    revealVoicesFolder: () => ipcRenderer.invoke(channels.tts.revealVoicesFolder)
  },
```

- [ ] **Step 6: API types in `api.d.ts`**

Replace the `tts` interface block with:

```ts
  tts: {
    piperStatus(): Promise<{ available: boolean }>;
    synthesize(text: string, rate?: number, voiceId?: string): Promise<Uint8Array>;
    cancel(): Promise<void>;
    listVoices(): Promise<{ id: string; name: string }[]>;
    revealVoicesFolder(): Promise<void>;
  };
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: OK (both targets).

- [ ] **Step 8: Confirm Task 1 test still green + commit**

Run: `pnpm exec vitest run test/piper-voices.test.ts`
Expected: PASS.

```bash
git add src/main/services/piper-tts.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(voices): synthesize(voiceId) + tts.listVoices/revealVoicesFolder IPC"
```

---

## Task 3: `ai.piperVoice` setting

**Files:**
- Modify: `src/shared/types.ts` (type + default)

- [ ] **Step 1: Add the type field**

In the `ai: { ... }` settings block, after `ttsEngine: 'auto' | 'system' | 'piper';` (~:379):

```ts
    /** Chosen user-supplied Piper voice id (the `.onnx` filename), or null for the bundled voice. */
    piperVoice: string | null;
```

- [ ] **Step 2: Add the default**

In the `ai` block of the default settings object, after `ttsEngine: 'auto',` (~:552):

```ts
    piperVoice: null,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: OK (required field present in the default).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(voices): add ai.piperVoice setting (default null = bundled)"
```

---

## Task 4: Renderer — pass the voice + pick it in the UI

**Files:**
- Modify: `src/renderer/audio/tts.ts` (`SpeakOpts.piperVoice`)
- Modify: `src/renderer/audio/piper.ts` (pass `voiceId` to synthesize)
- Modify: `src/renderer/modules/ai-assistant/AiAssistantModule.tsx` (callsites + dropdown + reveal + list)

- [ ] **Step 1: Add `piperVoice` to `SpeakOpts` (`tts.ts`)**

```ts
export interface SpeakOpts {
  voiceURI?: string | null;
  rate?: number;
  onEnd?: () => void;
  /** Chosen user Piper voice id (passed through to the Piper sidecar); ignored by Web Speech. */
  piperVoice?: string | null;
}
```

(`speakAuto` already forwards `opts` to `speakPiper` unchanged — no edit needed there.)

- [ ] **Step 2: Pass the voice in `speakPiper` (`piper.ts`)**

In the synth loop, change:

```ts
        const wav = await window.api.tts.synthesize(chunk, opts.rate ?? undefined);
```

to:

```ts
        const wav = await window.api.tts.synthesize(chunk, opts.rate ?? undefined, opts.piperVoice ?? undefined);
```

- [ ] **Step 3: Thread `piperVoice` from settings at the `speakAuto` call sites (`AiAssistantModule.tsx`)**

Both call sites (~:272 and ~:384) add `piperVoice` from the same settings object they already read:

```ts
          void speakAuto(acc, { voiceURI: st.ai.ttsVoiceUri, rate: st.ai.ttsRate, piperVoice: st.ai.piperVoice }).then((r) => {
```

```ts
          void speakAuto(t, { voiceURI: st?.ai.ttsVoiceUri, rate: st?.ai.ttsRate, piperVoice: st?.ai.piperVoice, onEnd: res }).then((r) => {
```

- [ ] **Step 4: Load the user-voice list (state + effect) in `AiAssistantModule.tsx`**

With the other TTS state (near `piperOk`, ~:63) add:

```tsx
  const [piperVoices, setPiperVoices] = useState<{ id: string; name: string }[]>([]);
  const loadPiperVoices = (): void => { void window.api.tts.listVoices().then(setPiperVoices).catch(() => setPiperVoices([])); };
```

Load on mount (extend the existing piper effect ~:144):

```tsx
  useEffect(() => { void piperAvailable().then(setPiperOk); loadPiperVoices(); }, []);
```

- [ ] **Step 5: Add the voice dropdown + reveal button**

Replace the static "🧠 offline neural" label block (~:531-533) with a voice picker + folder button:

```tsx
            {settings?.ai.ttsEnabled && piperOk && (settings?.ai.ttsEngine ?? 'auto') !== 'system' && (
              <>
                <select
                  className="ga98-text"
                  style={{ maxWidth: 150 }}
                  value={settings?.ai.piperVoice ?? ''}
                  onChange={(e) => void setTts({ piperVoice: e.target.value || null })}
                  title="Piper neural voice. Drop your own <name>.onnx + <name>.onnx.json into the Voices folder to add more."
                >
                  <option value="">🧠 Bundled neural</option>
                  {piperVoices.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => void window.api.tts.revealVoicesFolder().then(loadPiperVoices)}
                  title="Open the Voices folder — drop <name>.onnx + <name>.onnx.json pairs in, then reselect."
                >📁 Voices</button>
              </>
            )}
```

- [ ] **Step 6: Extend `setTts` to accept `piperVoice` (`AiAssistantModule.tsx`)**

Update the `setTts` param type (~:135):

```tsx
  async function setTts(patch: { ttsEnabled?: boolean; ttsVoiceUri?: string | null; ttsRate?: number; ttsEngine?: 'auto' | 'system' | 'piper'; piperVoice?: string | null }): Promise<void> {
```

(The body already spreads the patch into the `ai` settings merge; no further change.)

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: OK. (If `setTts`'s merge doesn't already carry arbitrary `ai` keys, confirm the patch is spread into `{ ...s.ai, ...patch }`; adjust only if typecheck flags it.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/audio/tts.ts src/renderer/audio/piper.ts src/renderer/modules/ai-assistant/AiAssistantModule.tsx
git commit -m "feat(voices): Piper voice picker + reveal-folder; thread piperVoice through speak"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `pnpm typecheck` — OK.
- [ ] `pnpm test` — full suite green (new: `piper-voices`).
- [ ] Security audit: confirm `resolveUserModelPath` never joins raw renderer input (only discovered basenames); grep the new code for any `join(.*voiceId)` outside the validated path; no new egress/IPC beyond `tts.listVoices` + `tts.revealVoicesFolder`; no `dangerouslySetInnerHTML`.
- [ ] Manual smoke (operator, Windows): with no user voices, the Piper dropdown shows only "Bundled neural"; click **📁 Voices** → the folder opens; drop a `<name>.onnx` + `<name>.onnx.json` pair in, reopen the dropdown (toggle voice off/on or reselect) → the voice appears; pick it → the assistant speaks in that voice; delete the file → it falls back to the bundled voice without error.

## Parked / out of scope

- In-app "Import voice…" file-picker (folder + reveal ships now); fetching voices from a catalog; per-speaker selection within a multi-speaker model; bundling any specific third-party voice.
