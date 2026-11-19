//! The document-storage port owned by core and implemented by the infra document adapter.
//!
//! Applying a change, exporting it and making it durable together with the request receipt
//! is one cooperative contract of the adapter; it is not split into independent CRUD calls.

use super::command::{Fingerprint, RequestId};
use super::planner::DocumentChange;
use super::view::WorkspaceView;
use crate::model::BlockId;
use std::error::Error;
use std::fmt;

/// Read state of one logical ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockPresence {
    /// A live Block; `owns_body` is false for a reference item.
    Live { owns_body: bool },
    /// Known only in a deleted state. The ID stays taken.
    Retired,
}

/// The durable record of an earlier request with the same ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Receipt {
    /// Whether the recorded request had the same fingerprint.
    pub matches: bool,
    pub version: u64,
}

/// A storage failure, carried with its cause. Its text never contains document content.
#[derive(Debug)]
pub struct StoreFailure(Box<dyn Error + Send + Sync + 'static>);

impl StoreFailure {
    pub fn new(cause: impl Error + Send + Sync + 'static) -> Self {
        Self(Box::new(cause))
    }
}

impl fmt::Display for StoreFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl Error for StoreFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(self.0.as_ref())
    }
}

/// How far an `apply` got before failing.
#[derive(Debug, thiserror::Error)]
pub enum ApplyFailure {
    /// Nothing changed, in memory or on disk.
    #[error("the change was not applied: {0}")]
    NotApplied(#[source] StoreFailure),
    /// The in-memory document may hold part of the change; only reopening restores a known state.
    #[error("the change was applied part-way: {0}")]
    Partial(#[source] StoreFailure),
    /// Fully applied in memory but not durable; it stays pending for `persist_pending`.
    #[error("the applied change is not durable: {0}")]
    NotDurable(#[source] StoreFailure),
}

pub trait DocumentStore {
    /// The version of the last durable change (`0` for an empty workspace).
    fn durable_version(&self) -> u64;

    /// Looks up the receipt recorded for `request`, comparing its fingerprint.
    fn receipt(
        &self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> Result<Option<Receipt>, StoreFailure>;

    /// Read state of a logical ID, including Blocks known only in a deleted state.
    fn presence(&self, id: BlockId) -> Result<Option<BlockPresence>, StoreFailure>;

    /// Applies the planned change and makes it durable together with the request receipt.
    /// Returns the new durable version (unchanged when the change was a no-op).
    fn apply(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
        change: &DocumentChange,
    ) -> Result<u64, ApplyFailure>;

    /// Makes the pending change (left by `ApplyFailure::NotDurable`) durable with its receipt.
    /// Never reapplies the change.
    fn persist_pending(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> Result<u64, StoreFailure>;

    /// Marks the pending change durable at `version`, after its receipt proved that an
    /// earlier attempt committed although its result was lost.
    fn acknowledge_durable(&mut self, version: u64) -> Result<(), StoreFailure>;

    /// The committed read model. Must not include a pending change.
    fn committed_view(&self) -> Result<WorkspaceView, StoreFailure>;
}
