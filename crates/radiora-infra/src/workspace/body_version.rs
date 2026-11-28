//! Per-Block body versions derived from the Loro history (#381 conflict-unit contract).
//!
//! The version of a body is the set of operations that ever touched its LoroText: for each
//! peer, the highest op counter applied to that container. It only grows, changes with every
//! operation on that body (edits, Undo/Redo, restores and imports all add new ops) and is
//! unaffected by operations on other containers. It is published as an opaque digest, so no
//! Loro peer, counter or version vector crosses the boundary.
//!
//! The index is built from the whole history when the workspace opens and is then extended
//! with the operations after the last indexed version.

use loro::{ContainerID, LoroDoc, VersionVector};
use radiora_core::app::BodyVersion;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

/// Bytes of the SHA-256 digest kept in a token (128 bits).
const TOKEN_BYTES: usize = 16;

#[derive(Default)]
pub(super) struct BodyVersions {
    /// Container → (peer → highest op counter that touched it).
    touched: HashMap<ContainerID, BTreeMap<u64, i32>>,
    indexed: VersionVector,
}

impl BodyVersions {
    /// Indexes the whole history of `doc`.
    pub fn build(doc: &LoroDoc) -> Self {
        let mut versions = Self::default();
        versions.refresh(doc);
        versions
    }

    /// Indexes the operations applied after the last call.
    pub fn refresh(&mut self, doc: &LoroDoc) {
        let current = doc.oplog_vv();
        if current == self.indexed {
            return;
        }
        let updates = doc.export_json_updates_without_peer_compression(&self.indexed, &current);
        for change in updates.changes {
            let peer = change.id.peer;
            for op in change.ops {
                let counters = self.touched.entry(op.container).or_default();
                let highest = counters.entry(peer).or_insert(op.counter);
                *highest = (*highest).max(op.counter);
            }
        }
        self.indexed = current;
    }

    /// The opaque version of the body held by `text`.
    pub fn token(&self, text: &ContainerID) -> BodyVersion {
        let mut hasher = Sha256::new();
        hasher.update(text.to_string().as_bytes());
        for (peer, counter) in self.touched.get(text).into_iter().flatten() {
            hasher.update(peer.to_be_bytes());
            hasher.update(counter.to_be_bytes());
        }
        let digest = hasher.finalize();
        let hex: String = digest[..TOKEN_BYTES]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        BodyVersion::new(hex)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use loro::{ContainerTrait, LoroText, UndoManager};

    fn text_of(doc: &LoroDoc, key: &str) -> LoroText {
        doc.get_map("m")
            .insert_container(key, LoroText::new())
            .expect("text container")
    }

    #[test]
    fn a_body_version_changes_only_with_its_own_body_and_never_returns() {
        let doc = LoroDoc::new();
        let a = text_of(&doc, "a");
        let b = text_of(&doc, "b");
        doc.commit();
        let mut versions = BodyVersions::build(&doc);
        let a0 = versions.token(&a.id());
        let b0 = versions.token(&b.id());

        a.insert(0, "x").expect("edit a");
        doc.commit();
        versions.refresh(&doc);
        let a1 = versions.token(&a.id());
        assert_ne!(a1, a0);
        assert_eq!(versions.token(&b.id()), b0, "another body did not change");

        // Writing the same text again adds no operation and keeps the version.
        a.update("x", Default::default()).expect("same text");
        doc.commit();
        versions.refresh(&doc);
        assert_eq!(versions.token(&a.id()), a1);

        // Undo restores the earlier text, but not the earlier version.
        let mut undo = UndoManager::new(&doc);
        a.insert(1, "y").expect("edit a");
        doc.commit();
        undo.undo().expect("undo");
        doc.commit();
        versions.refresh(&doc);
        assert_eq!(a.to_string(), "x");
        let after_undo = versions.token(&a.id());
        assert_ne!(after_undo, a0);
        assert_ne!(after_undo, a1);

        // Rebuilding from the same history yields the same tokens.
        let rebuilt = BodyVersions::build(&doc);
        assert_eq!(rebuilt.token(&a.id()), after_undo);
        assert_eq!(rebuilt.token(&b.id()), b0);
    }
}
