/**
 * Global test ML-KEM provider. Production serves ML-KEM-1024 from the AWS-LC FIPS sidecar
 * (services/mlkem-sidecar.ts); unit tests can't spawn it, so we install an in-process ML-KEM-1024
 * via @noble/post-quantum (a devDependency, NOT in the production bundle) so the async crypto seam is
 * exercised end-to-end. The real sidecar is covered by test/mlkem-kat.test.ts when its binary is present.
 */
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { setMlkemProvider } from '../src/main/chat/crypto';

setMlkemProvider({
  keygen: async () => {
    const kp = ml_kem1024.keygen();
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  },
  encapsulate: async (peerPublic: Uint8Array) => {
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(peerPublic);
    return { cipherText, sharedSecret };
  },
  decapsulate: async (cipherText: Uint8Array, secretKey: Uint8Array) => ml_kem1024.decapsulate(cipherText, secretKey)
});
