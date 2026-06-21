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

/// Pinned WFP identifiers (match install.rs persistent policy + the prior win-wfp-spec.ts GUIDs;
/// DO NOT regenerate — a changed GUID orphans installed filters).
pub const PROVIDER_GUID: &str = "3f1820f3-9024-441f-a45f-82254c1cfc51";
pub const SUBLAYER_GUID: &str = "88845872-9863-4036-9e9e-a07efc333bb7";

/// Filter weights within the dcs98 sublayer (higher wins): IMDS_DENY > SCOPE_PERMIT > BASE_DENY.
pub mod weight { pub const IMDS_DENY: u64 = 15; pub const SCOPE_PERMIT: u64 = 10; pub const BASE_DENY: u64 = 5; }

/// AWS-style link-local instance-metadata endpoints — always denied, and never permittable.
const IMDS_V4: &str = "169.254.169.254/32";
const IMDS_V6: &str = "fd00:ec2::254/128";
const IMDS_V4_ADDR: Ipv4Addr = Ipv4Addr::new(169, 254, 169, 254);
const IMDS_V6_OCTETS: [u8; 16] = [0xfd, 0x00, 0x0e, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x54];

const LAYER_V4: &str = "ALE_AUTH_CONNECT_V4";
const LAYER_V6: &str = "ALE_AUTH_CONNECT_V6";

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

/// Validate a Windows SID string: `^S-\d-\d+(-\d+)*$` (no regex crate). "S", a single-digit revision,
/// then one or more all-numeric authority/sub-authority parts.
fn valid_sid(sid: &str) -> bool {
    let parts: Vec<&str> = sid.split('-').collect();
    if parts.len() < 3 || parts[0] != "S" { return false; }
    if parts[1].len() != 1 || !parts[1].bytes().all(|b| b.is_ascii_digit()) { return false; }
    parts[2..].iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

enum Fam { V4, V6 }

/// True if the v6 network (octets/prefix) contains `target`.
fn v6_contains(net: &[u8; 16], prefix: u8, target: &[u8; 16]) -> bool {
    let full = (prefix / 8) as usize;
    if net[..full] != target[..full] { return false; }
    let rem = prefix % 8;
    if rem == 0 { return true; }
    let mask = 0xffu8 << (8 - rem);
    (net[full] & mask) == (target[full] & mask)
}

/// Validate a scope CIDR and classify its family. Rejects: unparseable, default route (/0), and any
/// CIDR that COVERS the IMDS address (so a permit can never widen to all or whitelist metadata).
fn scope_cidr_family(cidr: &str) -> anyhow::Result<Fam> {
    if let Ok((addr, mask)) = parse_cidr_v4(cidr) {
        if mask == 0 { anyhow::bail!("default-route CIDR not allowed in scope: {cidr:?}"); }
        if (u32::from(IMDS_V4_ADDR) & mask) == (addr & mask) {
            anyhow::bail!("scope CIDR covers the IMDS address (denied): {cidr:?}");
        }
        return Ok(Fam::V4);
    }
    if let Ok((octets, prefix)) = parse_cidr_v6(cidr) {
        if prefix == 0 { anyhow::bail!("default-route CIDR not allowed in scope: {cidr:?}"); }
        if v6_contains(&octets, prefix, &IMDS_V6_OCTETS) {
            anyhow::bail!("scope CIDR covers the IMDS address (denied): {cidr:?}");
        }
        return Ok(Fam::V6);
    }
    anyhow::bail!("unparseable CIDR in scope: {cidr:?}")
}

/// THE AUTHORITY. Derive the canonical WFP filter set from trusted scalars — the native side never
/// trusts a caller-supplied filter list. Mirrors the netns jail: deny-by-default for the engine SID,
/// permit {loopback proxy, validated scope CIDRs}, inviolable top-weight IMDS deny. Pure + unit-tested.
pub fn derive_scope_filters(sid: &str, proxy_port: u16, allow_cidrs: &[String]) -> anyhow::Result<Vec<Filter>> {
    if !valid_sid(sid) { anyhow::bail!("confinement requires a valid engine SID, got {sid:?}"); }
    if proxy_port == 0 { anyhow::bail!("confinement requires a valid loopback proxy port, got 0"); }
    let user = || Cond::AleUserId { sid: sid.to_string() };
    let mut filters: Vec<Filter> = Vec::new();

    // (1) catch-all BLOCK for the engine SID at both families (deny-by-default).
    filters.push(Filter { layer: LAYER_V4.into(), action: "block".into(), weight: weight::BASE_DENY, conditions: vec![user()] });
    filters.push(Filter { layer: LAYER_V6.into(), action: "block".into(), weight: weight::BASE_DENY, conditions: vec![user()] });

    // (2) PERMIT the loopback proxy (127.0.0.1:proxy_port).
    filters.push(Filter {
        layer: LAYER_V4.into(), action: "permit".into(), weight: weight::SCOPE_PERMIT,
        conditions: vec![user(), Cond::IpRemoteAddress { cidr: "127.0.0.1/32".into() }, Cond::IpRemotePort { port: proxy_port }],
    });

    // (3) PERMIT each validated scope CIDR at its family's layer.
    for cidr in allow_cidrs {
        let layer = match scope_cidr_family(cidr)? { Fam::V4 => LAYER_V4, Fam::V6 => LAYER_V6 };
        filters.push(Filter {
            layer: layer.into(), action: "permit".into(), weight: weight::SCOPE_PERMIT,
            conditions: vec![user(), Cond::IpRemoteAddress { cidr: cidr.clone() }],
        });
    }

    // (4) TOP-weight IMDS BLOCK at both families (inviolable defense-in-depth).
    filters.push(Filter { layer: LAYER_V4.into(), action: "block".into(), weight: weight::IMDS_DENY, conditions: vec![user(), Cond::IpRemoteAddress { cidr: IMDS_V4.into() }] });
    filters.push(Filter { layer: LAYER_V6.into(), action: "block".into(), weight: weight::IMDS_DENY, conditions: vec![user(), Cond::IpRemoteAddress { cidr: IMDS_V6.into() }] });

    Ok(filters)
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

    fn cidrs(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }
    const TSID: &str = "S-1-5-21-1-2-3-1001";

    fn conds_have_sid(f: &Filter, sid: &str) -> bool {
        f.conditions.iter().any(|c| matches!(c, Cond::AleUserId { sid: s } if s == sid))
    }

    #[test]
    fn derives_the_canonical_set_pinned_to_the_sid() {
        let fs = derive_scope_filters(TSID, 54321, &cidrs(&["203.0.113.0/24"])).unwrap();
        // 2 base-deny + 1 loopback permit + 1 scope permit + 2 IMDS-deny
        assert_eq!(fs.len(), 6);
        assert!(fs.iter().all(|f| conds_have_sid(f, TSID))); // every filter pins the engine SID
        // base-deny present at both families
        assert!(fs.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V4" && f.action == "block" && f.weight == 5));
        assert!(fs.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V6" && f.action == "block" && f.weight == 5));
        // loopback permit carries the port + 127.0.0.1/32
        let lb = fs.iter().find(|f| f.action == "permit" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemotePort { port: 54321 }))).unwrap();
        assert!(lb.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "127.0.0.1/32")));
        // IMDS-deny at top weight, both families
        assert_eq!(fs.iter().filter(|f| f.action == "block" && f.weight == 15).count(), 2);
    }

    #[test]
    fn routes_v4_and_v6_scope_cidrs_to_their_layers() {
        let fs = derive_scope_filters(TSID, 8080, &cidrs(&["198.51.100.0/24", "2001:db8::/32"])).unwrap();
        let permits: Vec<_> = fs.iter().filter(|f| f.action == "permit" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr.contains("198.51.100") || cidr.contains("2001:db8")))).collect();
        assert!(permits.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V4" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "198.51.100.0/24"))));
        assert!(permits.iter().any(|f| f.layer == "ALE_AUTH_CONNECT_V6" && f.conditions.iter().any(|c| matches!(c, Cond::IpRemoteAddress { cidr } if cidr == "2001:db8::/32"))));
    }

    #[test]
    fn rejects_default_route_cidrs() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["0.0.0.0/0"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["::/0"])).is_err());
    }

    #[test]
    fn rejects_imds_covering_cidrs() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["169.254.169.254/32"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["169.254.0.0/16"])).is_err());
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["fd00:ec2::/32"])).is_err());
    }

    #[test]
    fn rejects_malformed_cidr_bad_sid_and_zero_port() {
        assert!(derive_scope_filters(TSID, 8080, &cidrs(&["not-a-cidr"])).is_err());
        assert!(derive_scope_filters("notasid", 8080, &cidrs(&["198.51.100.0/24"])).is_err());
        assert!(derive_scope_filters("S-1", 8080, &cidrs(&[])).is_err()); // too few parts
        assert!(derive_scope_filters(TSID, 0, &cidrs(&["198.51.100.0/24"])).is_err());
    }

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
