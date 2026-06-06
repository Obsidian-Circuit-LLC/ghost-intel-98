/**
 * Chat protocol constants (Phase 1, v3) — suite id, protocol label, and the frozen
 * domain-separation tags. Centralized so the handshake, invite, and prekey code can't drift on a
 * label (a mismatch silently breaks interop or, worse, a security binding).
 *
 * EXPERIMENTAL: the v3 handshake these feed is pending formal verification (ProVerif/CryptoVerif).
 * See docs/superpowers/formal/.
 */
const tag = (s: string): Uint8Array => new TextEncoder().encode(s);

export const SUITE_ID = tag('dcs98-chat/v3/x25519+mlkem768+ed25519');
export const PROTO_LABEL = tag('dcs98-chat/handshake/v3');

// Signature domain-separation (crypto-audit H-2): every Ed25519 use under an identity key gets a
// distinct prefix so one signature can never be replayed as another context.
export const DS_INVITE = tag('dcs98-chat/ds/invite/v1');
export const DS_PREKEY = tag('dcs98-chat/ds/prekey/v1');
export const DS_HS_INIT = tag('dcs98-chat/ds/hs-init/v1');
export const DS_HS_RESP = tag('dcs98-chat/ds/hs-resp/v1');
export const DS_MAC_T = tag('dcs98-chat/ds/mac-t/v1');

// MixKey step labels + derive labels (all distinct ⇒ hk1≠hk2≠RK≠SID).
export const MIX_INIT = tag('dcs98-chat/mix/init');
export const MIX_ES = tag('dcs98-chat/mix/es');
export const MIX_SSPRE = tag('dcs98-chat/mix/ss-pre');
export const MIX_EE = tag('dcs98-chat/mix/ee');
export const MIX_SE = tag('dcs98-chat/mix/se');
export const MIX_SSI = tag('dcs98-chat/mix/ss-i');
export const DRV_HK1 = tag('dcs98-chat/drv/hk1');
export const DRV_HK2 = tag('dcs98-chat/drv/hk2');
export const DRV_ROOT = tag('dcs98-chat/drv/root');
export const DRV_SID = tag('dcs98-chat/drv/sid');

/** Concatenate byte chunks (transcript / signed-message assembly). */
export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
