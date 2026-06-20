//! Launch the engine AS the dedicated low-privilege user so its process token carries the engine SID and
//! the WFP filters bind to it automatically (and inherit to grandchildren).
//!
//! WINDOWS BUILD LOOP. Oracle: compiler + `cargo doc` for `windows::Win32::System::Threading` /
//! `::Security`. Sequence (grounded in the prior-art note):
//!   LogonUserW(engineUser, pw, LOGON32_LOGON_BATCH, LOGON32_PROVIDER_DEFAULT) -> hToken
//!     (pw = CryptUnprotectData of the machine-DPAPI blob the install step wrote; LocalSystem can read it)
//!   CreateProcessAsUserW(hToken, cmd, args, ... CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
//!                        redirected stdio = anonymous pipes the service pumps into STDOUT/STDERR frames)
//!   LocalSystem holds SE_ASSIGNPRIMARYTOKEN / SE_INCREASE_QUOTA, so no interactive desktop is needed.

use std::process::ExitStatus;

/// A child running as the engine user, with handles the service pumps into pipe frames.
pub struct SpawnedChild {
    pub pid: u32,
    // HOST: hold the process HANDLE + redirected stdout/stderr read handles here so the service can
    // pump them into FRAME_STDOUT/FRAME_STDERR and wait for the exit code.
}

impl SpawnedChild {
    /// Block until the child exits; return its code (the service turns this into a FRAME_EXIT).
    pub fn wait(&mut self) -> anyhow::Result<Option<i32>> {
        // HOST: WaitForSingleObject(process) + GetExitCodeProcess.
        let _ = std::mem::size_of::<ExitStatus>();
        todo!("HOST: WaitForSingleObject + GetExitCodeProcess")
    }

    /// Read available stdout bytes (the service loops this into FRAME_STDOUT). Returns 0 at EOF.
    pub fn read_stdout(&mut self, _buf: &mut [u8]) -> anyhow::Result<usize> {
        todo!("HOST: ReadFile on the redirected stdout pipe")
    }

    pub fn read_stderr(&mut self, _buf: &mut [u8]) -> anyhow::Result<usize> {
        todo!("HOST: ReadFile on the redirected stderr pipe")
    }
}

/// Spawn `cmd args` as the dedicated engine user. Called only by the LocalSystem service.
pub fn create_as_engine_user(_cmd: &str, _args: &[String]) -> anyhow::Result<SpawnedChild> {
    // HOST: read engine username from %ProgramData%\DCS98\confine\engine.sid sibling (engine.user), pw via
    // CryptUnprotectData(engine.cred, CRYPTPROTECT_LOCAL_MACHINE); LogonUserW(BATCH); create redirected
    // stdio anonymous pipes (CreatePipe + SetHandleInformation INHERIT); CreateProcessAsUserW(...).
    todo!("HOST: LogonUserW(BATCH) + CreateProcessAsUserW with redirected stdio")
}

/// Force-terminate a child by pid (the `kill` control op / explicit stop()).
pub fn kill(_pid: u32) -> anyhow::Result<()> {
    // HOST: OpenProcess(PROCESS_TERMINATE, pid) + TerminateProcess + CloseHandle. Idempotent: a missing
    // pid (already exited) is Ok(()).
    todo!("HOST: OpenProcess + TerminateProcess")
}
