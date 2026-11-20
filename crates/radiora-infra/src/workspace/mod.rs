//! Document adapter: the single workspace LoroDoc (the source of truth) and its SQLite
//! durability, implementing core's `DocumentStore` port (stage B body slice, #383/#385).
//!
//! The request/version protocol, the save phase and the domain checks live in
//! `radiora_core::app::DocumentCoordinator`. This adapter keeps one cooperative contract:
//! apply a planned change, export it and make it durable together with its receipt.
//! - success means the update and its receipt are durable (WAL, `synchronous=FULL`);
//! - when persistence fails the change stays applied and pending; only persistence is
//!   retried, never the Loro operation; the committed view refuses while pending;
//! - receipts store a SHA-256 digest of the request fingerprint.
//!
//! Undo, structure edits, trash and snapshot compaction are not wired yet.

mod error;
mod schema;
mod store;
#[cfg(test)]
mod tests;

pub use error::{Result, WorkspaceError};

use loro::{CommitOptions, ExportMode, LoroDoc, VersionVector};
use radiora_core::app::{
    ApplyFailure, BlockPresence, DocumentChange, DocumentStore, Fingerprint, Receipt, RequestId,
    StoreFailure, WorkspaceView,
};
use radiora_core::model::{BlockId, IdError};
use sha2::{Digest, Sha256};
use std::path::Path;
use store::Store;
use uuid::Uuid;

/// Commit origin of the body-slice changes; the shared UndoManager is not wired yet.
const COMMIT_ORIGIN: &str = "user:body-slice";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Clean,
    /// A change is applied in memory; the update after `saved` is not durable yet.
    Pending,
    /// A Loro operation failed part-way; only reopening restores a known state.
    Broken,
}

/// Synchronous owner of the document and its store. Wrap it in a `DocumentCoordinator`,
/// which serializes all writes as the single writer.
pub struct WorkspaceStore {
    doc: LoroDoc,
    store: Store,
    saved: VersionVector,
    version: u64,
    state: State,
}

/// Issues a new logical Block ID (UUIDv7).
pub fn issue_block_id() -> std::result::Result<BlockId, IdError> {
    BlockId::from_uuid(Uuid::now_v7())
}

impl WorkspaceStore {
    /// Opens the workspace at `path`, creating an empty one when the file is new or empty.
    pub fn open(path: &Path) -> Result<Self> {
        let (mut store, restored) = Store::open(path)?;
        let (doc, version) = match restored {
            Some(restored) => {
                let doc = LoroDoc::from_snapshot(&restored.snapshot)?;
                for update in &restored.updates {
                    if doc.import(update)?.pending.is_some() {
                        return Err(WorkspaceError::Corrupt(
                            "a stored update depends on missing changes".into(),
                        ));
                    }
                }
                schema::check(&doc)?;
                (doc, restored.version)
            }
            None => {
                let doc = LoroDoc::new();
                schema::initialize(&doc)?;
                store.initialize(&doc.export(ExportMode::Snapshot)?)?;
                (doc, 0)
            }
        };
        schema::prepare(&doc);
        let saved = doc.oplog_vv();
        Ok(Self {
            doc,
            store,
            saved,
            version,
            state: State::Clean,
        })
    }

    /// Validates against the document before mutating it, then applies `change`.
    fn apply_change(&mut self, change: &DocumentChange) -> std::result::Result<(), ApplyFailure> {
        let not_applied =
            |error: WorkspaceError| ApplyFailure::NotApplied(StoreFailure::new(error));
        let tree = schema::tree(&self.doc);
        let result = match change {
            DocumentChange::CreateDocument { id } => {
                if schema::find(&tree, *id, true)
                    .map_err(not_applied)?
                    .is_some()
                {
                    return Err(not_applied(WorkspaceError::DuplicateBlock(*id)));
                }
                self.state = State::Broken;
                schema::create_document(&self.doc, *id)
            }
            DocumentChange::SetBody { id, body } => {
                let node = schema::find(&tree, *id, false)
                    .map_err(not_applied)?
                    .ok_or_else(|| not_applied(WorkspaceError::UnknownBlock(*id)))?;
                let text = schema::body(&tree, node).map_err(not_applied)?;
                self.state = State::Broken;
                text.update(body, Default::default()).map_err(Into::into)
            }
        };
        if let Err(error) = result {
            tracing::error!(%error, "a document change failed part-way; reopen the workspace");
            return Err(ApplyFailure::Partial(StoreFailure::new(error)));
        }
        self.doc
            .commit_with(CommitOptions::new().origin(COMMIT_ORIGIN));
        self.state = State::Pending;
        Ok(())
    }

    /// Writes the pending update (if the change altered the document) with its receipt.
    fn persist(&mut self, request: RequestId, fingerprint: &Fingerprint) -> Result<u64> {
        let current = self.doc.oplog_vv();
        let update = if current == self.saved {
            None
        } else {
            Some(self.doc.export(ExportMode::updates(&self.saved))?)
        };
        let version = self
            .store
            .append(update.as_deref(), request.as_uuid(), &digest(fingerprint), self.version)
            .inspect_err(|error| {
                tracing::warn!(%request, durable_version = self.version, %error, "persisting an applied change failed; it stays pending");
            })?;
        self.settle(current, version);
        Ok(version)
    }

    fn settle(&mut self, current: VersionVector, version: u64) {
        self.saved = current;
        self.version = version;
        self.state = State::Clean;
    }

    fn require(&self, expected: State) -> Result<()> {
        match (self.state, expected) {
            (actual, expected) if actual == expected => Ok(()),
            (State::Broken, _) => Err(WorkspaceError::Broken),
            (State::Pending, _) => Err(WorkspaceError::PendingChange),
            (State::Clean, _) => Err(WorkspaceError::NothingPending),
        }
    }
}

impl DocumentStore for WorkspaceStore {
    fn durable_version(&self) -> u64 {
        self.version
    }

    fn receipt(
        &self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> std::result::Result<Option<Receipt>, StoreFailure> {
        let applied = self
            .store
            .applied_request(request.as_uuid())
            .map_err(StoreFailure::new)?;
        Ok(applied.map(|applied| Receipt {
            matches: applied.digest == digest(fingerprint),
            version: applied.version,
        }))
    }

    fn presence(&self, id: BlockId) -> std::result::Result<Option<BlockPresence>, StoreFailure> {
        let tree = schema::tree(&self.doc);
        if let Some(node) = schema::find(&tree, id, false).map_err(StoreFailure::new)? {
            let owns_body = schema::owns_body(&tree, node).map_err(StoreFailure::new)?;
            return Ok(Some(BlockPresence::Live { owns_body }));
        }
        let retired = schema::find(&tree, id, true).map_err(StoreFailure::new)?;
        Ok(retired.map(|_| BlockPresence::Retired))
    }

    fn apply(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
        change: &DocumentChange,
    ) -> std::result::Result<u64, ApplyFailure> {
        self.require(State::Clean)
            .map_err(|error| ApplyFailure::NotApplied(StoreFailure::new(error)))?;
        self.apply_change(change)?;
        self.persist(request, fingerprint)
            .map_err(|error| ApplyFailure::NotDurable(StoreFailure::new(error)))
    }

    fn persist_pending(
        &mut self,
        request: RequestId,
        fingerprint: &Fingerprint,
    ) -> std::result::Result<u64, StoreFailure> {
        self.require(State::Pending).map_err(StoreFailure::new)?;
        self.persist(request, fingerprint)
            .map_err(StoreFailure::new)
    }

    fn acknowledge_durable(&mut self, version: u64) -> std::result::Result<(), StoreFailure> {
        self.require(State::Pending).map_err(StoreFailure::new)?;
        tracing::info!(version, "settled a pending change from its durable receipt");
        let current = self.doc.oplog_vv();
        self.settle(current, version);
        Ok(())
    }

    fn committed_view(&self) -> std::result::Result<WorkspaceView, StoreFailure> {
        self.require(State::Clean).map_err(StoreFailure::new)?;
        schema::view(&self.doc, self.version).map_err(StoreFailure::new)
    }
}

fn digest(fingerprint: &Fingerprint) -> Vec<u8> {
    Sha256::digest(fingerprint.as_bytes()).to_vec()
}
