//! Trash entries: what one ordinary delete moved to the trash, where it came from, and the pure
//! decisions for restore and purge.
use super::block::Presence;
use super::id::{BlockId, TrashEntryId};
use std::collections::BTreeSet;

/// Where the deleted subtree root stood before the delete.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginalPlacement {
    DocumentRoot,
    Child {
        parent: BlockId,
        /// Sibling right before the deleted root; `None` means it was the first child.
        previous_sibling: Option<BlockId>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TrashEntryError {
    #[error("trash entry {entry} does not contain its own root {root}")]
    RootNotDeleted { entry: TrashEntryId, root: BlockId },
}

/// One ordinary-delete operation. `newly_deleted` holds only the Blocks this operation moved to
/// the trash; descendants trashed earlier belong to their own entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashEntry {
    id: TrashEntryId,
    root: BlockId,
    placement: OriginalPlacement,
    newly_deleted: BTreeSet<BlockId>,
}

impl TrashEntry {
    pub fn new(
        id: TrashEntryId,
        root: BlockId,
        placement: OriginalPlacement,
        newly_deleted: BTreeSet<BlockId>,
    ) -> Result<Self, TrashEntryError> {
        if !newly_deleted.contains(&root) {
            return Err(TrashEntryError::RootNotDeleted { entry: id, root });
        }
        Ok(Self {
            id,
            root,
            placement,
            newly_deleted,
        })
    }

    pub fn id(&self) -> TrashEntryId {
        self.id
    }

    pub fn root(&self) -> BlockId {
        self.root
    }

    pub fn placement(&self) -> OriginalPlacement {
        self.placement
    }

    /// Exactly the Blocks that restoring this entry makes live again.
    pub fn newly_deleted(&self) -> &BTreeSet<BlockId> {
        &self.newly_deleted
    }
}

/// Members of the subtree being deleted that are still live. Reference items elsewhere that
/// point into the subtree are not members and are never included.
pub fn collect_newly_deleted(
    subtree: impl IntoIterator<Item = (BlockId, Presence)>,
) -> BTreeSet<BlockId> {
    subtree
        .into_iter()
        .filter(|(_, presence)| *presence == Presence::Live)
        .map(|(id, _)| id)
        .collect()
}

/// Blocks a purge of the selected entries removes: the union of their own sets, without
/// following the original hierarchy into other entries. "Empty trash" selects every entry.
pub fn purge_targets<'a>(selected: impl IntoIterator<Item = &'a TrashEntry>) -> BTreeSet<BlockId> {
    selected
        .into_iter()
        .flat_map(|entry| entry.newly_deleted.iter().copied())
        .collect()
}

/// Current state of the original location, observed by the caller from the workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlacementObservation {
    /// The original parent exists and is live.
    pub parent_live: bool,
    /// The previous sibling is live and still a child of the original parent.
    pub anchor_in_place: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestorePlan {
    AtOriginalPosition {
        parent: BlockId,
        after: Option<BlockId>,
    },
    AtEndOfParent {
        parent: BlockId,
    },
    /// The parent is unusable (trashed, purged, missing). Restoring as a separate document keeps
    /// IDs, bodies and children, but needs the user's confirmation; the parent is never restored
    /// implicitly and the subtree is never attached to an unrelated parent.
    AsNewDocumentAfterConfirmation,
    AsDocumentRoot,
}

/// Trash restore is a new operation. It does not replace shared-history Undo, which restores the
/// exact previous position.
pub fn plan_restore(placement: OriginalPlacement, observed: PlacementObservation) -> RestorePlan {
    match placement {
        OriginalPlacement::DocumentRoot => RestorePlan::AsDocumentRoot,
        OriginalPlacement::Child { .. } if !observed.parent_live => {
            RestorePlan::AsNewDocumentAfterConfirmation
        }
        OriginalPlacement::Child {
            parent,
            previous_sibling: None,
        } => RestorePlan::AtOriginalPosition {
            parent,
            after: None,
        },
        OriginalPlacement::Child {
            parent,
            previous_sibling: Some(anchor),
        } if observed.anchor_in_place => RestorePlan::AtOriginalPosition {
            parent,
            after: Some(anchor),
        },
        OriginalPlacement::Child { parent, .. } => RestorePlan::AtEndOfParent { parent },
    }
}
