//! Tauri host and composition root.
//!
//! Stage A (mock shell): the window loads the Vite dev server started with
//! `vite --mode mock`, whose middleware answers the existing UI's `/api/*` calls.
//! No Tauri command, storage adapter or product feature is connected yet, so the
//! host registers no invoke handler and the window needs no capability.

use tracing_subscriber::EnvFilter;

/// Builds and runs the desktop application until its last window closes.
///
/// # Errors
///
/// Returns the Tauri error when the runtime or the main window cannot start.
pub fn run() -> Result<(), tauri::Error> {
    init_tracing();
    tracing::info!("starting the Radiora v3 desktop host");
    tauri::Builder::default().run(tauri::generate_context!())
}

/// Installs the process-wide subscriber; `RUST_LOG` overrides the default level.
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    // A subscriber may already be installed by an embedding test harness; keep it.
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
