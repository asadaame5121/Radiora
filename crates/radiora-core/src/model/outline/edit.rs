//! Structure edits on live Blocks. Ordinary indent/outdent/insert never change membership;
//! crossing documents happens only through explicit extract and move, which keep IDs.
use super::{Outline, Slot, StructureError};
use crate::model::id::BlockId;
use std::collections::{BTreeMap, BTreeSet};

impl Outline {
    /// Creates an empty document. Its relative order among documents is not a product decision.
    pub fn create_document(&mut self, id: BlockId) -> Result<(), StructureError> {
        self.require_new(id)?;
        self.attach(id, Slot::DocumentRoot, None);
        Ok(())
    }

    /// Enter on a document root: creates its first child instead of splitting the document.
    pub fn create_first_child(&mut self, root: BlockId, id: BlockId) -> Result<(), StructureError> {
        if self.live_slot(root)? != Slot::DocumentRoot {
            return Err(StructureError::NotDocumentRoot { id: root });
        }
        self.require_new(id)?;
        self.attach(id, Slot::Child { parent: root }, Some(0));
        Ok(())
    }

    /// Enter on an ordinary Block: the new Block becomes its next sibling. Splitting the body text
    /// is a content operation and is not modeled here.
    pub fn insert_after(&mut self, sibling: BlockId, id: BlockId) -> Result<(), StructureError> {
        let Slot::Child { parent } = self.live_slot(sibling)? else {
            return Err(StructureError::IsDocumentRoot { id: sibling });
        };
        self.require_new(id)?;
        let at = self.position_in_parent(parent, sibling).map(|i| i + 1);
        self.attach(id, Slot::Child { parent }, at);
        Ok(())
    }

    /// Makes `id` the last child of its previous sibling.
    pub fn indent(&mut self, id: BlockId) -> Result<(), StructureError> {
        let Slot::Child { parent } = self.live_slot(id)? else {
            return Err(StructureError::IsDocumentRoot { id });
        };
        let index = self.position_in_parent(parent, id).unwrap_or(0);
        let Some(previous) = index.checked_sub(1).map(|i| self.children(parent)[i]) else {
            return Err(StructureError::NoPreviousSibling { id });
        };
        self.detach(id);
        self.attach(id, Slot::Child { parent: previous }, None);
        Ok(())
    }

    /// Moves `id` right after its parent. Children of a document root cannot be outdented: that
    /// would create a document, which is the separate extract operation.
    pub fn outdent(&mut self, id: BlockId) -> Result<(), StructureError> {
        let Slot::Child { parent } = self.live_slot(id)? else {
            return Err(StructureError::IsDocumentRoot { id });
        };
        let Some(Slot::Child {
            parent: grandparent,
        }) = self.slot(parent)
        else {
            return Err(StructureError::ParentIsDocumentRoot { id });
        };
        self.detach(id);
        let at = self.position_in_parent(grandparent, parent).map(|i| i + 1);
        self.attach(
            id,
            Slot::Child {
                parent: grandparent,
            },
            at,
        );
        Ok(())
    }

    /// Promotes an ordinary Block and its descendants to a new document, keeping all IDs.
    pub fn extract_as_document(&mut self, id: BlockId) -> Result<(), StructureError> {
        if self.live_slot(id)? == Slot::DocumentRoot {
            return Err(StructureError::IsDocumentRoot { id });
        }
        self.detach(id);
        self.attach(id, Slot::DocumentRoot, None);
        Ok(())
    }

    /// Moves an ordinary Block with its descendants to `index` under `parent`, in the same or
    /// another document, keeping all IDs. `index` counts positions after removing `id`.
    pub fn move_block(
        &mut self,
        id: BlockId,
        parent: BlockId,
        index: usize,
    ) -> Result<(), StructureError> {
        if self.live_slot(id)? == Slot::DocumentRoot {
            return Err(StructureError::IsDocumentRoot { id });
        }
        self.live_slot(parent)?;
        if self.subtree(id).contains(&parent) {
            return Err(StructureError::IntoOwnSubtree {
                moved: id,
                target: parent,
            });
        }
        let len = self
            .children(parent)
            .iter()
            .filter(|kid| **kid != id)
            .count();
        if index > len {
            return Err(StructureError::IndexOutOfRange { parent, index, len });
        }
        self.detach(id);
        self.attach(id, Slot::Child { parent }, Some(index));
        Ok(())
    }

    /// Copies a live subtree with newly issued IDs and returns the old→new mapping, which the
    /// caller also applies to reference targets and internal links (`BlockContent::copied`).
    /// The copy is placed right after the original; a copied document root becomes a new
    /// document. That placement is an implementation default, not a product decision.
    pub fn duplicate(
        &mut self,
        id: BlockId,
        mut issue: impl FnMut() -> BlockId,
    ) -> Result<BTreeMap<BlockId, BlockId>, StructureError> {
        let slot = self.live_slot(id)?;
        let originals = self.subtree(id);
        let mapping: BTreeMap<BlockId, BlockId> =
            originals.iter().map(|old| (*old, issue())).collect();
        let fresh: BTreeSet<BlockId> = mapping.values().copied().collect();
        if fresh.len() != mapping.len() {
            return Err(StructureError::DuplicateIssuedIds);
        }
        for new in &fresh {
            self.require_new(*new)?;
        }
        let copy_root = mapping[&id];
        match slot {
            Slot::Child { parent } => {
                let at = self.position_in_parent(parent, id).map(|i| i + 1);
                self.attach(copy_root, Slot::Child { parent }, at);
            }
            Slot::DocumentRoot | Slot::TrashRoot { .. } => {
                self.attach(copy_root, Slot::DocumentRoot, None);
            }
        }
        for old in &originals {
            let new_parent = mapping[old];
            let kids: Vec<BlockId> = self.children(*old).to_vec();
            for kid in kids {
                self.attach(mapping[&kid], Slot::Child { parent: new_parent }, None);
            }
        }
        Ok(mapping)
    }
}
