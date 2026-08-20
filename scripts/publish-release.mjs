#!/usr/bin/env node
/**
 * Publish a built release — draft first, assets second, publish last.
 *
 * ORDER IS THE POINT. A release must not be published until its assets are attached: the
 * anonymize-release workflow fires on `release: published` and swaps the release to
 * github-actions[bot] by deleting and recreating it. Publishing an empty release and uploading
 * afterwards races that swap, and the loser is a 900MB installer that exists nowhere else.
 *
 * Drafts do not raise the event, so: create draft → upload → publish → the workflow does the rest.
 *
 *   node scripts/publish-release.mjs v3.72.8 RELEASE_NOTES_v3.72.8.md release/3.72.8/GhostIntel98-Setup-3.72.8.exe
 *
 * Requires `gh` authenticated with push rights. Verifies the uploaded asset's digest against the
 * local file before publishing, and waits for the bot swap afterwards so a failure is visible here
 * rather than discovered later on the releases page.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const REPO = 'Obsidian-Circuit-LLC/ghost-intel-98';
const [tag, notesPath, assetPath] = process.argv.slice(2);
if (!tag || !notesPath || !assetPath) {
  console.error('usage: publish-release.mjs <tag> <notes.md> <asset.exe>');
  process.exit(2);
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const gh = (args, opts) => sh('gh', args, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const size = statSync(assetPath).size;
const sha = createHash('sha256').update(readFileSync(assetPath)).digest('hex');
console.log(`asset ${basename(assetPath)}  ${size.toLocaleString()} bytes  sha256:${sha}`);

// The notes must already carry the real hash — a placeholder here means the notes were never stamped.
const notes = readFileSync(notesPath, 'utf8');
for (const placeholder of ['__SHA256__', '__SIZE__']) {
  if (notes.includes(placeholder)) {
    console.error(`${notesPath} still contains ${placeholder} — stamp the notes before publishing.`);
    process.exit(1);
  }
}
if (!notes.includes(sha)) {
  console.error(`${notesPath} does not contain the built asset's SHA-256 (${sha}).`);
  process.exit(1);
}

console.log('creating DRAFT release (a draft raises no event, so nothing can race the upload)…');
const created = JSON.parse(
  gh(['api', `repos/${REPO}/releases`, '--method', 'POST', '--input', '-'], {
    input: JSON.stringify({
      tag_name: tag, target_commitish: 'main', name: `Ghost Intel 98 — ${tag}`,
      body: notes, draft: true, prerelease: false,
    }),
  }),
);
console.log(`  draft id ${created.id}`);

console.log('uploading asset…');
const token = gh(['auth', 'token']);
sh('curl', [
  '-sS', '--fail', '-X', 'POST',
  '-H', `Authorization: Bearer ${token}`,
  '-H', 'Content-Type: application/octet-stream',
  '-H', 'Accept: application/vnd.github+json',
  '--data-binary', `@${assetPath}`,
  `https://uploads.github.com/repos/${REPO}/releases/${created.id}/assets?name=${basename(assetPath)}`,
], { maxBuffer: 1 << 26 });

const uploaded = JSON.parse(gh(['api', `repos/${REPO}/releases/${created.id}`, '--jq',
  '{size: .assets[0].size, digest: .assets[0].digest, state: .assets[0].state}']));
console.log(`  uploaded ${uploaded.size?.toLocaleString()} bytes, ${uploaded.digest}, state=${uploaded.state}`);
if (uploaded.size !== size || uploaded.digest !== `sha256:${sha}`) {
  console.error('uploaded asset does not match the local build — leaving the release as a DRAFT.');
  process.exit(1);
}

console.log('publishing (this is what triggers the anonymize workflow)…');
gh(['api', `repos/${REPO}/releases/${created.id}`, '--method', 'PATCH',
    '-F', 'draft=false', '-F', 'make_latest=true'], {});

console.log('waiting for the bot swap…');
for (let i = 0; i < 60; i += 1) {
  await sleep(10_000);
  const author = gh(['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '.author.login']);
  if (author === 'github-actions[bot]') {
    const digest = gh(['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '.assets[0].digest']);
    console.log(`done — ${tag} authored by ${author}, asset ${digest}`);
    if (digest !== `sha256:${sha}`) {
      console.error('asset digest changed during the swap.');
      process.exit(1);
    }
    process.exit(0);
  }
  process.stdout.write('.');
}
console.error(`\n${tag} is published but still authored by a person — check the anonymize-release workflow.`);
process.exit(1);
