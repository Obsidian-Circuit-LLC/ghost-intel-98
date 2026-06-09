/**
 * Chat protocol constants (Phase 1, v3) — suite id, protocol label, and the frozen
 * domain-separation tags. Centralized so the handshake, invite, and prekey code can't drift on a
 * label (a mismatch silently breaks interop or, worse, a security binding).
 *
 * EXPERIMENTAL: the v4 handshake these feed is pending formal verification (ProVerif/CryptoVerif).
 * See docs/superpowers/formal/.
 */
const tag = (s: string): Uint8Array => new TextEncoder().encode(s);

export const SUITE_ID = tag('dcs98-chat/v4/x25519+mlkem1024+ed25519');
export const PROTO_LABEL = tag('dcs98-chat/handshake/v3');

// Signature domain-separation (crypto-audit H-2): every Ed25519 use under an identity key gets a
// distinct prefix so one signature can never be replayed as another context.
export const DS_INVITE = tag('dcs98-chat/ds/invite/v1');
export const DS_PREKEY = tag('dcs98-chat/ds/prekey/v1');
export const DS_HS_INIT = tag('dcs98-chat/ds/hs-init/v1');
export const DS_HS_RESP = tag('dcs98-chat/ds/hs-resp/v1');
export const DS_MAC_T = tag('dcs98-chat/ds/mac-t/v1');
export const DS_HS_REJECT = tag('dcs98-chat/ds/hs-reject/v1');
export const DS_MAC_R = tag('dcs98-chat/ds/mac-r/v1');
export const RECONNECT_GATE = tag('dcs98-chat/reconnect-gate/v4');

// hs_type discriminants carried in the responder's reply message.
export const HS_MSG2 = 0;   // responder reply: accept (Msg2)
export const HS_REJECT = 1; // responder reply: prekey_unknown recovery (Reject)
// FRAMING INVARIANT (spec §4, rev-4 N-1): mac_R, TH_R0, and Sig_R_reject concatenate
// prekey_id ‖ xe_I ‖ ek_I ‖ ct_pre (and TH_R0 also offered_prekey ‖ is_last_resort) by RAW
// concatenation under a DS prefix. This is unambiguous ONLY because every field is fixed-width.
// Any future variable-width field MUST be length-prefixed before concatenation.

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
