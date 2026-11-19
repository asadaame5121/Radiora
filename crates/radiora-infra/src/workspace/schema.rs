//! Loro layout of the workspace document: schema v1 of
//! `docs/design/v3-legacy-import-mapping.md` §3, shared with the Legacy Importer (#384).
//!
//! - Map `meta`: `schemaVersion` (the version below) and `workspaceId` (UUIDv7).
//! - Tree `blocks`: one node per Block; a node without a parent is a Topic root, in order.
//!   Each node's metadata holds `id` (logical UUIDv7, distinct from the Loro TreeID),
//!   `kind` and, for `kind = "block"`, the body as the LoroText `text`.
//!
//! Stage B writes only `kind = "block"`. Reference items (`kind = "reference"`, `target`,
//! `heading`), `aliases`, `trash`, `legacy`, `relations`, `relationTypes` and `deletedIds`
//! are not written yet; a node of another kind is reported as unsupported, not guessed.
//! These names never cross the IPC boundary; callers only see `BlockView`.

use super::error::{Result, WorkspaceError};
use loro::{
    Container, LoroDoc, LoroText, LoroTree, LoroValue, TreeID, TreeParentId, ValueOrContainer,
};
use radiora_core::app::{BlockView, WorkspaceView};
use radiora_core::model::BlockId;
use uuid::Uuid;

pub(super) const DOC_SCHEMA_VERSION: i64 = 1;
const META: &str = "meta";
const META_SCHEMA_VERSION: &str = "schemaVersion";
const META_WORKSPACE_ID: &str = "workspaceId";
const TREE: &str = "blocks";
const NODE_ID: &str = "id";
const NODE_KIND: &str = "kind";
const NODE_TEXT: &str = "text";
const KIND_BLOCK: &str = "block";
const KIND_REFERENCE: &str = "reference";

/// Writes the schema marker and a new workspace ID into a fresh document and commits it.
pub(super) fn initialize(doc: &LoroDoc) -> Result<()> {
    let meta = doc.get_map(META);
    meta.insert(META_SCHEMA_VERSION, DOC_SCHEMA_VERSION)?;
    meta.insert(META_WORKSPACE_ID, Uuid::now_v7().to_string())?;
    doc.commit();
    Ok(())
}

/// Rejects a restored document written with another schema.
pub(super) fn check(doc: &LoroDoc) -> Result<()> {
    match doc
        .get_map(META)
        .get(META_SCHEMA_VERSION)
        .map(|value| value.get_deep_value())
    {
        Some(LoroValue::I64(version)) if version == DOC_SCHEMA_VERSION => Ok(()),
        other => Err(WorkspaceError::SchemaMismatch {
            found: format!("document schema {other:?}"),
            expected: DOC_SCHEMA_VERSION,
        }),
    }
}

/// Tree state that Loro keeps only in memory; call it after every open.
pub(super) fn prepare(doc: &LoroDoc) {
    tree(doc).enable_fractional_index(0);
}

pub(super) fn tree(doc: &LoroDoc) -> LoroTree {
    doc.get_tree(TREE)
}

/// Finds the node of a Block. With `include_deleted`, nodes in Loro's deleted state count too,
/// so that a logical ID is never reused.
pub(super) fn find(tree: &LoroTree, id: BlockId, include_deleted: bool) -> Result<Option<TreeID>> {
    for node in tree.get_nodes(include_deleted) {
        if block_id_of(tree, node.id)? == id {
            return Ok(Some(node.id));
        }
    }
    Ok(None)
}

/// Creates an empty Topic root at the end of the document order.
pub(super) fn create_document(doc: &LoroDoc, id: BlockId) -> Result<()> {
    let tree = tree(doc);
    let node = tree.create(TreeParentId::Root)?;
    let meta = tree.get_meta(node)?;
    meta.insert(NODE_ID, id.to_string())?;
    meta.insert(NODE_KIND, KIND_BLOCK)?;
    meta.insert_container(NODE_TEXT, LoroText::new())?;
    Ok(())
}

/// `true` for `kind = "block"`, `false` for a reference item; other kinds are not guessed.
pub(super) fn owns_body(tree: &LoroTree, node: TreeID) -> Result<bool> {
    match tree.get_meta(node)?.get(NODE_KIND) {
        Some(ValueOrContainer::Value(LoroValue::String(kind))) if kind.as_str() == KIND_BLOCK => {
            Ok(true)
        }
        Some(ValueOrContainer::Value(LoroValue::String(kind)))
            if kind.as_str() == KIND_REFERENCE =>
        {
            Ok(false)
        }
        other => Err(WorkspaceError::Corrupt(format!(
            "tree node {node} has an unsupported kind ({other:?})"
        ))),
    }
}

/// The body text of a node; fails for a node that does not own a body. Reading a reference
/// item's target body is not implemented in stage B.
pub(super) fn body(tree: &LoroTree, node: TreeID) -> Result<LoroText> {
    if !owns_body(tree, node)? {
        return Err(WorkspaceError::Corrupt(format!(
            "tree node {node} is a reference item; showing its target body is not supported yet"
        )));
    }
    match tree.get_meta(node)?.get(NODE_TEXT) {
        Some(ValueOrContainer::Container(Container::Text(text))) => Ok(text),
        other => Err(WorkspaceError::Corrupt(format!(
            "tree node {node} has no body text ({other:?})"
        ))),
    }
}

pub(super) fn view(doc: &LoroDoc, version: u64) -> Result<WorkspaceView> {
    let tree = tree(doc);
    let mut blocks = Vec::new();
    walk(&tree, TreeParentId::Root, None, &mut blocks)?;
    Ok(WorkspaceView { version, blocks })
}

fn walk(
    tree: &LoroTree,
    parent: TreeParentId,
    parent_id: Option<BlockId>,
    out: &mut Vec<BlockView>,
) -> Result<()> {
    for (index, node) in tree
        .children(parent)
        .unwrap_or_default()
        .into_iter()
        .enumerate()
    {
        let id = block_id_of(tree, node)?;
        out.push(BlockView {
            id,
            parent: parent_id,
            index,
            body: body(tree, node)?.to_string(),
        });
        walk(tree, TreeParentId::Node(node), Some(id), out)?;
    }
    Ok(())
}

fn block_id_of(tree: &LoroTree, node: TreeID) -> Result<BlockId> {
    match tree.get_meta(node)?.get(NODE_ID) {
        Some(ValueOrContainer::Value(LoroValue::String(text))) => Ok(text.parse()?),
        other => Err(WorkspaceError::Corrupt(format!(
            "tree node {node} has no logical id ({other:?})"
        ))),
    }
}
