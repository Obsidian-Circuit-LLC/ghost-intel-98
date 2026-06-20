//! dcs98-confine — the privileged Windows helper for the offensive-engine egress jail (Plan 05a T5/T6).
//!
//! ONE signed binary, modes selected by argv:
//!   install    — elevated, run once by the "Enable offensive engine" setup (creates the dedicated user,
//!                DPAPI cred, persistent base-deny WFP policy, and the SYSTEM service). See install.rs.
//!   uninstall  — elevated, tears all of that down (zero lingering WFP state / user / service).
//!   service    — the SCM entry; runs as LocalSystem. Serves the named-pipe control protocol: applyScope /
//!                spawn (as the engine user) / kill / clearScope / status. See service.rs.
//!   status     — non-elevated probe; prints {"enabled":bool,"sid":string|null}.
//!   probe      — INV-C1 acceptance-gate helper: applyScope + run the 4-way egress probe AS the engine
//!                user (used by scripts/gates/win-confinement-pktmon.ps1). See wfp.rs / spawn.rs.
//!
//! The security-critical allow/deny POLICY is decided in the unit-tested TypeScript
//! (src/main/offensive/confinement/win-wfp-spec.ts) and shipped to this helper as a JSON filter list.
//! This binary is a dumb-but-careful APPLIER of that JSON — it never invents policy.
//!
//! BUILD/VERIFY: this crate targets an OS the dev box can't execute. Its oracle is `cargo build`/`clippy`
//! on the x86_64-pc-windows-msvc host plus the live pktmon INV-C1 gate (scripts/gates). Spots whose exact
//! windows-crate signature must be confirmed against `cargo doc` on the host are marked `HOST-CONFIRM`.

mod pipe;
mod service;
mod wfp;
mod spawn;
mod install;

fn main() -> std::process::ExitCode {
    let mode = std::env::args().nth(1).unwrap_or_default();
    let r: anyhow::Result<()> = match mode.as_str() {
        "install" => install::install(),
        "uninstall" => install::uninstall(),
        "service" => service::run(),
        "status" => install::print_status(),
        "probe" => wfp::run_probe(std::env::args().skip(2).collect()),
        other => {
            eprintln!("dcs98-confine: unknown mode {other:?} (expected install|uninstall|service|status|probe)");
            return std::process::ExitCode::from(2);
        }
    };
    match r {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("dcs98-confine: {e:#}");
            std::process::ExitCode::FAILURE
        }
    }
}
