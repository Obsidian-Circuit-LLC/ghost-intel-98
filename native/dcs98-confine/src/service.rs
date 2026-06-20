//! The SYSTEM service (SCM entry, runs as LocalSystem) + the named-pipe control loop.
//!
//! WINDOWS BUILD LOOP. Oracle: compiler + the `windows-service` crate docs + `cargo doc` for
//! `windows::Win32::System::Pipes`. The SCM registration + the pipe SECURITY_ATTRIBUTES DACL are
//! host-filled; the per-request DISPATCH (`handle_request`) and the frame serve loop are written here in
//! full (they only call wfp::/spawn::, which are host-filled), so the control-protocol logic is reviewable
//! and matches win-pipe.ts.

use std::io::{Read, Write};

use crate::pipe::{
    read_frame, write_frame, ControlRequest, ControlResponse, EngineStatus, FRAME_REQUEST, FRAME_RESPONSE,
};

/// SCM entry. Registers the service and runs the dispatcher.
pub fn run() -> anyhow::Result<()> {
    // HOST: windows_service::service_dispatcher::start("DCS98Confine", ffi_service_main).
    //   ffi_service_main -> register a control handler (Stop/Shutdown -> stop the pipe loop), report
    //   Running, then accept_loop(). Mirror windows-service's `examples/`.
    accept_loop()
}

/// Accept named-pipe clients and serve each until disconnect.
fn accept_loop() -> anyhow::Result<()> {
    // HOST: create the pipe server \\.\pipe\dcs98-confine with a SECURITY_ATTRIBUTES whose DACL admits ONLY
    // { LocalSystem, the interactive-user SID stored at install }. CreateNamedPipeW (PIPE_ACCESS_DUPLEX,
    // PIPE_TYPE_BYTE) -> ConnectNamedPipe -> wrap the HANDLE in a Read+Write -> serve_connection(stream).
    // Loop. A different local user cannot drive the service (DACL).
    todo!("HOST: CreateNamedPipeW with a tight DACL + ConnectNamedPipe loop -> serve_connection")
}

/// Serve one connected client: read control frames, dispatch, write responses; stream child IO as frames.
/// Generic over the transport so it can be exercised against an in-memory duplex in a host-side test.
pub fn serve_connection<S: Read + Write>(stream: &mut S) -> anyhow::Result<()> {
    while let Some(frame) = read_frame(stream)? {
        if frame.kind != FRAME_REQUEST {
            continue;
        }
        // `handle_request` returns None when it has already written its own RESPONSE (the `spawn` case
        // writes the pid response itself, then streams stdout/exit frames). Exactly one RESPONSE per
        // REQUEST keeps the app's pending-resolver queue (win-wfp.ts) in sync.
        let resp = match serde_json::from_slice::<ControlRequest>(&frame.body) {
            Ok(req) => handle_request(stream, req)?,
            Err(e) => Some(ControlResponse::err(format!("bad control request: {e}"))),
        };
        if let Some(resp) = resp {
            let body = serde_json::to_vec(&resp)?;
            write_frame(stream, FRAME_RESPONSE, &body)?;
        }
    }
    Ok(())
}

/// Dispatch one control request. For `spawn`, this also pumps child stdout/stderr/exit as frames before
/// returning the spawn response's pid (the response is written first so the app learns the pid, then the
/// stream frames follow — matching win-wfp.ts which reads RESPONSE then STDOUT/EXIT).
fn handle_request<S: Read + Write>(stream: &mut S, req: ControlRequest) -> anyhow::Result<Option<ControlResponse>> {
    match req {
        ControlRequest::ApplyScope { sid, filters, .. } => Ok(Some(match crate::wfp::apply(&sid, &filters) {
            Ok(scope_id) => ControlResponse { ok: true, scope_id: Some(scope_id), ..Default::default() },
            Err(e) => ControlResponse::err(format!("WFP apply failed: {e}")),
        })),
        ControlRequest::Spawn { scope_id, cmd, args } => {
            let mut child = match crate::spawn::create_as_engine_user(&cmd, &args) {
                Ok(c) => c,
                Err(e) => return Ok(Some(ControlResponse::err(format!("spawn failed: {e}")))),
            };
            let pid = child.pid;
            // Write the spawn RESPONSE first (carries the pid), then stream stdout/exit frames.
            let body = serde_json::to_vec(&ControlResponse { ok: true, pid: Some(pid), ..Default::default() })?;
            write_frame(stream, FRAME_RESPONSE, &body)?;
            pump_child(stream, &mut child)?;
            // On natural child exit the service clears the scope server-side (matches win-wfp.ts, which does
            // NOT re-send clearScope on exit). Best-effort: a clear failure is logged, not fatal.
            if let Err(e) = crate::wfp::remove(&scope_id) {
                eprintln!("service: clearScope after exit failed for {scope_id}: {e:#}");
            }
            Ok(None) // RESPONSE already written above; do not write a second one.
        }
        ControlRequest::Kill { pid } => Ok(Some(match crate::spawn::kill(pid) {
            Ok(()) => ControlResponse::ok(),
            Err(e) => ControlResponse::err(format!("kill failed: {e}")),
        })),
        ControlRequest::ClearScope { scope_id } => Ok(Some(match crate::wfp::remove(&scope_id) {
            Ok(()) => ControlResponse::ok(),
            Err(e) => ControlResponse::err(format!("clearScope failed: {e}")),
        })),
        ControlRequest::Status => Ok(Some(ControlResponse {
            ok: true,
            status: Some(EngineStatus { enabled: crate::install::is_enabled(), engine_sid: crate::install::read_engine_sid().ok() }),
            ..Default::default()
        })),
    }
}

/// Pump a spawned child's stdout/stderr into frames and its exit code into a FRAME_EXIT.
fn pump_child<S: Read + Write>(_stream: &mut S, _child: &mut crate::spawn::SpawnedChild) -> anyhow::Result<()> {
    // HOST: loop reading child.read_stdout/read_stderr -> write_frame(FRAME_STDOUT/STDERR); on EOF,
    // child.wait() -> write_frame(FRAME_EXIT, {"code": <code|null>}). Use a select/threaded reader so
    // stdout and stderr don't deadlock. Keep frames well under MAX_FRAME.
    todo!("HOST: stream child stdout/stderr as frames, then FRAME_EXIT with the wait() code")
}
