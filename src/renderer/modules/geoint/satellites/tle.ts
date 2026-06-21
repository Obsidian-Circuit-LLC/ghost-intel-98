// src/renderer/modules/geoint/satellites/tle.ts
/** Pure TLE parsing. Accepts CelesTrak FORMAT=tle text (3-line named blocks) and bare 2-line pairs.
 *  Never throws on bad input — malformed blocks are skipped (parseTleText) or reported (validateTlePair). */
import type { SatelliteRecord } from './types';
import { classifyByName } from './classify';

const isL1 = (s: string): boolean => /^1 /.test(s) && s.length >= 60;
const isL2 = (s: string): boolean => /^2 /.test(s) && s.length >= 60;

/** NORAD catalog number from TLE line 1 columns 3-7 (1-indexed). Returns null if not numeric. */
function noradFrom(line1: string): number | null {
  const n = parseInt(line1.slice(2, 7).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function makeRecord(name: string, line1: string, line2: string): SatelliteRecord {
  const noradId = noradFrom(line1);
  const cleanName = name.trim() || (noradId !== null ? String(noradId) : 'UNKNOWN');
  return {
    id: noradId !== null ? `sat-${noradId}` : `sat-${cleanName.replace(/\s+/g, '_')}`,
    name: cleanName,
    noradId,
    line1,
    line2,
    type: classifyByName(cleanName, noradId),
    source: 'celestrak',
    active: true,
    addedAt: ''
  };
}

export function parseTleText(text: string): SatelliteRecord[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const out: SatelliteRecord[] = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    if (a === '') { i++; continue; }
    // 3-line: name, L1, L2
    if (!isL1(a) && isL1(lines[i + 1] ?? '') && isL2(lines[i + 2] ?? '')) {
      out.push(makeRecord(a, lines[i + 1], lines[i + 2]));
      i += 3; continue;
    }
    // 2-line: L1, L2
    if (isL1(a) && isL2(lines[i + 1] ?? '')) {
      out.push(makeRecord('', a, lines[i + 1]));
      i += 2; continue;
    }
    i++; // unrecognized line — skip
  }
  return out;
}

export function validateTlePair(
  name: string, line1: string, line2: string
): { ok: true; record: SatelliteRecord } | { ok: false; error: string } {
  if (!isL1(line1) || !isL2(line2)) {
    return { ok: false, error: 'Invalid TLE: line 1 must start with "1 " and line 2 with "2 " (≥69 chars each).' };
  }
  return { ok: true, record: makeRecord(name, line1, line2) };
}
