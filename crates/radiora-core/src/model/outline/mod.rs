//! Workspace structure: document roots, ordered children, and detached trash subtrees.
//!
//! A Topic is a parentless Block and its descendants. Membership is derived from the parent
//! chain, never stored. An ordinary delete detaches the subtree from the live tree and keeps its
//! internal hierarchy under a trash entry; Blocks trashed earlier were already detached, so each
//! trash entry owns exactly the subtree it detached.
//!
//! Every edit validates before mutating: a rejected edit leaves the outline unchanged.
mod edit;
mod lifecycle;

use super::block::Presence;
use super::id::{BlockId, TrashEntryId};
use super::trash::{TrashEntry, TrashEntryError};
use std::collections::{BTreeMap, BTreeSet};

/// Where a Block hangs in the structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    DocumentRoot,
    Child {
        parent: BlockId,
    },
    /// Root of a subtree moved to the trash by one delete operation.
    TrashRoot {
        entry: TrashEntryId,
    },
}

/// The document a Block belongs to, or the trash entry holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Membership {
    Topic { root: BlockId },
    Trash { entry: TrashEntryId },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StructureError {
    #[error("block {id} is not in the outline")]
    UnknownBlock { id: BlockId },
    #[error("block ID {id} was already issued in this workspace")]
    AlreadyIssued { id: BlockId },
    #[error("block {id} is in the trash; restore it before editing")]
    InTrash { id: BlockId },
    #[error("block {id} is a document root; demoting roots is out of first-release scope")]
    IsDocumentRoot { id: BlockId },
    #[error("block {id} is not a document root")]
    NotDocumentRoot { id: BlockId },
    #[error("block {id} has no previous sibling to indent under")]
    NoPreviousSibling { id: BlockId },
    #[error("block {id} is a direct child of a document root; outdent would cross the boundary")]
    ParentIsDocumentRoot { id: BlockId },
    #[error("cannot move {moved} into its own subtree at {target}")]
    IntoOwnSubtree { moved: BlockId, target: BlockId },
    #[error("index {index} is out of range for {len} children of {parent}")]
    IndexOutOfRange {
        parent: BlockId,
        index: usize,
        len: usize,
    },
    #[error("issued IDs for a copy are not distinct")]
    DuplicateIssuedIds,
    #[error("trash entry {entry} does not exist")]
    UnknownTrashEntry { entry: TrashEntryId },
    #[error("trash entry ID {entry} is already used")]
    TrashEntryExists { entry: TrashEntryId },
    #[error("restoring trash entry {entry} as a separate document needs confirmation")]
    NeedsConfirmation { entry: TrashEntryId },
    #[error(transparent)]
    TrashEntry(#[from] TrashEntryError),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("outline invariant violated: {0}")]
pub struct InvariantViolation(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Outline {
    slots: BTreeMap<BlockId, Slot>,
    /// One entry per Block in `slots`, possibly empty.
    children: BTreeMap<BlockId, Vec<BlockId>>,
    /// Live document roots. Their relative order is not a product decision yet.
    documents: Vec<BlockId>,
    trash: BTreeMap<TrashEntryId, TrashEntry>,
    /// Purged IDs. They are never issued again.
    retired: BTreeSet<BlockId>,
}

impl Outline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn documents(&self) -> &[BlockId] {
        &self.documents
    }

    pub fn slot(&self, id: BlockId) -> Option<Slot> {
        self.slots.get(&id).copied()
    }

    /// Ordered children; empty for leaves and unknown IDs.
    pub fn children(&self, id: BlockId) -> &[BlockId] {
        self.children.get(&id).map_or(&[], Vec::as_slice)
    }

    pub fn contains(&self, id: BlockId) -> bool {
        self.slots.contains_key(&id)
    }

    pub fn is_retired(&self, id: BlockId) -> bool {
        self.retired.contains(&id)
    }

    pub fn block_ids(&self) -> impl Iterator<Item = BlockId> + '_ {
        self.slots.keys().copied()
    }

    pub fn membership(&self, id: BlockId) -> Option<Membership> {
        let mut current = id;
        for _ in 0..=self.slots.len() {
            match self.slots.get(&current)? {
                Slot::DocumentRoot => return Some(Membership::Topic { root: current }),
                Slot::TrashRoot { entry } => return Some(Membership::Trash { entry: *entry }),
                Slot::Child { parent } => current = *parent,
            }
        }
        None
    }

    /// Presence derived from the structure; the outline is its single owner.
    pub fn presence(&self, id: BlockId) -> Option<Presence> {
        self.membership(id).map(|membership| match membership {
            Membership::Topic { .. } => Presence::Live,
            Membership::Trash { entry } => Presence::Trashed(entry),
        })
    }

    /// Pre-order list of `id` and its descendants; empty for unknown IDs.
    pub fn subtree(&self, id: BlockId) -> Vec<BlockId> {
        if !self.contains(id) {
            return Vec::new();
        }
        let mut order = Vec::new();
        let mut stack = vec![id];
        while let Some(current) = stack.pop() {
            order.push(current);
            stack.extend(self.children(current).iter().rev().copied());
        }
        order
    }

    pub fn trash_entry(&self, entry: TrashEntryId) -> Option<&TrashEntry> {
        self.trash.get(&entry)
    }

    pub fn trash_entries(&self) -> impl Iterator<Item = &TrashEntry> {
        self.trash.values()
    }

    /// Checks every structural invariant. Used for persisted input and by property tests.
    pub fn validate(&self) -> Result<(), InvariantViolation> {
        let fail = |message: String| Err(InvariantViolation(message));
        if self.children.len() != self.slots.len()
            || self.children.keys().any(|id| !self.slots.contains_key(id))
        {
            return fail("children index does not match slots".to_owned());
        }
        let mut seen_as_child = BTreeSet::new();
        for (parent, kids) in &self.children {
            for kid in kids {
                if !seen_as_child.insert(*kid) {
                    return fail(format!("{kid} appears under more than one position"));
                }
                if self.slots.get(kid) != Some(&Slot::Child { parent: *parent }) {
                    return fail(format!("{kid} listed under {parent} with another slot"));
                }
            }
        }
        let documents: BTreeSet<BlockId> = self.documents.iter().copied().collect();
        if documents.len() != self.documents.len() {
            return fail("duplicate document root".to_owned());
        }
        for (id, slot) in &self.slots {
            if self.membership(*id).is_none() {
                return fail(format!("{id} has a cyclic or dangling parent chain"));
            }
            let consistent = match slot {
                Slot::DocumentRoot => documents.contains(id),
                Slot::Child { .. } => seen_as_child.contains(id),
                Slot::TrashRoot { entry } => self.trash.get(entry).is_some_and(|e| e.root() == *id),
            };
            if !consistent {
                return fail(format!("{id} slot {slot:?} is not indexed"));
            }
        }
        if documents
            .iter()
            .any(|id| self.slots.get(id) != Some(&Slot::DocumentRoot))
        {
            return fail("document list contains a non-root".to_owned());
        }
        for entry in self.trash.values() {
            let detached: BTreeSet<BlockId> = self.subtree(entry.root()).into_iter().collect();
            if self.slots.get(&entry.root()) != Some(&Slot::TrashRoot { entry: entry.id() })
                || &detached != entry.newly_deleted()
            {
                return fail(format!(
                    "trash entry {} does not match its subtree",
                    entry.id()
                ));
            }
        }
        if self.retired.iter().any(|id| self.slots.contains_key(id)) {
            return fail("a retired ID is still present".to_owned());
        }
        Ok(())
    }

    fn require_new(&self, id: BlockId) -> Result<(), StructureError> {
        if self.contains(id) || self.is_retired(id) {
            Err(StructureError::AlreadyIssued { id })
        } else {
            Ok(())
        }
    }

    /// The slot of a live Block; trashed and unknown Blocks are rejected.
    fn live_slot(&self, id: BlockId) -> Result<Slot, StructureError> {
        match self.membership(id) {
            None => Err(StructureError::UnknownBlock { id }),
            Some(Membership::Trash { .. }) => Err(StructureError::InTrash { id }),
            Some(Membership::Topic { .. }) => {
                self.slot(id).ok_or(StructureError::UnknownBlock { id })
            }
        }
    }

    fn position_in_parent(&self, parent: BlockId, id: BlockId) -> Option<usize> {
        self.children(parent).iter().position(|kid| *kid == id)
    }

    /// Removes `id` from its current position index. The slot itself is replaced by `attach`.
    fn detach(&mut self, id: BlockId) {
        match self.slots.get(&id) {
            Some(Slot::DocumentRoot) => self.documents.retain(|root| *root != id),
            Some(Slot::Child { parent }) => {
                let parent = *parent;
                if let Some(kids) = self.children.get_mut(&parent) {
                    kids.retain(|kid| *kid != id);
                }
            }
            Some(Slot::TrashRoot { .. }) | None => {}
        }
    }

    /// Places `id` at `slot`. `index` is the child position (`None` appends).
    fn attach(&mut self, id: BlockId, slot: Slot, index: Option<usize>) {
        self.slots.insert(id, slot);
        self.children.entry(id).or_default();
        match slot {
            Slot::DocumentRoot => self.documents.push(id),
            Slot::Child { parent } => {
                let kids = self.children.entry(parent).or_default();
                let at = index.unwrap_or(kids.len()).min(kids.len());
                kids.insert(at, id);
            }
            Slot::TrashRoot { .. } => {}
        }
    }
}
