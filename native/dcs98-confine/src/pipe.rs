//! Named-pipe wire protocol — the Rust mirror of src/main/offensive/confinement/win-pipe.ts.
//! Frame layout: [type:u8][len:u32le][payload]. Control JSON is tiny; stdout/stderr are chunked frames.
//! The TS side and this side MUST agree byte-for-byte; the codec is pure and the unit tests below run on
//! any host (`cargo test`).

use std::io::{self, Read, Write};

pub const FRAME_REQUEST: u8 = 0x01;
pub const FRAME_RESPONSE: u8 = 0x02;
pub const FRAME_STDOUT: u8 = 0x10;
pub const FRAME_STDERR: u8 = 0x11;
pub const FRAME_EXIT: u8 = 0x12;

/// Hard cap on a single frame so a hostile/corrupt peer can't drive unbounded buffering (mirrors win-pipe.ts).
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

pub fn encode_frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(5 + payload.len());
    out.push(kind);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// Write one frame to a sink.
pub fn write_frame<W: Write>(w: &mut W, kind: u8, payload: &[u8]) -> io::Result<()> {
    w.write_all(&encode_frame(kind, payload))
}

#[derive(Debug, Clone)]
pub struct Frame {
    pub kind: u8,
    pub body: Vec<u8>,
}

/// Read exactly one frame from a blocking reader. Returns Ok(None) on clean EOF before any byte.
pub fn read_frame<R: Read>(r: &mut R) -> anyhow::Result<Option<Frame>> {
    let mut head = [0u8; 5];
    match r.read_exact(&mut head) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let kind = head[0];
    let len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
    if len > MAX_FRAME {
        anyhow::bail!("win-pipe: frame too large ({len})");
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    Ok(Some(Frame { kind, body }))
}

/// Control requests the app sends to the service. Mirrors win-pipe.ts `ControlRequest`.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ControlRequest {
    #[serde(rename_all = "camelCase")]
    ApplyScope {
        proxy_port: u16,
        allow_cidrs: Vec<String>,
        sid: String,
        /// The WfpFilter[] from buildWfpFilterSpec — deserialized by wfp::Filter.
        filters: Vec<crate::wfp::Filter>,
    },
    #[serde(rename_all = "camelCase")]
    Spawn {
        scope_id: String,
        cmd: String,
        args: Vec<String>,
    },
    Kill {
        pid: u32,
    },
    #[serde(rename_all = "camelCase")]
    ClearScope {
        scope_id: String,
    },
    Status,
}

/// Control response. Mirrors win-pipe.ts `ControlResponse` (loosely parsed on the TS side).
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<EngineStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ControlResponse {
    pub fn ok() -> Self {
        Self { ok: true, ..Default::default() }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self { ok: false, error: Some(msg.into()), ..Default::default() }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub enabled: bool,
    pub engine_sid: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn round_trips_a_control_request() {
        let payload = br#"{"op":"applyScope","proxyPort":54321,"allowCidrs":["203.0.113.0/24"],"sid":"S-1-5-21-1-2-3-1001","filters":[]}"#;
        let wire = encode_frame(FRAME_REQUEST, payload);
        let mut cur = Cursor::new(wire);
        let f = read_frame(&mut cur).unwrap().unwrap();
        assert_eq!(f.kind, FRAME_REQUEST);
        let req: ControlRequest = serde_json::from_slice(&f.body).unwrap();
        match req {
            ControlRequest::ApplyScope { proxy_port, allow_cidrs, sid, .. } => {
                assert_eq!(proxy_port, 54321);
                assert_eq!(allow_cidrs, vec!["203.0.113.0/24".to_string()]);
                assert_eq!(sid, "S-1-5-21-1-2-3-1001");
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn rejects_an_absurd_length_prefix() {
        let mut bad = vec![FRAME_STDOUT];
        bad.extend_from_slice(&0x7fff_ffffu32.to_le_bytes());
        let mut cur = Cursor::new(bad);
        assert!(read_frame(&mut cur).is_err());
    }

    #[test]
    fn response_serializes_camelcase_and_omits_none() {
        let r = ControlResponse { ok: true, scope_id: Some("sc1".into()), ..Default::default() };
        let s = serde_json::to_string(&r).unwrap();
        assert_eq!(s, r#"{"ok":true,"scopeId":"sc1"}"#);
    }
}
