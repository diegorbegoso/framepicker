pub mod engine;

use engine::{is_forwardable, EngineClient, RpcFailure};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

/// True when the process was started with the exact `--version` flag (the program name is skipped).
pub fn wants_version(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--version")
}

/// True when the process was started with the exact `--ping-engine` flag.
pub fn wants_ping_engine(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--ping-engine")
}

/// How long the shell waits for the engine's first answer. A cold start of the frozen engine
/// (300 MB of libraries read from disk and scanned by the antivirus) was measured at 33 s, so any
/// request that may be the first one after launch gets this much room.
pub const FIRST_CONTACT_TIMEOUT: Duration = Duration::from_secs(180);

pub fn version_line() -> String {
    format!("mejores-tomas {}", env!("CARGO_PKG_VERSION"))
}

/// Starts the engine, asks it to ping, prints `engine-ok <version>`. Returns the process exit code.
pub fn ping_engine() -> i32 {
    let client = match EngineClient::spawn(|_, _| {}) {
        Ok(client) => client,
        Err(error) => {
            eprintln!("could not start the analysis engine: {error}");
            return 1;
        }
    };
    match client.request("ping", json!({}), FIRST_CONTACT_TIMEOUT) {
        Ok(value) => match value.get("version").and_then(Value::as_str) {
            Some(version) => {
                println!("engine-ok {version}");
                0
            }
            None => {
                eprintln!("the engine answered ping without a version");
                1
            }
        },
        Err(failure) => {
            eprintln!("the engine failed: {}", failure.message);
            1
        }
    }
}

struct EngineState(Mutex<Option<Arc<EngineClient>>>);

fn failure_text(failure: RpcFailure) -> String {
    json!({ "code": failure.code, "message": failure.message }).to_string()
}

fn client(app: &AppHandle, state: &EngineState) -> Result<Arc<EngineClient>, String> {
    let mut slot = state.0.lock().unwrap();
    if slot.is_none() {
        let handle = app.clone();
        let started = EngineClient::spawn(move |method, params| {
            let _ = handle.emit("engine-event", json!({ "method": method, "params": params }));
        })
        .map_err(|error| {
            json!({ "code": -32000, "message": format!("could not start the analysis engine: {error}") })
                .to_string()
        })?;
        *slot = Some(Arc::new(started));
    }
    Ok(Arc::clone(slot.as_ref().expect("engine client was just stored")))
}

#[tauri::command]
async fn engine_request(
    app: AppHandle,
    state: State<'_, EngineState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !is_forwardable(&method) {
        return Err(
            json!({ "code": -32601, "message": format!("method not allowed: {method}") }).to_string()
        );
    }
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        client
            .request(&method, params, Duration::from_secs(600))
            .map_err(failure_text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_folder(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<Option<String>, String> {
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|error| error.to_string())?;
        let text = path.to_string_lossy().to_string();
        client
            .request("grant_roots", json!({ "roots": [text.clone()] }), FIRST_CONTACT_TIMEOUT)
            .map_err(failure_text)?;
        Ok(Some(text))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_files(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<Option<Vec<String>>, String> {
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app.dialog().file().blocking_pick_files() else {
            return Ok(None);
        };
        let mut files = Vec::new();
        let mut folders: Vec<String> = Vec::new();
        for item in picked {
            let path = item.into_path().map_err(|error| error.to_string())?;
            if let Some(parent) = path.parent() {
                let parent = parent.to_string_lossy().to_string();
                if !folders.contains(&parent) {
                    folders.push(parent);
                }
            }
            files.push(path.to_string_lossy().to_string());
        }
        client
            .request("grant_roots", json!({ "roots": folders }), FIRST_CONTACT_TIMEOUT)
            .map_err(failure_text)?;
        Ok(Some(files))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_lut(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<Option<String>, String> {
    let client = client(&app, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("LUT 3D (.cube)", &["cube"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|error| error.to_string())?;
        let text = path.to_string_lossy().to_string();
        client
            .request("grant_roots", json!({ "roots": [text.clone()] }), FIRST_CONTACT_TIMEOUT)
            .map_err(failure_text)?;
        Ok(Some(text))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![engine_request, pick_folder, pick_files, pick_lut])
        .run(tauri::generate_context!())
        .expect("error while running Mejores Tomas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn the_version_flag_is_detected() {
        assert!(wants_version(&args(&["mejores-tomas", "--version"])));
    }

    #[test]
    fn near_misses_are_not_version_requests() {
        assert!(!wants_version(&args(&["mejores-tomas", "--versions"])));
        assert!(!wants_version(&args(&["mejores-tomas", "-v"])));
        assert!(!wants_version(&args(&["mejores-tomas"])));
    }

    #[test]
    fn the_ping_engine_flag_is_detected_only_when_exact() {
        assert!(wants_ping_engine(&args(&["mejores-tomas", "--ping-engine"])));
        assert!(!wants_ping_engine(&args(&["mejores-tomas", "--ping"])));
    }

    #[test]
    fn granting_a_folder_outlasts_a_cold_engine_start() {
        // 33 s measured on a cold start of the installed engine; the old 30 s limit failed there.
        assert!(FIRST_CONTACT_TIMEOUT >= Duration::from_secs(120));
    }

    #[test]
    fn the_version_line_names_the_product_and_the_cargo_version() {
        assert_eq!(version_line(), "mejores-tomas 0.1.0");
    }
}
