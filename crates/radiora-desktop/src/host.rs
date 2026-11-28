//! Opens the workspace for this process and shares its single writer with the commands.
//!
//! One process owns a workspace: an exclusive lock on `workspace.lock` next to the database
//! refuses a second instance before it opens SQLite. When the workspace cannot be opened the
//! app still starts and every command reports why. Paths stay in the logs.

use crate::dto::{ErrorDto, ErrorKind};
use radiora_core::app::{DocumentCoordinator, DocumentStore};
use radiora_infra::workspace::{WorkspaceError, WorkspaceStore};
use std::fs::{self, File, TryLockError};
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError as MutexTryLockError};

pub const DATABASE_FILE: &str = "workspace.db";
const LOCK_FILE: &str = "workspace.lock";

pub type Coordinator = DocumentCoordinator<WorkspaceStore>;

/// Why the workspace is not available.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unavailable {
    DataDirectory,
    AlreadyRunning,
    Incompatible,
    Unreadable,
}

impl Unavailable {
    fn message(self) -> &'static str {
        match self {
            Self::DataDirectory => "データの保存先を用意できませんでした。",
            Self::AlreadyRunning => "別のRadiora v3がこのワークスペースを開いています。",
            Self::Incompatible => {
                "このワークスペースは対応していない形式です（開発版データは互換を保証しません）。"
            }
            Self::Unreadable => "ワークスペースを開けませんでした。",
        }
    }
}

/// Tauri managed state. The lock file stays open (and locked) for the process lifetime.
pub struct WorkspaceHost {
    coordinator: Result<Arc<Mutex<Coordinator>>, Unavailable>,
    _lock: Option<File>,
}

impl WorkspaceHost {
    /// Opens (or creates) the workspace in `data_dir`.
    pub fn open(data_dir: &Path) -> Self {
        if let Err(error) = fs::create_dir_all(data_dir) {
            tracing::error!(%error, "could not create the data directory");
            return Self::unavailable(Unavailable::DataDirectory, None);
        }
        let lock = match lock(&data_dir.join(LOCK_FILE)) {
            Ok(lock) => lock,
            Err(reason) => return Self::unavailable(reason, None),
        };
        match WorkspaceStore::open(&data_dir.join(DATABASE_FILE)) {
            Ok(store) => {
                tracing::info!(version = store.durable_version(), "workspace opened");
                Self {
                    coordinator: Ok(Arc::new(Mutex::new(DocumentCoordinator::new(store)))),
                    _lock: Some(lock),
                }
            }
            Err(error) => {
                tracing::error!(%error, "could not open the workspace");
                let reason = match error {
                    WorkspaceError::SchemaMismatch { .. } | WorkspaceError::NotWorkspace(_) => {
                        Unavailable::Incompatible
                    }
                    _ => Unavailable::Unreadable,
                };
                Self::unavailable(reason, Some(lock))
            }
        }
    }

    pub fn unavailable(reason: Unavailable, lock: Option<File>) -> Self {
        Self {
            coordinator: Err(reason),
            _lock: lock,
        }
    }

    /// A handle to the single writer, for use on a blocking thread.
    pub fn coordinator(&self) -> Result<Arc<Mutex<Coordinator>>, ErrorDto> {
        self.coordinator
            .clone()
            .map_err(|reason| ErrorDto::new(ErrorKind::WorkspaceUnavailable, reason.message()))
    }
}

/// Takes the coordinator for a read without waiting: while a write holds it the read is
/// refused as `busy`, so no read queues behind a save. A poisoned lock means a command
/// panicked mid-change.
pub fn reader(handle: &Mutex<Coordinator>) -> Result<MutexGuard<'_, Coordinator>, ErrorDto> {
    handle.try_lock().map_err(|error| match error {
        MutexTryLockError::WouldBlock => ErrorDto::busy(),
        MutexTryLockError::Poisoned(_) => {
            tracing::error!("the workspace writer was poisoned by a panic");
            ErrorDto::new(
                ErrorKind::RecoveryRequired,
                "内部エラーのため、アプリを再起動してください。",
            )
        }
    })
}

fn lock(path: &Path) -> Result<File, Unavailable> {
    let file = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(|error| {
            tracing::error!(%error, "could not open the workspace lock file");
            Unavailable::DataDirectory
        })?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => {
            tracing::warn!("another process holds the workspace lock");
            Err(Unavailable::AlreadyRunning)
        }
        Err(TryLockError::Error(error)) => {
            tracing::error!(%error, "could not lock the workspace");
            Err(Unavailable::DataDirectory)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_host_on_the_same_directory_is_refused() {
        let dir = tempfile::tempdir().expect("temporary directory");
        let first = WorkspaceHost::open(dir.path());
        assert!(first.coordinator().is_ok());
        let second = WorkspaceHost::open(dir.path());
        let error = second.coordinator().err().expect("refused");
        assert_eq!(error.kind, ErrorKind::WorkspaceUnavailable);
        assert!(!error.message.contains(&dir.path().display().to_string()));
        drop(first);
        assert!(WorkspaceHost::open(dir.path()).coordinator().is_ok());
    }

    #[test]
    fn an_incompatible_database_leaves_the_host_unavailable() {
        let dir = tempfile::tempdir().expect("temporary directory");
        fs::write(dir.path().join(DATABASE_FILE), b"not a database").expect("write");
        let host = WorkspaceHost::open(dir.path());
        let error = host.coordinator().err().expect("unavailable");
        assert_eq!(error.kind, ErrorKind::WorkspaceUnavailable);
    }
}
