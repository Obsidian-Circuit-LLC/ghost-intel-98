// usage: node scripts/sign-plugin.mjs <plugin-dir> <devkey.json>
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
const [dir, keyfile] = process.argv.slice(2);
const k = JSON.parse(readFileSync(keyfile, 'utf8'));
const lp = (b) => { const l = Buffer.alloc(8); l.writeBigUInt64BE(BigInt(b.length)); return Buffer.concat([l, b]); };
const man = readFileSync(join(dir, 'manifest.json'));
const m = JSON.parse(man.toString());
const main = readFileSync(join(dir, m.main));
const rend = readFileSync(join(dir, m.renderer));
const assets = [];
const adir = join(dir, 'assets');
if (existsSync(adir)) { const walk = (rel) => { for (const n of readdirSync(join(adir, rel))) { const r = rel ? `${rel}/${n}` : n; const f = join(adir, r); if (lstatSync(f).isSymbolicLink()) throw new Error('symlink asset'); if (statSync(f).isDirectory()) walk(r); else assets.push({ path: r, bytes: readFileSync(f) }); } }; walk(''); }
const h = createHash('sha512'); h.update(Buffer.from('DCS98-PLUGIN-v1')); h.update(Buffer.from([0]));
h.update(lp(man)); h.update(lp(main)); h.update(lp(rend));
for (const a of assets.sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0)) h.update(lp(Buffer.concat([Buffer.from(a.path), Buffer.from([0]), a.bytes])));
const hash = h.digest();
const ed = ed25519.sign(hash, Buffer.from(k.ED_SEC, 'hex'));
const pq = ml_dsa65.sign(hash, Buffer.from(k.PQ_SEC, 'hex'));
writeFileSync(join(dir, 'signature.bin'), Buffer.concat([Buffer.from(ed), Buffer.from(pq)]));
console.log('signed', dir, 'sig bytes', ed.length + pq.length);
