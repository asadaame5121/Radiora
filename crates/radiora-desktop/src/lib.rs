//! Tauri host and composition root: tracing, the workspace host, the commands and the main
//! window. Wiring only; the request protocol lives in `radiora_core::app`.
//!
//! The main window still loads the stage A mock shell (the Vite dev server started with
//! `vite --mode mock`). The saved read model is served by `read_saved_workspace` (#403); the
//! v3 adapter and screen that call it follow in a later PR.
//!
//! The workspace opens from `RADIORA_V3_DATA_DIR` when set, otherwise from the app-local data
//! directory (`%LOCALAPPDATA%\dev.radiora.v3` on Windows). It never touches v2 data.

#[cfg(test)]
mod command_names;
mod commands;
mod dto;
mod host;

use host::{Unavailable, WorkspaceHost};
use std::path::PathBuf;
use tauri::{App, Manager};
use tracing_subscriber::EnvFilter;

const DATA_DIR_ENV: &str = "RADIORA_V3_DATA_DIR";

/// Builds and runs the desktop application until its last window closes.
///
/// # Errors
///
/// Returns the Tauri error when the runtime or the main window cannot start.
pub fn run() -> Result<(), tauri::Error> {
    init_tracing();
    tracing::info!("starting the Radiora v3 desktop host");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::read_saved_workspace,])
        .setup(|app| {
            let host = open_workspace(app);
            app.manage(host);
            Ok(())
        })
        .run(tauri::generate_context!())
}

fn open_workspace(app: &App) -> WorkspaceHost {
    let data_dir = match std::env::var_os(DATA_DIR_ENV) {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => app.path().app_local_data_dir(),
    };
    match data_dir {
        Ok(dir) => WorkspaceHost::open(&dir),
        Err(error) => {
            tracing::error!(%error, "could not resolve the data directory");
            WorkspaceHost::unavailable(Unavailable::DataDirectory, None)
        }
    }
}

/// Default filter: Radiora at info; Loro's per-export encoding logs (enabled by its `logging`
/// feature) only from warn.
const DEFAULT_LOG_FILTER: &str = "info,loro=warn,loro_internal=warn";

/// Installs the process-wide subscriber; `RUST_LOG` overrides the default filter.
fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));
    // A subscriber may already be installed by an embedding test harness; keep it.
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

#[cfg(test)]
mod tests {
    use super::command_names::COMMANDS;

    #[test]
    fn the_invoke_handler_registers_exactly_the_listed_commands() {
        let source = include_str!("lib.rs");
        let start = source.find("generate_handler![").expect("invoke handler");
        let handler = &source[start..start + source[start..].find(']').expect("handler end")];
        let registered: Vec<&str> = handler
            .split("commands::")
            .skip(1)
            .map(|rest| rest.split(',').next().unwrap_or_default().trim())
            .collect();
        assert_eq!(registered, COMMANDS);
    }

    /// The main window may call the listed commands and nothing else.
    #[test]
    fn the_capability_allows_only_the_listed_commands() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).expect("capability");
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        let expected: Vec<String> = COMMANDS
            .iter()
            .map(|name| format!("allow-{}", name.replace('_', "-")))
            .collect();
        assert_eq!(capability["permissions"], serde_json::json!(expected));
    }
}
