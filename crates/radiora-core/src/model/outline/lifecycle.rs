//! Ordinary delete, trash restore and purge on the structure.
use super::{Membership, Outline, Slot, StructureError};
use crate::model::id::{BlockId, TrashEntryId};
use crate::model::trash::{
    OriginalPlacement, PlacementObservation, RestorePlan, TrashEntry, plan_restore, purge_targets,
};
use std::collections::BTreeSet;

impl Outline {
    /// Moves a live Block and its live descendants to the trash as one entry. References from
    /// outside the subtree are not followed.
    pub fn trash(
        &mut self,
        id: BlockId,
        entry: TrashEntryId,
    ) -> Result<&TrashEntry, StructureError> {
        let slot = self.live_slot(id)?;
        if self.trash.contains_key(&entry) {
            return Err(StructureError::TrashEntryExists { entry });
        }
        let placement = match slot {
            Slot::Child { parent } => OriginalPlacement::Child {
                parent,
                previous_sibling: self
                    .position_in_parent(parent, id)
                    .and_then(|i| i.checked_sub(1))
                    .map(|i| self.children(parent)[i]),
            },
            Slot::DocumentRoot | Slot::TrashRoot { .. } => OriginalPlacement::DocumentRoot,
        };
        // Earlier-trashed descendants are detached already, so the subtree is exactly the
        // Blocks newly deleted by this operation.
        let newly_deleted: BTreeSet<BlockId> = self.subtree(id).into_iter().collect();
        let trash_entry = TrashEntry::new(entry, id, placement, newly_deleted)?;
        self.detach(id);
        self.attach(id, Slot::TrashRoot { entry }, None);
        Ok(self.trash.entry(entry).or_insert(trash_entry))
    }

    /// Restores exactly the Blocks of one trash entry. When the original parent is unusable the
    /// subtree becomes a separate document only if `confirm_as_document` is set; parents are
    /// never restored implicitly.
    pub fn restore(
        &mut self,
        entry: TrashEntryId,
        confirm_as_document: bool,
    ) -> Result<RestorePlan, StructureError> {
        let trash_entry = self
            .trash
            .get(&entry)
            .ok_or(StructureError::UnknownTrashEntry { entry })?;
        let root = trash_entry.root();
        let placement = trash_entry.placement();
        let observed = match placement {
            OriginalPlacement::DocumentRoot => PlacementObservation {
                parent_live: false,
                anchor_in_place: false,
            },
            OriginalPlacement::Child {
                parent,
                previous_sibling,
            } => PlacementObservation {
                parent_live: matches!(self.membership(parent), Some(Membership::Topic { .. })),
                anchor_in_place: previous_sibling
                    .is_some_and(|anchor| self.slot(anchor) == Some(Slot::Child { parent })),
            },
        };
        let plan = plan_restore(placement, observed);
        let (slot, index) = match plan {
            RestorePlan::AtOriginalPosition { parent, after } => {
                let index = after
                    .and_then(|anchor| self.position_in_parent(parent, anchor))
                    .map_or(0, |i| i + 1);
                (Slot::Child { parent }, Some(index))
            }
            RestorePlan::AtEndOfParent { parent } => (Slot::Child { parent }, None),
            RestorePlan::AsNewDocumentAfterConfirmation if !confirm_as_document => {
                return Err(StructureError::NeedsConfirmation { entry });
            }
            RestorePlan::AsNewDocumentAfterConfirmation | RestorePlan::AsDocumentRoot => {
                (Slot::DocumentRoot, None)
            }
        };
        self.trash.remove(&entry);
        self.attach(root, slot, index);
        Ok(plan)
    }

    /// Permanently removes the selected entries' Blocks and retires their IDs. Other entries
    /// stay, even if their original parent is purged. Returns the purged set, which must match
    /// the confirmation shown to the user.
    pub fn purge(&mut self, entries: &[TrashEntryId]) -> Result<BTreeSet<BlockId>, StructureError> {
        let selected = entries
            .iter()
            .map(|entry| {
                self.trash
                    .get(entry)
                    .ok_or(StructureError::UnknownTrashEntry { entry: *entry })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let targets = purge_targets(selected);
        for entry in entries {
            self.trash.remove(entry);
        }
        for id in &targets {
            self.slots.remove(id);
            self.children.remove(id);
            self.retired.insert(*id);
        }
        Ok(targets)
    }
}
