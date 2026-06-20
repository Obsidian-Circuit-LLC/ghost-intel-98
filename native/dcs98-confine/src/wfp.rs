//! WFP apply/remove + the INV-C1 probe. The allow/deny POLICY is decided in win-wfp-spec.ts and arrives
//! here as JSON; this module deserializes it (the structs below must match win-wfp-spec.ts byte-for-byte)
//! and applies it verbatim. It NEVER invents policy.
//!
//! WINDOWS BUILD LOOP. Oracle: compiler + `cargo doc` for
//! `windows::Win32::NetworkManagement::WindowsFilteringPlatform`. API symbols are grounded in
//! research-wiki/prior-art/offensive-engine-egress-confinement.md:
//!   layers   FWPM_LAYER_ALE_AUTH_CONNECT_V4 / _V6
//!   conds    FWPM_CONDITION_ALE_USER_ID (SID via FWP_SECURITY_DESCRIPTOR_TYPE / token),
//!            FWPM_CONDITION_IP_REMOTE_ADDRESS (FWP_V4_ADDR_AND_MASK / FWP_V6_ADDR_AND_MASK),
//!            FWPM_CONDITION_IP_REMOTE_PORT (FWP_UINT16)
//!   calls    FwpmEngineOpen0 -> FwpmProviderAdd0 -> FwpmSubLayerAdd0 -> FwpmFilterAdd0;
//!            remove via FwpmFilterDeleteByKey0; all per-scope adds in one FwpmTransactionBegin0/Commit0.
//!
//! The pure pieces (the JSON model + the CIDR→addr/mask parsers) compile and are unit-tested on ANY host;
//! the unsafe FwpmXxx bodies are `todo!()` carrying the exact call sequence, to be filled on the Windows
//! host where the compiler + cargo doc confirm the windows-crate signatures. This is the honest boundary,
//! not a placeholder pretending to be done.

use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::Mutex;

// ---- The JSON model: must match win-wfp-spec.ts WfpCondition / WfpFilter exactly. ----

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "field", rename_all = "snake_case")]
pub enum Cond {
    AleUserId { sid: String },
    IpRemoteAddress { cidr: String },
    IpRemotePort { port: u16 },
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Filter {
    /// "ALE_AUTH_CONNECT_V4" | "ALE_AUTH_CONNECT_V6"
    pub layer: String,
    /// "permit" | "block"
    pub action: String,
    pub weight: u64,
    pub conditions: Vec<Cond>,
}

// ---- Pure CIDR parsing (unit-tested; feeds FWP_V4/V6_ADDR_AND_MASK). ----

/// Parse "a.b.c.d/n" → (network-order-agnostic host u32, mask u32). WFP wants the address and a contiguous
/// mask; we return both as host-order u32 and let the FFI convert to the on-wire layout it needs.
pub fn parse_cidr_v4(cidr: &str) -> anyhow::Result<(u32, u32)> {
    let (addr, prefix) = split_cidr(cidr, 32)?;
    let ip: Ipv4Addr = addr.parse().map_err(|_| anyhow::anyhow!("bad IPv4 in CIDR {cidr:?}"))?;
    let mask: u32 = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix) };
    Ok((u32::from(ip), mask))
}

/// Parse "addr/n" → (16-byte address, prefix-len). FFI builds FWP_V6_ADDR_AND_MASK from these.
pub fn parse_cidr_v6(cidr: &str) -> anyhow::Result<([u8; 16], u8)> {
    let (addr, prefix) = split_cidr(cidr, 128)?;
    let ip: Ipv6Addr = addr.parse().map_err(|_| anyhow::anyhow!("bad IPv6 in CIDR {cidr:?}"))?;
    Ok((ip.octets(), prefix as u8))
}

fn split_cidr(cidr: &str, max: u32) -> anyhow::Result<(String, u32)> {
    let (addr, plen) = cidr
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("CIDR missing prefix length: {cidr:?}"))?;
    let prefix: u32 = plen.parse().map_err(|_| anyhow::anyhow!("bad prefix length in {cidr:?}"))?;
    if prefix > max {
        anyhow::bail!("prefix /{prefix} out of range for this family in {cidr:?}");
    }
    Ok((addr.to_string(), prefix))
}

// ---- Scope tracking: scopeId → the WFP filter keys added for it (so remove() is exact + idempotent). ----

#[derive(Default)]
struct ScopeTable {
    /// scope_id → the FwpmFilterAdd0 runtime keys (GUIDs) we created for it.
    scopes: HashMap<String, Vec<u128>>,
}

static SCOPES: Mutex<Option<ScopeTable>> = Mutex::new(None);

fn scopes() -> std::sync::MutexGuard<'static, Option<ScopeTable>> {
    let mut g = SCOPES.lock().expect("scope table poisoned");
    if g.is_none() {
        *g = Some(ScopeTable::default());
    }
    g
}

/// Apply a filter set for one engagement; returns a fresh scope_id tracking the created filter keys.
/// All adds happen inside one WFP transaction so a partial scope can never exist.
pub fn apply(_sid: &str, _filters: &[Filter]) -> anyhow::Result<String> {
    // HOST: open (or reuse a service-lifetime) engine handle: FwpmEngineOpen0(None, RPC_C_AUTHN_WINNT, ...).
    // FwpmTransactionBegin0(engine, 0);
    // for f in filters:
    //   build FWPM_FILTER_CONDITION0[] from f.conditions:
    //     AleUserId{sid}      -> FWPM_CONDITION_ALE_USER_ID, FWP_SECURITY_DESCRIPTOR_TYPE built from the SID
    //                            (ConvertStringSidToSidW + a token-based SD; matchType FWP_MATCH_EQUAL)
    //     IpRemoteAddress{cidr}-> FWPM_CONDITION_IP_REMOTE_ADDRESS, FWP_V4_ADDR_AND_MASK / FWP_V6_ADDR_AND_MASK
    //                            from parse_cidr_v4 / parse_cidr_v6 (matchType FWP_MATCH_EQUAL)
    //     IpRemotePort{port}  -> FWPM_CONDITION_IP_REMOTE_PORT, FWP_UINT16 (matchType FWP_MATCH_EQUAL)
    //   FWPM_FILTER0 { layerKey: layer_guid(&f.layer)?, subLayerKey: SUBLAYER_GUID, weight: FWP_UINT64(f.weight),
    //                  action.type: permit_or_block(&f.action)?, providerKey: PROVIDER_GUID, numFilterConditions, filterCondition };
    //   FwpmFilterAdd0(engine, &filter, None, &mut id) -> collect id
    // FwpmTransactionCommit0(engine);
    // record scope_id -> ids; return scope_id (a fresh GUID string).
    let _ = (&*scopes(), layer_guid, action_is_permit);
    todo!("HOST: FwpmFilterAdd0 loop in one transaction (see grounded sequence above)")
}

/// Remove every filter tracked for a scope_id (transaction); idempotent (missing scope_id is a no-op).
pub fn remove(_scope_id: &str) -> anyhow::Result<()> {
    // HOST: FwpmTransactionBegin0; for key in scopes[scope_id]: FwpmFilterDeleteByKey0(engine, &key);
    // FwpmTransactionCommit0; drop the map entry.
    todo!("HOST: FwpmFilterDeleteByKey0 loop in one transaction")
}

/// Map a TS layer string to the WFP layer GUID. Pure routing — fail loud on an unknown layer.
fn layer_guid(layer: &str) -> anyhow::Result<&'static str> {
    match layer {
        "ALE_AUTH_CONNECT_V4" => Ok("FWPM_LAYER_ALE_AUTH_CONNECT_V4"),
        "ALE_AUTH_CONNECT_V6" => Ok("FWPM_LAYER_ALE_AUTH_CONNECT_V6"),
        other => anyhow::bail!("unknown WFP layer from spec: {other:?}"),
    }
}

fn action_is_permit(action: &str) -> anyhow::Result<bool> {
    match action {
        "permit" => Ok(true),
        "block" => Ok(false),
        other => anyhow::bail!("unknown WFP action from spec: {other:?}"),
    }
}

/// `dcs98-confine probe --proxy-port N --allow-cidr C` — the INV-C1 acceptance-gate worker. Applies a scope
/// then runs the 4-way egress probe AS the engine user so pktmon can observe what actually leaves the box.
pub fn run_probe(_args: Vec<String>) -> anyhow::Result<()> {
    // HOST: parse --proxy-port/--allow-cidr; build a ConfinementPlan-equivalent + a SID; apply(); then
    // spawn::create_as_engine_user a tiny probe that attempts:
    //   (a) connect 127.0.0.1:proxyPort  (expect SUCCESS)
    //   (b) connect first host in allow-cidr (expect reachable)
    //   (c) connect 8.8.8.8:443           (expect BLOCKED by WFP)
    //   (d) getaddrinfo("example.com")    (expect FAIL — no resolver reachable)
    // The assertion is done out-of-band by scripts/gates/assert-pktmon-confined.py over the pktmon capture.
    todo!("HOST: applyScope + run the 4-way probe as the engine user (drives the pktmon gate)")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v4_cidr_to_addr_and_mask() {
        let (addr, mask) = parse_cidr_v4("203.0.113.0/24").unwrap();
        assert_eq!(addr, u32::from(Ipv4Addr::new(203, 0, 113, 0)));
        assert_eq!(mask, 0xffff_ff00);
    }

    #[test]
    fn parses_v4_slash32_and_slash0() {
        assert_eq!(parse_cidr_v4("127.0.0.1/32").unwrap().1, 0xffff_ffff);
        assert_eq!(parse_cidr_v4("0.0.0.0/0").unwrap().1, 0);
    }

    #[test]
    fn parses_v6_cidr() {
        let (octets, prefix) = parse_cidr_v6("2001:db8::/32").unwrap();
        assert_eq!(prefix, 32);
        assert_eq!(octets[0], 0x20);
        assert_eq!(octets[1], 0x01);
    }

    #[test]
    fn rejects_bad_cidr() {
        assert!(parse_cidr_v4("203.0.113.0").is_err()); // no prefix
        assert!(parse_cidr_v4("203.0.113.0/33").is_err()); // out of range
        assert!(layer_guid("ALE_AUTH_DOORBELL").is_err());
        assert!(action_is_permit("maybe").is_err());
    }

    #[test]
    fn deserializes_the_ts_filter_json() {
        let json = r#"{"layer":"ALE_AUTH_CONNECT_V4","action":"permit","weight":10,
            "conditions":[{"field":"ale_user_id","sid":"S-1-5-21-1-2-3-1001"},
                          {"field":"ip_remote_address","cidr":"127.0.0.1/32"},
                          {"field":"ip_remote_port","port":54321}]}"#;
        let f: Filter = serde_json::from_str(json).unwrap();
        assert_eq!(f.layer, "ALE_AUTH_CONNECT_V4");
        assert!(action_is_permit(&f.action).unwrap());
        assert_eq!(f.conditions.len(), 3);
        match &f.conditions[2] {
            Cond::IpRemotePort { port } => assert_eq!(*port, 54321),
            other => panic!("wrong cond: {other:?}"),
        }
    }
}
