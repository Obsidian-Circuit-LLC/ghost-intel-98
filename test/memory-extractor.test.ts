import { describe, it, expect } from 'vitest';
import { parseCandidates, extractItems, type ExtractorClient } from '../src/main/services/memory/profile/extractor';

describe('parseCandidates', () => {
  it('parses a JSON array of fact strings', () => {
    const out = parseCandidates('["Uses Tor-only egress", "Prefers hardware wallets"]', 'global', ['convo:1']);
    expect(out).toEqual([
      { scope: 'global', text: 'Uses Tor-only egress', provenance: ['convo:1'] },
      { scope: 'global', text: 'Prefers hardware wallets', provenance: ['convo:1'] }
    ]);
  });

  it('parses JSON-lines (one JSON string per line)', () => {
    const raw = '"Uses Tor-only egress"\n"Prefers hardware wallets"';
    const out = parseCandidates(raw, 'global', ['convo:1']);
    expect(out.map((c) => c.text)).toEqual(['Uses Tor-only egress', 'Prefers hardware wallets']);
  });

  it('returns [] for non-JSON garbage', () => {
    expect(parseCandidates('not json at all, just prose.', 'global', [])).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(parseCandidates('', 'global', [])).toEqual([]);
    expect(parseCandidates('   ', 'global', [])).toEqual([]);
  });

  it('skips blank/non-string/non-object entries within an array', () => {
    const raw = '["fact one", "", 42, null, "fact two"]';
    const out = parseCandidates(raw, 'global', []);
    expect(out.map((c) => c.text)).toEqual(['fact one', 'fact two']);
  });

  it('accepts objects with a text field', () => {
    const raw = '[{"text":"fact one"},{"text":"fact two"}]';
    const out = parseCandidates(raw, 'case:c1', ['note:x']);
    expect(out).toEqual([
      { scope: 'case:c1', text: 'fact one', provenance: ['note:x'] },
      { scope: 'case:c1', text: 'fact two', provenance: ['note:x'] }
    ]);
  });

  it('skips JSON-lines that fail to parse but keeps the ones that succeed', () => {
    const raw = '"fact one"\nnot valid json\n"fact two"';
    const out = parseCandidates(raw, 'global', []);
    expect(out.map((c) => c.text)).toEqual(['fact one', 'fact two']);
  });
});

describe('extractItems', () => {
  it('parses the client completion into candidates', async () => {
    const client: ExtractorClient = { complete: async () => '["Uses Tor-only egress"]' };
    const out = await extractItems(client, 'user: I only use Tor.\nassistant: noted.', 'global', ['convo:1']);
    expect(out).toEqual([{ scope: 'global', text: 'Uses Tor-only egress', provenance: ['convo:1'] }]);
  });

  it('is best-effort: a throwing client yields []', async () => {
    const client: ExtractorClient = {
      complete: async () => {
        throw new Error('ollama unreachable');
      }
    };
    const out = await extractItems(client, 'turns', 'global', []);
    expect(out).toEqual([]);
  });

  it('is best-effort: a garbage completion yields []', async () => {
    const client: ExtractorClient = { complete: async () => 'not json' };
    const out = await extractItems(client, 'turns', 'global', []);
    expect(out).toEqual([]);
  });
});
