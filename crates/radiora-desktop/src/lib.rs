//! Tauri host and composition root: tracing, the workspace host, the commands and the main
//! window. Wiring only; the request protocol lives in `radiora_core::app`.
//!
//! The main window shows the v3 body-slice page (`v3.html`). Development aids, read from the
//! environment: `RADIORA_V3_PAGE=mock-shell` shows the existing UI on the Vite mock server
//! (stage A) without opening any workspace, and `RADIORA_V3_DATA_DIR` overrides the data
//! directory (default: the app-local data directory, `%LOCALAPPDATA%\dev.radiora.v3`).

#[cfg(test)]
mod command_names;
mod commands;
mod dto;
mod host;

use host::{Unavailable, WorkspaceHost};
use std::path::PathBuf;
use tauri::{App, Manager, WebviewUrl, WebviewWindowBuilder};
use tracing_subscriber::EnvFilter;

const PAGE_ENV: &str = "RADIORA_V3_PAGE";
const DATA_DIR_ENV: &str = "RADIORA_V3_DATA_DIR";
const MOCK_SHELL: &str = "mock-shell";

/// Builds and runs the desktop application until its last window closes.
///
/// # Errors
///
/// Returns the Tauri error when the runtime or the main window cannot start.
pub fn run() -> Result<(), tauri::Error> {
    init_tracing();
    tracing::info!("starting the Radiora v3 desktop host");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::workspace_view,
            commands::new_block_id,
            commands::create_document,
            commands::update_body,
            commands::retry_save,
        ])
        .setup(|app| {
            let mock_shell = std::env::var(PAGE_ENV).is_ok_and(|page| page == MOCK_SHELL);
            let host = if mock_shell {
                WorkspaceHost::unavailable(Unavailable::DataDirectory, None)
            } else {
                open_workspace(app)
            };
            app.manage(host);
            open_main_window(app, mock_shell)?;
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

fn open_main_window(app: &App, mock_shell: bool) -> tauri::Result<()> {
    let (page, title) = if mock_shell {
        ("index.html", "Radiora v3 (mock shell)")
    } else {
        ("v3.html", "Radiora v3")
    };
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 480.0)
        .build()?;
    Ok(())
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
    #[test]
    fn the_invoke_handler_and_the_manifest_list_the_same_commands() {
        let source = include_str!("lib.rs");
        let start = source.find("generate_handler![").expect("invoke handler");
        let handler = &source[start..start + source[start..].find(']').expect("handler end")];
        let registered: Vec<&str> = handler
            .split("commands::")
            .skip(1)
            .map(|rest| rest.split(',').next().unwrap_or_default().trim())
            .collect();
        assert_eq!(registered, super::command_names::COMMANDS);
    }
}
