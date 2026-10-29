//! Shared-history fixture for the adopted v3 direction.
//!
//! Not a product schema. One LoroDoc and one shared UndoManager; a pane
//! argument is request context only and never selects a separate history.
//!
//! The fixture stores an application logical ID in each Tree node's metadata.
//! Loro may recreate TreeIDs when a delete is undone or a trash subtree is
//! restored, so observations are made by logical ID, parent, sibling index and
//! body, not by TreeID except where the distinction itself is the evidence.

use crate::storage::Store;
use crate::{Phase, Result};
use loro::{
    CommitOptions, LoroDoc, LoroTree, LoroValue, TreeID, TreeParentId, UndoManager, VersionVector,
};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const TREE: &str = "outline";
const BODY_PREFIX: &str = "body:";
const BLOCK_ID: &str = "block_id";
const TRASH: &str = "trash";
const PURGED: &str = "purged";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockView {
    pub id: String,
    pub parent: Option<String>,
    pub index: usize,
    pub text: String,
    pub tree_id: String,
}

/// Fixture-only diagnostic read model. It exposes Loro Tree links, including
/// deleted nodes, only to distinguish the captured deletion group from physical
/// descendants. It is not a product read model or a schema decision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeProbe {
    pub tree_id: String,
    pub block_id: String,
    pub parent_block_id: Option<String>,
    pub parent_is_deleted_root: bool,
    pub index: usize,
    pub deleted: bool,
}

/// Synchronous owner of the single Doc, single manager, and SQLite store.
pub struct SharedWorkspace {
    doc: LoroDoc,
    manager: UndoManager,
    store: Store,
    saved: VersionVector,
    phase: Phase,
    clear_on_save: bool,
}

/// (logical ID, parent logical ID, sibling index, body)
const SEEDS: [(&str, Option<&str>, usize, &str); 7] = [
    ("A", None, 0, "alpha"),
    ("B", Some("A"), 0, "bravo"),
    ("C", Some("B"), 0, "charlie"),
    ("D", Some("B"), 1, "delta"),
    ("E", Some("A"), 1, "echo"),
    ("X", None, 1, "xray"),
    ("Y", Some("X"), 0, "yankee"),
];

#[derive(Debug)]
struct TombstoneRecord {
    parent: Option<String>,
    anchor: Option<String>,
    /// Preorder pairs of logical ID and recorded parent logical ID.
    nodes: Vec<(String, Option<String>)>,
}

impl TombstoneRecord {
    // Fixture-only serialization. IDs are ASCII [A-Za-z0-9_-] and never contain
    // the two control characters used as separators.
    fn encode(&self) -> String {
        let mut out = String::new();
        out.push_str(self.parent.as_deref().unwrap_or(""));
        out.push('\u{1f}');
        out.push_str(self.anchor.as_deref().unwrap_or(""));
        for (id, parent) in &self.nodes {
            out.push('\u{1e}');
            out.push_str(parent.as_deref().unwrap_or(""));
            out.push('\u{1f}');
            out.push_str(id);
        }
        out
    }

    fn decode(raw: &str) -> Result<Self> {
        let mut records = raw.split('\u{1e}');
        let head = records.next().ok_or("corrupt tombstone record")?;
        let mut head_parts = head.split('\u{1f}');
        let parent = head_parts.next().unwrap_or("");
        let anchor = head_parts.next().ok_or("corrupt tombstone header")?;
        if head_parts.next().is_some() {
            return Err("corrupt tombstone header".into());
        }
        let mut nodes = Vec::new();
        for record in records {
            let mut parts = record.split('\u{1f}');
            let node_parent = parts.next().ok_or("corrupt tombstone node")?;
            let id = parts.next().ok_or("corrupt tombstone node")?;
            if id.is_empty() || parts.next().is_some() {
                return Err("corrupt tombstone node".into());
            }
            nodes.push((
                id.to_string(),
                (!node_parent.is_empty()).then(|| node_parent.to_string()),
            ));
        }
        if nodes.is_empty() || nodes[0].1.is_some() {
            return Err("tombstone root must not record a relative parent".into());
        }
        Ok(Self {
            parent: (!parent.is_empty()).then(|| parent.to_string()),
            anchor: (!anchor.is_empty()).then(|| anchor.to_string()),
            nodes,
        })
    }
}

impl SharedWorkspace {
    pub fn open(path: &Path) -> Result<Self> {
        let store = Store::open(path)?;
        let doc = match store.restore()? {
            Some(doc) => doc,
            None => {
                let doc = LoroDoc::new();
                seed(&doc)?;
                store.initialize(&doc)?;
                doc
            }
        };
        // This is in-memory Tree state; call it for both fresh and restored docs
        // so create_at works after reopen.
        doc.get_tree(TREE).enable_fractional_index(0);
        let mut manager = UndoManager::new(&doc);
        manager.set_merge_interval(0);
        manager.add_exclude_origin_prefix("system:");
        let saved = doc.oplog_vv();
        Ok(Self {
            doc,
            manager,
            store,
            saved,
            phase: Phase::Ready,
            clear_on_save: false,
        })
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn history(&self) -> (usize, usize) {
        (self.manager.undo_count(), self.manager.redo_count())
    }

    pub fn inject_write_failure(&self, enabled: bool) -> Result<()> {
        self.store.inject_write_failure(enabled)
    }

    pub fn is_purged(&self, id: &str) -> Result<bool> {
        self.ready()?;
        Ok(self.purged_raw(id))
    }

    pub fn text(&self, id: &str) -> Result<Option<String>> {
        self.ready()?;
        if self.purged_raw(id) || self.lookup(id)?.is_none() {
            return Ok(None);
        }
        Ok(Some(self.body(id)))
    }

    pub fn render(&self) -> Result<Vec<BlockView>> {
        self.ready()?;
        let tree = self.doc.get_tree(TREE);
        let mut out = Vec::new();
        self.walk(&tree, TreeParentId::Root, None, &mut out)?;
        Ok(out)
    }

    pub fn trash_scope(&self, id: &str) -> Result<Vec<String>> {
        self.ready()?;
        let record = self.read_tombstone(id)?;
        Ok(record.nodes.into_iter().map(|(id, _)| id).collect())
    }

    /// The parent logical ID captured in this Tombstone at its delete time.
    /// It is not looked up in the current live tree; a purged/moved parent can
    /// still be named here.
    pub fn trash_parent(&self, id: &str) -> Result<Option<String>> {
        self.ready()?;
        Ok(self.read_tombstone(id)?.parent)
    }

    /// Fixture-only: list both live and deleted Loro Tree nodes with their
    /// physical parent link and the captured logical ID. Used to compare a
    /// Tombstone's deletion group with physical descendants.
    pub fn tree_probe(&self) -> Result<Vec<TreeProbe>> {
        self.ready()?;
        let tree = self.doc.get_tree(TREE);
        let live: HashSet<TreeID> = tree
            .get_nodes(false)
            .into_iter()
            .map(|node| node.id)
            .collect();
        let mut rows = Vec::new();
        for node in tree.get_nodes(true) {
            let (parent_block_id, parent_is_deleted_root) = match tree.parent(node.id) {
                Some(TreeParentId::Node(parent)) => (Some(block_id_of(&tree, parent)?), false),
                Some(TreeParentId::Deleted) => (None, true),
                Some(TreeParentId::Root | TreeParentId::Unexist) | None => (None, false),
            };
            rows.push(TreeProbe {
                tree_id: node.id.to_string(),
                block_id: block_id_of(&tree, node.id)?,
                parent_block_id,
                parent_is_deleted_root,
                index: node.index,
                deleted: !live.contains(&node.id),
            });
        }
        rows.sort_by(|left, right| {
            left.block_id
                .cmp(&right.block_id)
                .then(left.tree_id.cmp(&right.tree_id))
        });
        Ok(rows)
    }

    pub fn edit(&mut self, pane: usize, id: &str, text: &str) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        self.live_id(id)?;
        self.phase = Phase::RecoveryRequired;
        self.doc
            .get_text(body_key(id))
            .update(text, Default::default())?;
        self.commit_and_save(&format!("pane:{pane}:edit"), false)
    }

    /// Sibling-order move. This also permits a same-parent reorder without
    /// requiring the caller to compute a final index.
    pub fn move_before(&mut self, pane: usize, id: &str, before: &str) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        let target = self.live_id(id)?;
        let sibling = self.live_id(before)?;
        let tree = self.doc.get_tree(TREE);
        if target == sibling || tree.parent(target) != tree.parent(sibling) {
            return Err("move_before requires two different siblings".into());
        }
        self.phase = Phase::RecoveryRequired;
        tree.mov_before(target, sibling)?;
        self.commit_and_save(&format!("pane:{pane}:move"), false)
    }

    /// Move a subtree under a live parent, or to the document-root list when
    /// `parent` is None. `index` is the destination index before removal.
    pub fn move_under(
        &mut self,
        pane: usize,
        id: &str,
        parent: Option<&str>,
        index: usize,
    ) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        let target = self.live_id(id)?;
        let parent = match parent {
            Some(parent) => {
                let parent = self.live_id(parent)?;
                if self.is_ancestor_or_self(target, parent)? {
                    return Err("cannot move a block under itself or its descendant".into());
                }
                TreeParentId::Node(parent)
            }
            None => TreeParentId::Root,
        };
        let tree = self.doc.get_tree(TREE);
        let len = tree.children(parent).map(|c| c.len()).unwrap_or(0);
        if index > len {
            return Err("destination index is out of bounds".into());
        }
        self.phase = Phase::RecoveryRequired;
        tree.mov_to(target, parent, index)?;
        self.commit_and_save(&format!("pane:{pane}:move"), false)
    }

    /// Move a subtree to the Tombstone. The record captures only the visible
    /// subtree, so a child that was already tombstoned is not revived later.
    pub fn delete(&mut self, pane: usize, id: &str) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        let tree = self.doc.get_tree(TREE);
        let target = self.live_id(id)?;
        let parent_tree = tree
            .parent(target)
            .ok_or_else(|| format!("block {id} has no parent"))?;
        let parent = match parent_tree {
            TreeParentId::Root => None,
            TreeParentId::Node(parent) => Some(block_id_of(&tree, parent)?),
            TreeParentId::Deleted | TreeParentId::Unexist => {
                return Err("block is already removed from the live tree".into())
            }
        };
        let anchor = self.next_sibling_anchor(&tree, parent_tree, target)?;
        let nodes = self.capture_subtree(&tree, target, None)?;
        let record = TombstoneRecord {
            parent,
            anchor,
            nodes,
        };
        self.phase = Phase::RecoveryRequired;
        tree.delete(target)?;
        self.doc.get_map(TRASH).insert(id, record.encode())?;
        self.commit_and_save(&format!("pane:{pane}:trash"), false)
    }

    /// Trash restore is a new public operation. It recreates nodes with new Loro
    /// TreeIDs but the same application logical IDs and bodies. When the
    /// original parent is unavailable, `confirm_independent` must be true and
    /// the subtree becomes a new document root.
    pub fn restore(&mut self, pane: usize, id: &str, confirm_independent: bool) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        let record = self.read_tombstone(id)?;
        if self.lookup(id)?.is_some() {
            return Err("block is already live".into());
        }
        if self.purged_raw(id) || record.nodes.iter().any(|(node, _)| self.purged_raw(node)) {
            return Err("purged blocks cannot be restored".into());
        }
        let live_parent = match &record.parent {
            Some(parent) => self.lookup(parent)?,
            None => None,
        };
        if record.parent.is_some() && live_parent.is_none() && !confirm_independent {
            return Err("restore as an independent document requires confirmation".into());
        }
        let tree = self.doc.get_tree(TREE);
        let (root_parent, root_index) = match (record.parent.as_ref(), live_parent) {
            (None, _) => {
                let index =
                    self.anchor_index(&tree, TreeParentId::Root, record.anchor.as_deref())?;
                (TreeParentId::Root, index)
            }
            (Some(_), Some(parent)) => {
                let parent = TreeParentId::Node(parent);
                let index = self.anchor_index(&tree, parent, record.anchor.as_deref())?;
                (parent, index)
            }
            (Some(_), None) => (
                TreeParentId::Root,
                tree.children(TreeParentId::Root)
                    .map(|children| children.len())
                    .unwrap_or(0),
            ),
        };

        self.phase = Phase::RecoveryRequired;
        let mut created: HashMap<String, TreeID> = HashMap::new();
        for (index, (logical, recorded_parent)) in record.nodes.iter().enumerate() {
            let (parent, position) = if index == 0 {
                (root_parent, root_index)
            } else {
                let parent_logical = recorded_parent
                    .as_deref()
                    .ok_or("corrupt tombstone preorder")?;
                let parent_tree = *created
                    .get(parent_logical)
                    .ok_or("corrupt tombstone preorder")?;
                let parent = TreeParentId::Node(parent_tree);
                let position = tree
                    .children(parent)
                    .map(|children| children.len())
                    .unwrap_or(0);
                (parent, position)
            };
            let new_id = tree.create_at(parent, position)?;
            tree.get_meta(new_id)?.insert(BLOCK_ID, logical.as_str())?;
            created.insert(logical.clone(), new_id);
        }
        self.doc.get_map(TRASH).delete(id)?;
        self.commit_and_save(&format!("pane:{pane}:restore"), false)
    }

    /// Representative composite command: split a block's body and insert the
    /// tail as the next sibling in the same parent, all in one commit.
    pub fn split(&mut self, pane: usize, id: &str, char_index: usize, new_id: &str) -> Result<()> {
        self.ready()?;
        Self::pane(pane)?;
        if !valid_new_id(new_id) {
            return Err("new block id must be ASCII [A-Za-z0-9_-]".into());
        }
        let target = self.live_id(id)?;
        if self.lookup(new_id)?.is_some() || self.purged_raw(new_id) {
            return Err("new block id is already reserved".into());
        }
        if !self.body(new_id).is_empty() {
            return Err("new block id already has body text".into());
        }
        let current = self.body(id);
        let (before, after) = split_at_char(&current, char_index)?;
        let tree = self.doc.get_tree(TREE);
        let parent = tree
            .parent(target)
            .ok_or_else(|| format!("block {id} has no parent"))?;
        let position = tree
            .children(parent)
            .unwrap_or_default()
            .iter()
            .position(|child| *child == target)
            .ok_or("source block is not in its parent")?
            + 1;

        self.phase = Phase::RecoveryRequired;
        self.doc
            .get_text(body_key(id))
            .update(before, Default::default())?;
        let new_tree = tree.create_at(parent, position)?;
        tree.get_meta(new_tree)?.insert(BLOCK_ID, new_id)?;
        self.doc.get_text(body_key(new_id)).insert(0, after)?;
        self.commit_and_save(&format!("pane:{pane}:split"), false)
    }

    /// Purge exactly the confirmed Tombstone scope. The purge origin is excluded
    /// from the shared history, and the history is cleared only after the
    /// SQLite append succeeds.
    pub fn purge(&mut self, id: &str, confirmed_ids: &[&str]) -> Result<()> {
        self.ready()?;
        let record = self.read_tombstone(id)?;
        if self.lookup(id)?.is_some() {
            return Err("block is live, not in the trash".into());
        }
        if self.purged_raw(id) || record.nodes.iter().any(|(node, _)| self.purged_raw(node)) {
            return Err("block is already purged".into());
        }
        let scope: Vec<&str> = record.nodes.iter().map(|(node, _)| node.as_str()).collect();
        let mut confirmed = confirmed_ids.to_vec();
        confirmed.sort_unstable();
        let mut expected = scope.clone();
        expected.sort_unstable();
        if confirmed != expected {
            return Err(format!("confirmation must name exactly the set {scope:?}").into());
        }
        self.phase = Phase::RecoveryRequired;
        for (node, _) in &record.nodes {
            let text = self.doc.get_text(body_key(node));
            text.delete(0, text.len_unicode())?;
            self.doc.get_map(PURGED).insert(node.as_str(), true)?;
        }
        self.doc.get_map(TRASH).delete(id)?;
        self.commit_and_save("system:purge", true)
    }

    pub fn undo(&mut self, pane: usize) -> Result<bool> {
        self.replay(pane, false)
    }

    pub fn redo(&mut self, pane: usize) -> Result<bool> {
        self.replay(pane, true)
    }

    pub fn retry(&mut self) -> Result<()> {
        if self.phase != Phase::Dirty {
            return Err("no complete mutation awaiting persistence".into());
        }
        // Only persistence is retried; Loro operations are never reapplied.
        self.saved = self.store.append(&self.doc, &self.saved)?;
        if self.clear_on_save {
            self.manager.clear();
            self.clear_on_save = false;
        }
        self.phase = Phase::Ready;
        Ok(())
    }

    fn replay(&mut self, pane: usize, redo: bool) -> Result<bool> {
        self.ready()?;
        Self::pane(pane)?;
        self.phase = Phase::RecoveryRequired;
        let changed = if redo {
            self.manager.redo()?
        } else {
            self.manager.undo()?
        };
        if !changed {
            self.phase = Phase::Ready;
            return Ok(false);
        }
        self.clear_on_save = false;
        self.phase = Phase::Dirty;
        self.retry()?;
        Ok(true)
    }

    fn commit_and_save(&mut self, origin: &str, clear: bool) -> Result<()> {
        self.doc.commit_with(CommitOptions::new().origin(origin));
        self.clear_on_save = clear;
        self.phase = Phase::Dirty;
        self.retry()
    }

    fn ready(&self) -> Result<()> {
        if self.phase != Phase::Ready {
            return Err("workspace blocked: retry persistence or reopen for recovery".into());
        }
        Ok(())
    }

    fn pane(pane: usize) -> Result<()> {
        if pane >= 2 {
            return Err("unknown fixture pane".into());
        }
        Ok(())
    }

    fn body(&self, id: &str) -> String {
        self.doc.get_text(body_key(id)).to_string()
    }

    fn purged_raw(&self, id: &str) -> bool {
        self.doc.get_map(PURGED).get(id).is_some()
    }

    fn lookup(&self, id: &str) -> Result<Option<TreeID>> {
        let tree = self.doc.get_tree(TREE);
        for node in tree.get_nodes(false) {
            if block_id_of(&tree, node.id)? == id {
                return Ok(Some(node.id));
            }
        }
        Ok(None)
    }

    fn live_id(&self, id: &str) -> Result<TreeID> {
        self.lookup(id)?
            .ok_or_else(|| format!("block {id} is not live").into())
    }

    fn walk(
        &self,
        tree: &LoroTree,
        parent: TreeParentId,
        parent_id: Option<&str>,
        out: &mut Vec<BlockView>,
    ) -> Result<()> {
        for (index, child) in tree
            .children(parent)
            .unwrap_or_default()
            .into_iter()
            .enumerate()
        {
            let id = block_id_of(tree, child)?;
            let text = self.body(&id);
            out.push(BlockView {
                id: id.clone(),
                parent: parent_id.map(str::to_string),
                index,
                text,
                tree_id: child.to_string(),
            });
            self.walk(tree, TreeParentId::Node(child), Some(&id), out)?;
        }
        Ok(())
    }

    fn capture_subtree(
        &self,
        tree: &LoroTree,
        id: TreeID,
        parent: Option<&str>,
    ) -> Result<Vec<(String, Option<String>)>> {
        let mut nodes = Vec::new();
        self.capture_into(tree, id, parent, &mut nodes)?;
        Ok(nodes)
    }

    fn capture_into(
        &self,
        tree: &LoroTree,
        id: TreeID,
        parent: Option<&str>,
        out: &mut Vec<(String, Option<String>)>,
    ) -> Result<()> {
        let logical = block_id_of(tree, id)?;
        out.push((logical.clone(), parent.map(str::to_string)));
        for child in tree.children(TreeParentId::Node(id)).unwrap_or_default() {
            self.capture_into(tree, child, Some(&logical), out)?;
        }
        Ok(())
    }

    fn next_sibling_anchor(
        &self,
        tree: &LoroTree,
        parent: TreeParentId,
        target: TreeID,
    ) -> Result<Option<String>> {
        let children = tree.children(parent).unwrap_or_default();
        let position = children
            .iter()
            .position(|child| *child == target)
            .ok_or("source block is not in its parent")?;
        children
            .get(position + 1)
            .map(|child| block_id_of(tree, *child))
            .transpose()
    }

    /// Return the index before the recorded next sibling if that marker is
    /// still live under the same parent; otherwise append.
    fn anchor_index(
        &self,
        tree: &LoroTree,
        parent: TreeParentId,
        anchor: Option<&str>,
    ) -> Result<usize> {
        let children = tree.children(parent).unwrap_or_default();
        let Some(anchor) = anchor else {
            return Ok(children.len());
        };
        let Some(anchor) = self.lookup(anchor)? else {
            return Ok(children.len());
        };
        Ok(children
            .iter()
            .position(|child| *child == anchor)
            .unwrap_or(children.len()))
    }

    fn is_ancestor_or_self(&self, ancestor: TreeID, node: TreeID) -> Result<bool> {
        let tree = self.doc.get_tree(TREE);
        let mut current = Some(node);
        while let Some(id) = current {
            if id == ancestor {
                return Ok(true);
            }
            current = match tree.parent(id) {
                Some(TreeParentId::Node(parent)) => Some(parent),
                _ => None,
            };
        }
        Ok(false)
    }

    fn read_tombstone(&self, id: &str) -> Result<TombstoneRecord> {
        let value = self
            .doc
            .get_map(TRASH)
            .get(id)
            .ok_or_else(|| format!("{id} is not in the trash"))?;
        match value.get_deep_value() {
            LoroValue::String(raw) => TombstoneRecord::decode(raw.as_ref()),
            _ => Err("corrupt tombstone record".into()),
        }
    }
}

fn seed(doc: &LoroDoc) -> Result<()> {
    let tree = doc.get_tree(TREE);
    tree.enable_fractional_index(0);
    let mut tree_ids = HashMap::new();
    for (logical, parent, index, text) in SEEDS {
        let parent = match parent {
            Some(parent) => TreeParentId::Node(*tree_ids.get(parent).ok_or("seed order")?),
            None => TreeParentId::Root,
        };
        let id = tree.create_at(parent, index)?;
        tree.get_meta(id)?.insert(BLOCK_ID, logical)?;
        doc.get_text(body_key(logical)).insert(0, text)?;
        tree_ids.insert(logical, id);
    }
    doc.commit();
    Ok(())
}

fn block_id_of(tree: &LoroTree, id: TreeID) -> Result<String> {
    match tree
        .get_meta(id)?
        .get(BLOCK_ID)
        .map(|value| value.get_deep_value())
    {
        Some(LoroValue::String(value)) => Ok(value.to_string()),
        _ => Err(format!("tree node {id} has no logical block id").into()),
    }
}

fn body_key(id: &str) -> String {
    format!("{BODY_PREFIX}{id}")
}

fn valid_new_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn split_at_char(text: &str, char_index: usize) -> Result<(&str, &str)> {
    let char_count = text.chars().count();
    if char_index == 0 || char_index >= char_count {
        return Err("split must leave both sides non-empty".into());
    }
    let byte_index = text
        .char_indices()
        .nth(char_index)
        .map(|(index, _)| index)
        .ok_or("split index is not a character boundary")?;
    Ok(text.split_at(byte_index))
}
