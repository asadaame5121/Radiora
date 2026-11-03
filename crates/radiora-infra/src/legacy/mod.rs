//! Read-only v2 input and verified staging archive. No Loro conversion or final publish.
mod archive;
mod source;
pub use archive::{ArchiveReport, archive_legacy};
use radiora_core::legacy::RecordError;
pub use source::{
    ArchiveRow, FileFingerprint, LegacyRecord, LegacySource, SourceFingerprint, TableDigest,
    fingerprint, read_legacy,
};
use std::{io, time::SystemTimeError};

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("legacy import I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("legacy SQLite failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Record(#[from] RecordError),
    #[error("legacy archive JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("legacy input rejected: {0}")]
    Rejected(String),
    #[error("source changed during legacy import")]
    SourceChanged,
    #[error("clock is before Unix epoch: {0}")]
    Clock(#[from] SystemTimeError),
}
pub type Result<T> = std::result::Result<T, ImportError>;
