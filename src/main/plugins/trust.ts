/**
 * Plugin trust root. PINNED_KEYSETS holds the public keys the core will accept plugin
 * signatures from. Verification passes if ANY one keyset validates BOTH legs (Ed25519 ∥ ML-DSA-65).
 * Private keys live OFFLINE with the operator and never touch this repo. The keyset(s) below are
 * a DEV key for local smoke testing — the operator replaces them with the offline release key
 * (see scripts/gen-plugin-devkey.mjs and Task 16) before any public release.
 */
export interface TrustKeyset {
  edPub: Uint8Array; // 32 bytes
  pqPub: Uint8Array; // ML-DSA-65 public key
}

export const PLUGIN_API_VERSION = 1;
export const MIN_SUPPORTED_API_VERSION = 1;

export function isApiCompatible(target: number): boolean {
  return (
    Number.isInteger(target) &&
    target >= MIN_SUPPORTED_API_VERSION &&
    target <= PLUGIN_API_VERSION
  );
}

// Filled by Task 16 with the generated dev keyset (hex-decoded). Empty here = no plugin loads.
export const PINNED_KEYSETS: TrustKeyset[] = [];

/** Accessor used by the loader/verify path (function form keeps it stubbable in tests). */
export function getPinnedKeysets(): TrustKeyset[] {
  return PINNED_KEYSETS;
}
