//! `install` / `uninstall` (elevated, run once by the "Enable offensive engine" setup) and the
//! non-elevated `status` probe.
//!
//! The status helpers (read_engine_sid / is_enabled / print_status) are pure std and inspectable on any
//! host. install/uninstall are the WINDOWS BUILD LOOP, run elevated; oracle = compiler + a Windows VM test
//! (does a clean install create the user+service+persistent base-deny? does uninstall leave zero WFP
//! state?).

use std::path::PathBuf;

/// %ProgramData%\DCS98\confine — the privileged state dir (engine.sid readable by the interactive user;
/// engine.cred = machine-DPAPI, LocalSystem+Admin only).
fn confine_dir() -> PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(base).join("DCS98").join("confine")
}

fn sid_path() -> PathBuf {
    confine_dir().join("engine.sid")
}

/// Read the dedicated engine user's SID written by `install`. Errors (incl. absent) ⇒ not enabled.
pub fn read_engine_sid() -> anyhow::Result<String> {
    let s = std::fs::read_to_string(sid_path())?;
    let s = s.trim().to_string();
    if s.is_empty() {
        anyhow::bail!("engine.sid is empty");
    }
    Ok(s)
}

/// The offensive engine is "enabled" iff the install step wrote a non-empty engine.sid.
pub fn is_enabled() -> bool {
    read_engine_sid().is_ok()
}

/// Non-elevated probe: print {"enabled":bool,"sid":string|null}. Drives the app's engineStatus path.
pub fn print_status() -> anyhow::Result<()> {
    let sid = read_engine_sid().ok();
    let json = serde_json::json!({ "enabled": sid.is_some(), "sid": sid });
    println!("{json}");
    Ok(())
}

/// Elevated one-time install. Idempotent. (WINDOWS BUILD LOOP — see module note.)
pub fn install() -> anyhow::Result<()> {
    // HOST sequence (all idempotent):
    // 1. Create dedicated low-priv user "DCS98ScanEgress" (NetUserAdd): CSPRNG password,
    //    UF_DONT_EXPIRE_PASSWD | UF_PASSWD_CANT_CHANGE; grant ONLY SeBatchLogonRight (LsaAddAccountRights);
    //    deny SeInteractiveLogonRight / SeNetworkLogonRight; drop from Users group. Resolve its SID string.
    // 2. CryptProtectData(password, CRYPTPROTECT_LOCAL_MACHINE) -> %ProgramData%\DCS98\confine\engine.cred
    //    (DACL: LocalSystem + Administrators only). Write the SID to engine.sid (DACL: + interactive user
    //    read — the app needs it for buildWfpFilterSpec; not secret). Write the username to engine.user.
    //    Record the installing interactive-user SID (engine.owner) for the service pipe DACL.
    // 3. FwpmEngineOpen0; FwpmProviderAdd0(PROVIDER_GUID, PERSISTENT); FwpmSubLayerAdd0(SUBLAYER_GUID,
    //    high weight, PERSISTENT); add PERSISTENT base-deny filters for the engine SID at _V4/_V6
    //    (weight BASE_DENY) + PERSISTENT IMDS deny (weight IMDS_DENY) — so with NO scope loaded the engine
    //    user still cannot egress at all. (Per-engagement PERMITs are added at runtime by wfp::apply.)
    // 4. CreateServiceW("DCS98Confine", SERVICE_AUTO_START, LocalSystem, "<exe> service"); StartServiceW.
    // The GUIDs MUST equal win-wfp-spec.ts PROVIDER_GUID/SUBLAYER_GUID (3f1820f3.../88845872...).
    let _ = confine_dir();
    todo!("HOST: NetUserAdd + DPAPI cred + persistent base-deny WFP + CreateServiceW (see sequence above)")
}

/// Elevated disable: remove everything install created, leaving zero lingering state. (WINDOWS BUILD LOOP.)
pub fn uninstall() -> anyhow::Result<()> {
    // HOST: ControlService(STOP) + DeleteService("DCS98Confine"); FwpmFilterDeleteByKey0 all our filters +
    // FwpmSubLayerDeleteByKey0(SUBLAYER_GUID) + FwpmProviderDeleteByKey0(PROVIDER_GUID) (purge by pinned
    // GUID — `netsh wfp show filters` must list none of ours after); NetUserDel("DCS98ScanEgress");
    // remove %ProgramData%\DCS98\confine. Idempotent (absent pieces are fine).
    todo!("HOST: stop+DeleteService + purge WFP by pinned GUID + NetUserDel + rm confine dir")
}
