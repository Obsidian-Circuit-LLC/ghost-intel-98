/**
 * Offline entitlement issuer for the OSINT reasoning pack. Signs a token with the SEPARATE offline
 * entitlement key (distinct from the plugin-release key) so the OSINT plugin's ctx.reasoning.verify
 * accepts it against core's ENTITLEMENT_KEYSETS pin. No network, ever — this is run offline by the
 * operator; the private keys never enter the repo.
 *
 * The signed message is canonicalBytes(token) = JSON with SORTED top-level keys — byte-identical to
 * the OSINT plugin's src/main/brain/entitlement.ts canonicalBytes(). The signature is the same
 * Ed25519 ∥ ML-DSA-65 hybrid layout core's verifyPluginSignature expects: edSig(64) ‖ pqSig.
 *
 * Usage:
 *   node scripts/gen-entitlement.mjs --subject ghostexodus --tier tester [--features llm] \
 *     [--expires 2027-01-01T00:00:00Z] --keyfile scripts/.entitlement-dev-key.json --out entitlement.json
 *   (or supply raw hex secrets: --ed <edSecHex> --pq <pqSecHex>)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** Canonical bytes = JSON with sorted TOP-LEVEL keys (arrays kept in order). MUST match the plugin's
 *  entitlement.ts canonicalBytes so the signature verifies there. */
function canonicalBytes(token) {
  const ordered = {};
  for (const k of Object.keys(token).sort()) ordered[k] = token[k];
  return new TextEncoder().encode(JSON.stringify(ordered));
}

const subject = arg('subject');
const tier = arg('tier', 'tester');
const out = arg('out', 'entitlement.json');
if (!subject) { console.error('need --subject'); process.exit(1); }
if (!['tester', 'comp', 'paid'].includes(tier)) { console.error('--tier must be tester|comp|paid'); process.exit(1); }

let edSecHex = arg('ed');
let pqSecHex = arg('pq');
const keyfile = arg('keyfile');
if (keyfile) {
  const k = JSON.parse(readFileSync(keyfile, 'utf8'));
  edSecHex = edSecHex ?? k.ED_SEC;
  pqSecHex = pqSecHex ?? k.PQ_SEC;
}
if (!edSecHex || !pqSecHex) { console.error('need --keyfile or both --ed and --pq secret hex'); process.exit(1); }

const token = {
  subject,
  tier,
  issuedAt: arg('issued', new Date().toISOString()),
  features: (arg('features', 'llm')).split(',').map((s) => s.trim()).filter(Boolean),
};
const expires = arg('expires');
if (expires) token.expiresAt = expires;

const msg = canonicalBytes(token);
const edSec = Uint8Array.from(Buffer.from(edSecHex, 'hex'));
const pqSec = Uint8Array.from(Buffer.from(pqSecHex, 'hex'));
const edSig = ed25519.sign(msg, edSec);
const pqSig = ml_dsa65.sign(msg, pqSec);
const sig = Buffer.concat([Buffer.from(edSig), Buffer.from(pqSig)]).toString('base64');

writeFileSync(out, JSON.stringify({ token, sig }, null, 2));
console.error(`wrote ${out} — subject=${subject} tier=${tier}${expires ? ` expires=${expires}` : ''}`);
