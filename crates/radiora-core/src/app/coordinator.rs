//! Application coordinator: the single writer of the workspace document. It owns the
//! request/version protocol and the save phase, plans with pure rules, and drives the
//! document port. Success is returned only after the change is durable.

use super::command::{Fingerprint, Request, RequestId};
use super::planner::{PlanError, plan};
use super::port::{ApplyFailure, DocumentStore, StoreFailure};
use super::view::WorkspaceView;

/// Result of a mutation request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Saved {
    /// The durable version after the request.
    pub version: u64,
    /// `true` when the request had already been made durable and this is its recorded result.
    pub replayed: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error(transparent)]
    Plan(#[from] PlanError),
    #[error("the workspace changed since version {base} (now {current})")]
    StaleVersion { base: u64, current: u64 },
    #[error("request {0} was already used for a different operation")]
    RequestReused(RequestId),
    #[error("an applied change awaits persistence; retry it first")]
    PersistPending,
    #[error("the workspace needs to be reopened after an incomplete change")]
    RecoveryRequired,
    #[error("no applied change awaits persistence")]
    NothingToRetry,
    /// The change is applied but not durable; the coordinator is now dirty.
    #[error("persisting the applied change failed; retry before other operations: {0}")]
    Persist(#[source] StoreFailure),
    /// A read or a refused write failed; nothing changed.
    #[error("workspace storage failed: {0}")]
    Store(#[source] StoreFailure),
}

/// Save phase. Only `Ready` publishes reads and accepts new requests.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Phase {
    Ready,
    /// Applied in memory, not durable yet.
    Dirty {
        request: RequestId,
        fingerprint: Fingerprint,
    },
    /// The document may hold part of a change; reopen to recover.
    RecoveryRequired,
}

pub struct DocumentCoordinator<S> {
    store: S,
    phase: Phase,
}

impl<S: DocumentStore> DocumentCoordinator<S> {
    /// Takes ownership of an opened store; a freshly opened store has nothing pending.
    pub fn new(store: S) -> Self {
        Self {
            store,
            phase: Phase::Ready,
        }
    }

    /// The last durable version.
    pub fn version(&self) -> u64 {
        self.store.durable_version()
    }

    /// `true` while an applied change awaits `retry`.
    pub fn is_dirty(&self) -> bool {
        matches!(self.phase, Phase::Dirty { .. })
    }

    /// The committed read model; refused unless `Ready`, so unsaved values are never published.
    pub fn view(&self) -> Result<WorkspaceView, CommandError> {
        self.ensure_ready()?;
        self.store.committed_view().map_err(CommandError::Store)
    }

    pub fn execute(&mut self, request: Request) -> Result<Saved, CommandError> {
        let fingerprint = request.fingerprint();
        match &self.phase {
            Phase::Ready => {}
            Phase::Dirty {
                request: pending,
                fingerprint: pending_fingerprint,
            } if *pending == request.id => {
                if *pending_fingerprint != fingerprint {
                    return Err(CommandError::RequestReused(request.id));
                }
                return self.retry();
            }
            Phase::Dirty { .. } => return Err(CommandError::PersistPending),
            Phase::RecoveryRequired => return Err(CommandError::RecoveryRequired),
        }
        if let Some(receipt) = self
            .store
            .receipt(request.id, &fingerprint)
            .map_err(CommandError::Store)?
        {
            if !receipt.matches {
                return Err(CommandError::RequestReused(request.id));
            }
            return Ok(Saved {
                version: receipt.version,
                replayed: true,
            });
        }
        let current = self.store.durable_version();
        if request.base != current {
            return Err(CommandError::StaleVersion {
                base: request.base,
                current,
            });
        }
        let presence = self
            .store
            .presence(request.command.target())
            .map_err(CommandError::Store)?;
        let change = plan(&request.command, presence)?;
        match self.store.apply(request.id, &fingerprint, &change) {
            Ok(version) => Ok(Saved {
                version,
                replayed: false,
            }),
            Err(ApplyFailure::NotApplied(failure)) => Err(CommandError::Store(failure)),
            Err(ApplyFailure::Partial(failure)) => {
                self.phase = Phase::RecoveryRequired;
                Err(CommandError::Store(failure))
            }
            Err(ApplyFailure::NotDurable(failure)) => {
                self.phase = Phase::Dirty {
                    request: request.id,
                    fingerprint,
                };
                Err(CommandError::Persist(failure))
            }
        }
    }

    /// Persists the pending change, or settles it from its receipt when an earlier attempt
    /// committed although its result was lost. Never reapplies the change.
    pub fn retry(&mut self) -> Result<Saved, CommandError> {
        let Phase::Dirty {
            request,
            fingerprint,
        } = self.phase.clone()
        else {
            return Err(CommandError::NothingToRetry);
        };
        let receipt = self
            .store
            .receipt(request, &fingerprint)
            .map_err(CommandError::Persist)?;
        let saved = match receipt {
            Some(receipt) if receipt.matches => {
                self.store
                    .acknowledge_durable(receipt.version)
                    .map_err(CommandError::Persist)?;
                Saved {
                    version: receipt.version,
                    replayed: true,
                }
            }
            // A receipt for another operation under the pending ID cannot be settled safely.
            Some(_) => {
                self.phase = Phase::RecoveryRequired;
                return Err(CommandError::RequestReused(request));
            }
            None => Saved {
                version: self
                    .store
                    .persist_pending(request, &fingerprint)
                    .map_err(CommandError::Persist)?,
                replayed: false,
            },
        };
        self.phase = Phase::Ready;
        Ok(saved)
    }

    fn ensure_ready(&self) -> Result<(), CommandError> {
        match self.phase {
            Phase::Ready => Ok(()),
            Phase::Dirty { .. } => Err(CommandError::PersistPending),
            Phase::RecoveryRequired => Err(CommandError::RecoveryRequired),
        }
    }
}
