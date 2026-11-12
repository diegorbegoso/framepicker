//! Client for the analysis engine: a child process that speaks line-delimited JSON-RPC 2.0.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Methods the interface may reach. `grant_roots` is deliberately absent: only the shell calls it.
pub const FORWARDABLE: &[&str] = &[
    "ping",
    "version",
    "settings_get",
    "settings_set",
    "scan",
    "preview",
    "analyze",
    "cancel",
    "job_status",
    "bursts",
    "select",
    "set_pick",
    "confirm_burst",
    "export",
    "luts_list",
    "luts_add",
    "luts_add_many",
    "luts_add_folder",
    "luts_remove",
    "luts_update",
    "luts_group_rename",
    "luts_group_remove",
    "straighten_suggest",
    "edits_get",
    "edits_set",
    "edits_reset",
    "edits_put",
    "autofix_suggest",
    "autofix_run",
    "sessions_list",
    "session_touch",
    "session_forget",
    "session_rename",
    "organize_preview",
    "organize_apply",
    "organize_undo",
    "selftest",
];

pub fn is_forwardable(method: &str) -> bool {
    FORWARDABLE.contains(&method)
}

pub fn encode_request(id: u64, method: &str, params: &Value) -> String {
    let mut line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        .to_string();
    line.push('\n');
    line
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcFailure {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, PartialEq)]
pub enum Incoming {
    Response { id: u64, result: Result<Value, RpcFailure> },
    Notification { method: String, params: Value },
}

pub fn decode_line(line: &str) -> Result<Incoming, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|error| format!("invalid JSON from engine: {error}"))?;
    if let Some(id) = value.get("id").and_then(Value::as_u64) {
        if let Some(error) = value.get("error") {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string();
            return Ok(Incoming::Response { id, result: Err(RpcFailure { code, message }) });
        }
        let result = value.get("result").cloned().unwrap_or(Value::Null);
        return Ok(Incoming::Response { id, result: Ok(result) });
    }
    match value.get("method").and_then(Value::as_str) {
        Some(method) => Ok(Incoming::Notification {
            method: method.to_string(),
            params: value.get("params").cloned().unwrap_or(Value::Null),
        }),
        None => Err("engine line is neither a response nor a notification".to_string()),
    }
}

pub fn data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("MT_DATA_DIR") {
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    match std::env::var("LOCALAPPDATA") {
        Ok(base) => PathBuf::from(base).join("MejoresTomas"),
        Err(_) => PathBuf::from(".mejores-tomas"),
    }
}

fn log_target() -> Stdio {
    let dir = data_dir().join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return Stdio::null();
    }
    match OpenOptions::new().create(true).append(true).open(dir.join("engine.log")) {
        Ok(file) => Stdio::from(file),
        Err(_) => Stdio::null(),
    }
}

#[cfg(debug_assertions)]
pub fn engine_command() -> Command {
    if let Ok(custom) = std::env::var("MT_ENGINE_CMD") {
        let mut parts = custom.split_whitespace();
        if let Some(program) = parts.next() {
            let mut command = Command::new(program);
            command.args(parts);
            return command;
        }
    }
    let mut command = Command::new("uv");
    command.args([
        "run",
        "--frozen",
        "--directory",
        concat!(env!("CARGO_MANIFEST_DIR"), "/../engine"),
        "python",
        "-m",
        "mejores_engine",
    ]);
    command
}

#[cfg(not(debug_assertions))]
pub fn engine_command() -> Command {
    let exe = std::env::current_exe().expect("cannot locate the application executable");
    let folder = exe.parent().expect("the executable has a parent folder");
    Command::new(folder.join("engine").join("mejores-engine.exe"))
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, RpcFailure>>>>>;

fn stopped() -> RpcFailure {
    RpcFailure { code: -32000, message: "the analysis engine stopped".to_string() }
}

pub struct EngineClient {
    child: Child,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next_id: AtomicU64,
}

impl EngineClient {
    pub fn spawn(on_event: impl Fn(String, Value) + Send + 'static) -> std::io::Result<EngineClient> {
        let mut command = engine_command();
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log_target());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match decode_line(&line) {
                    Ok(Incoming::Response { id, result }) => {
                        if let Some(sender) = reader_pending.lock().unwrap().remove(&id) {
                            let _ = sender.send(result);
                        }
                    }
                    Ok(Incoming::Notification { method, params }) => on_event(method, params),
                    Err(_) => {}
                }
            }
            for (_, sender) in reader_pending.lock().unwrap().drain() {
                let _ = sender.send(Err(stopped()));
            }
        });
        Ok(EngineClient {
            child,
            stdin: Mutex::new(stdin),
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, RpcFailure> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, sender);
        let line = encode_request(id, method, &params);
        let written = {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush())
        };
        if written.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(stopped());
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(RpcFailure {
                    code: -32000,
                    message: "the analysis engine did not answer in time".to_string(),
                })
            }
        }
    }
}

impl Drop for EngineClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_line_round_trips_through_the_codec() {
        let line = encode_request(7, "ping", &json!({}));
        assert!(line.ends_with('\n'));
        let echoed: Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(echoed["id"], 7);
        assert_eq!(echoed["method"], "ping");
        let reply = r#"{"jsonrpc":"2.0","id":7,"result":{"pong":true,"version":"0.1.0"}}"#;
        assert_eq!(
            decode_line(reply).unwrap(),
            Incoming::Response { id: 7, result: Ok(json!({"pong": true, "version": "0.1.0"})) }
        );
    }

    #[test]
    fn an_error_response_keeps_its_code_and_message() {
        let reply = r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32010,"message":"path not allowed"}}"#;
        assert_eq!(
            decode_line(reply).unwrap(),
            Incoming::Response {
                id: 3,
                result: Err(RpcFailure { code: -32010, message: "path not allowed".to_string() }),
            }
        );
    }

    #[test]
    fn a_line_without_an_id_is_a_notification() {
        let line = r#"{"jsonrpc":"2.0","method":"progress","params":{"done":1,"total":4}}"#;
        assert_eq!(
            decode_line(line).unwrap(),
            Incoming::Notification {
                method: "progress".to_string(),
                params: json!({"done": 1, "total": 4}),
            }
        );
    }

    #[test]
    fn garbage_from_the_engine_is_an_error_not_a_panic() {
        assert!(decode_line("not json").is_err());
        assert!(decode_line(r#"{"jsonrpc":"2.0"}"#).is_err());
    }

    #[test]
    fn grant_roots_is_never_forwardable() {
        assert!(!is_forwardable("grant_roots"));
        assert!(is_forwardable("scan"));
        assert!(is_forwardable("confirm_burst"));
        assert!(is_forwardable("luts_add"));
        assert!(is_forwardable("edits_set"));
        assert!(is_forwardable("edits_put"));
        assert!(is_forwardable("autofix_run"));
        assert!(is_forwardable("sessions_list"));
        assert!(is_forwardable("session_rename"));
        assert!(is_forwardable("organize_apply"));
        assert!(is_forwardable("luts_add_many"));
        assert!(is_forwardable("luts_add_folder"));
        assert!(!is_forwardable("pick_luts"));
        assert!(!is_forwardable("nope"));
    }
}
