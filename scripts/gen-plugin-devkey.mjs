import { ed25519 } from '@noble/curves/ed25519.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
const edSec = ed25519.utils.randomSecretKey();
const pq = ml_dsa65.keygen();
const hex = (u) => Buffer.from(u).toString('hex');
console.log(JSON.stringify({
  ED_PUB: hex(ed25519.getPublicKey(edSec)), PQ_PUB: hex(pq.publicKey),
  ED_SEC: hex(edSec), PQ_SEC: hex(pq.secretKey)
}, null, 2));
