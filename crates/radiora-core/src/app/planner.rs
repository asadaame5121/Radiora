//! Pure planning: read state + command → the semantic change to apply, or a domain error.
//! No clock, randomness or I/O; IDs arrive already issued.

use super::command::DocumentCommand;
use super::port::BlockPresence;
use crate::model::BlockId;

/// The semantic change the document adapter applies. It is not a second source of truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentChange {
    CreateDocument { id: BlockId },
    SetBody { id: BlockId, body: String },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlanError {
    #[error("block {0} does not exist")]
    UnknownBlock(BlockId),
    /// The ID is in use, possibly by a deleted Block: logical IDs are never reused.
    #[error("block {0} already exists")]
    DuplicateBlock(BlockId),
    /// A reference item shows its target's body and has none of its own to edit.
    #[error("block {0} does not own a body")]
    NoBody(BlockId),
}

/// `presence` is the read state of `command.target()`.
pub fn plan(
    command: &DocumentCommand,
    presence: Option<BlockPresence>,
) -> Result<DocumentChange, PlanError> {
    match command {
        DocumentCommand::CreateDocument { id } => match presence {
            None => Ok(DocumentChange::CreateDocument { id: *id }),
            Some(_) => Err(PlanError::DuplicateBlock(*id)),
        },
        DocumentCommand::UpdateBody { id, body } => match presence {
            Some(BlockPresence::Live { owns_body: true }) => Ok(DocumentChange::SetBody {
                id: *id,
                body: body.clone(),
            }),
            Some(BlockPresence::Live { owns_body: false }) => Err(PlanError::NoBody(*id)),
            Some(BlockPresence::Retired) | None => Err(PlanError::UnknownBlock(*id)),
        },
    }
}
