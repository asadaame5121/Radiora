//! Test-side builder of synthetic workspaces in the Loro document schema v1 draft
//! (`docs/design/v3-legacy-import-mapping.md` §3), for read-model tests before the Legacy
//! Importer (#384) exists. Compiled only for tests and the `test-support` feature.
//!
//! The layout keys are spelled out here on purpose instead of reusing `schema.rs`, so that a
//! renamed key on either side makes the read-model tests fail.

use super::error::{Result, WorkspaceError};
use super::issue_block_id;
use super::store::Store;
use loro::{ExportMode, LoroDoc, LoroMap, LoroText, LoroTree, TreeID, TreeParentId};
use radiora_core::model::BlockId;
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

/// Builds one workspace document node by node; `write` stores it as a new workspace file.
pub struct FixtureBuilder {
    doc: LoroDoc,
    nodes: HashMap<BlockId, TreeID>,
}

impl Default for FixtureBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl FixtureBuilder {
    pub fn new() -> Self {
        let doc = LoroDoc::new();
        let meta = doc.get_map("meta");
        meta.insert("schemaVersion", 1_i64)
            .expect("meta.schemaVersion");
        meta.insert("workspaceId", Uuid::now_v7().to_string())
            .expect("meta.workspaceId");
        doc.get_tree("blocks").enable_fractional_index(0);
        Self {
            doc,
            nodes: HashMap::new(),
        }
    }

    /// Appends a Topic root owning `body`.
    pub fn topic(&mut self, body: &str) -> BlockId {
        self.block_under(TreeParentId::Root, body)
    }

    /// Appends a Block owning `body` as the last child of `parent`.
    pub fn child(&mut self, parent: BlockId, body: &str) -> BlockId {
        let parent = TreeParentId::Node(self.node(parent));
        self.block_under(parent, body)
    }

    /// Appends a reference item to `target` as the last child of `parent`.
    pub fn reference(
        &mut self,
        parent: BlockId,
        target: BlockId,
        heading: Option<&str>,
    ) -> BlockId {
        let parent = TreeParentId::Node(self.node(parent));
        let (id, meta) = self.create(parent, "reference");
        meta.insert("target", target.to_string())
            .expect("node.target");
        if let Some(heading) = heading {
            meta.insert("heading", heading).expect("node.heading");
        }
        id
    }

    /// Moves `id` (and its subtree) to the trash by writing its trash mark.
    pub fn trash(&mut self, id: BlockId) {
        let meta = self.meta(id);
        let mark = meta
            .insert_container("trash", LoroMap::new())
            .expect("node.trash");
        mark.insert("itemId", Uuid::now_v7().to_string())
            .expect("trash.itemId");
        mark.insert("deletedAt", "2026-11-28T00:00:00Z")
            .expect("trash.deletedAt");
    }

    /// Purges `id`: deletes its tree node and records the ID in `deletedIds`.
    pub fn purge(&mut self, id: BlockId) {
        let node = self.node(id);
        self.tree().delete(node).expect("delete the purged node");
        self.doc
            .get_map("deletedIds")
            .insert(&id.to_string(), true)
            .expect("deletedIds entry");
        self.nodes.remove(&id);
    }

    /// A logical ID that no node carries, for an unresolved reference.
    pub fn unknown_id() -> BlockId {
        issue_block_id().expect("UUIDv7")
    }

    /// Writes the document as the initial snapshot of a new workspace at `path`.
    ///
    /// # Errors
    ///
    /// Fails when `path` already holds a database with tables, or on storage errors.
    pub fn write(self, path: &Path) -> Result<()> {
        self.doc.commit();
        let (mut store, restored) = Store::open(path)?;
        if restored.is_some() {
            return Err(WorkspaceError::NotWorkspace(
                "the fixture target already holds a workspace".into(),
            ));
        }
        store.initialize(&self.doc.export(ExportMode::Snapshot)?)
    }

    fn block_under(&mut self, parent: TreeParentId, body: &str) -> BlockId {
        let (id, meta) = self.create(parent, "block");
        let text = meta
            .insert_container("text", LoroText::new())
            .expect("node.text");
        text.insert(0, body).expect("body text");
        id
    }

    fn create(&mut self, parent: TreeParentId, kind: &str) -> (BlockId, LoroMap) {
        let id = issue_block_id().expect("UUIDv7");
        let tree = self.tree();
        let node = tree.create(parent).expect("tree node");
        let meta = tree.get_meta(node).expect("node meta");
        meta.insert("id", id.to_string()).expect("node.id");
        meta.insert("kind", kind).expect("node.kind");
        self.nodes.insert(id, node);
        (id, meta)
    }

    fn tree(&self) -> LoroTree {
        self.doc.get_tree("blocks")
    }

    fn node(&self, id: BlockId) -> TreeID {
        *self.nodes.get(&id).expect("a Block built by this fixture")
    }

    fn meta(&self, id: BlockId) -> LoroMap {
        self.tree().get_meta(self.node(id)).expect("node meta")
    }
}

/// Makes every later update append to the workspace at `path` fail (or succeed again), from
/// a second SQLite connection, so that tests can leave an applied change not durable without
/// a hook in the product code.
///
/// # Errors
///
/// Fails on SQLite errors, e.g. when the failure is already in the requested state.
pub fn set_write_failure(path: &Path, enabled: bool) -> Result<()> {
    let db = rusqlite::Connection::open(path)?;
    db.execute_batch(if enabled {
        "CREATE TRIGGER fixture_reject_update BEFORE INSERT ON updates
         BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;"
    } else {
        "DROP TRIGGER fixture_reject_update;"
    })?;
    Ok(())
}

/// IDs of the representative workspace written by [`representative`].
#[derive(Debug, Clone, Copy)]
pub struct Representative {
    /// Topic 1 root: Japanese and emoji.
    pub first: BlockId,
    /// Child of `first`: combining characters.
    pub combining: BlockId,
    /// Child of `combining`: CRLF line breaks.
    pub crlf: BlockId,
    /// Child of `first`, in the trash together with `trashed_child`.
    pub trashed: BlockId,
    pub trashed_child: BlockId,
    /// Child of `first`: reference to `combining` with a heading.
    pub live_reference: BlockId,
    /// Child of `live_reference`: a reference item keeps its own children.
    pub reference_child: BlockId,
    /// Topic 2 root.
    pub second: BlockId,
    /// Children of `second`: references to `trashed`, an unknown ID and a purged Block.
    pub trashed_reference: BlockId,
    pub unknown_reference: BlockId,
    pub purged_reference: BlockId,
    pub purged: BlockId,
    pub unknown: BlockId,
    /// Topic 3 root, in the trash.
    pub trashed_topic: BlockId,
}

/// Bodies used by [`representative`].
pub mod bodies {
    pub const FIRST: &str = "思索の連鎖 🌱👩‍👩‍👧";
    /// `か` + combining voiced mark, `e` + combining acute accent (not normalized).
    pub const COMBINING: &str = "か\u{3099}ふぇ\u{301}";
    pub const CRLF: &str = "一行目\r\n二行目\r\n";
    pub const TRASHED: &str = "ゴミ箱へ移した代表";
    pub const TRASHED_CHILD: &str = "代表の子";
    pub const REFERENCE_CHILD: &str = "参照項目の子";
    pub const SECOND: &str = "二つ目のTopic";
    pub const PURGED: &str = "完全削除した本文";
    pub const TRASHED_TOPIC: &str = "ゴミ箱のTopic";
    pub const HEADING: &str = "固有見出し";
}

/// Writes the representative synthetic workspace (#403): multiple roots, nesting, reference
/// items, a representative in the trash, Missing targets (unknown and purged), a trashed
/// Topic, and Japanese/emoji/combining characters/CRLF bodies.
///
/// # Errors
///
/// As [`FixtureBuilder::write`].
pub fn representative(path: &Path) -> Result<Representative> {
    let mut b = FixtureBuilder::new();
    let first = b.topic(bodies::FIRST);
    let combining = b.child(first, bodies::COMBINING);
    let crlf = b.child(combining, bodies::CRLF);
    let trashed = b.child(first, bodies::TRASHED);
    let trashed_child = b.child(trashed, bodies::TRASHED_CHILD);
    let live_reference = b.reference(first, combining, Some(bodies::HEADING));
    let reference_child = b.child(live_reference, bodies::REFERENCE_CHILD);
    let second = b.topic(bodies::SECOND);
    let trashed_reference = b.reference(second, trashed, None);
    let unknown = FixtureBuilder::unknown_id();
    let unknown_reference = b.reference(second, unknown, None);
    let purged = b.child(second, bodies::PURGED);
    let purged_reference = b.reference(second, purged, None);
    let trashed_topic = b.topic(bodies::TRASHED_TOPIC);
    b.trash(trashed);
    b.trash(trashed_topic);
    b.purge(purged);
    b.write(path)?;
    Ok(Representative {
        first,
        combining,
        crlf,
        trashed,
        trashed_child,
        live_reference,
        reference_child,
        second,
        trashed_reference,
        unknown_reference,
        purged_reference,
        purged,
        unknown,
        trashed_topic,
    })
}
