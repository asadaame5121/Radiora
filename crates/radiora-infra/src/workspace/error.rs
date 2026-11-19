use radiora_core::model::{BlockId, IdError};

/// Failures of the document adapter and its durable store. Request/version protocol errors
/// belong to `radiora_core::app::CommandError`; this type reaches callers wrapped in a
/// `StoreFailure`, or directly from `WorkspaceStore::open`.
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("workspace SQLite failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("workspace document failed: {0}")]
    Loro(#[from] loro::LoroError),
    #[error("workspace document export failed: {0}")]
    Export(#[from] loro::LoroEncodeError),
    #[error("body update failed: {0}")]
    TextUpdate(#[from] loro::UpdateTimeoutError),
    #[error("workspace schema {found} is not supported (expected {expected})")]
    SchemaMismatch { found: String, expected: i64 },
    #[error("not a Radiora v3 workspace database: {0}")]
    NotWorkspace(String),
    #[error("workspace data is inconsistent: {0}")]
    Corrupt(String),
    #[error("SQLite did not apply the required durability settings ({0})")]
    NotDurable(String),
    #[error(transparent)]
    Id(#[from] IdError),
    #[error("a change awaits persistence")]
    PendingChange,
    #[error("no change awaits persistence")]
    NothingPending,
    #[error("the workspace needs to be reopened after an incomplete change")]
    Broken,
    #[error("block {0} does not exist")]
    UnknownBlock(BlockId),
    #[error("block {0} already exists")]
    DuplicateBlock(BlockId),
}

pub type Result<T> = std::result::Result<T, WorkspaceError>;
