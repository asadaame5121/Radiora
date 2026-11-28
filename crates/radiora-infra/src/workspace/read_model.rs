//! Builds the saved read model (`WorkspaceView`) from the document: Topics in document
//! order, each with its live Blocks in outline order, reference targets resolved to a live
//! body, the trash, or Missing.
//!
//! - A node carrying a trash mark is in the trash together with its descendants; trashed
//!   Blocks are left out of every outline.
//! - A node in Loro's deleted state was purged; a target that is not found among the
//!   remaining nodes is Missing, whether it was purged or never resolved.
//! - Broken invariants (duplicate IDs, a reference root, a reference to a reference item)
//!   are reported as corruption rather than guessed around.

use super::body_version::BodyVersions;
use super::error::{Result, WorkspaceError};
use super::schema::{self, NodeKind};
use loro::{ContainerID, ContainerTrait, LoroDoc, LoroTree, TreeID, TreeParentId};
use radiora_core::app::{BlockContent, BlockView, BodyView, TargetView, TopicView, WorkspaceView};
use radiora_core::model::BlockId;
use std::collections::HashMap;

/// A node as read from the tree, before reference resolution.
struct Node {
    id: BlockId,
    parent: Option<BlockId>,
    depth: usize,
    trashed: bool,
    content: Content,
}

enum Content {
    Body {
        text: String,
        container: ContainerID,
    },
    Reference {
        target: BlockId,
        heading: Option<String>,
    },
}

pub(super) fn build(doc: &LoroDoc, versions: &BodyVersions, version: u64) -> Result<WorkspaceView> {
    let tree = schema::tree(doc);
    let mut roots = Vec::new();
    for root in tree.children(TreeParentId::Root).unwrap_or_default() {
        let mut nodes = Vec::new();
        collect(&tree, root, None, 0, false, &mut nodes)?;
        roots.push(nodes);
    }
    let index = index_by_id(&roots)?;
    let mut topics = Vec::new();
    for nodes in &roots {
        let Some(root) = nodes.first() else { continue };
        if root.trashed {
            continue;
        }
        if matches!(root.content, Content::Reference { .. }) {
            return Err(WorkspaceError::Corrupt(format!(
                "Topic root {} is a reference item",
                root.id
            )));
        }
        let blocks = nodes
            .iter()
            .filter(|node| !node.trashed)
            .map(|node| block_view(node, &index, versions))
            .collect::<Result<_>>()?;
        topics.push(TopicView { blocks });
    }
    Ok(WorkspaceView { version, topics })
}

/// Reads `node` and its subtree in preorder; `trashed` is inherited from the ancestors.
fn collect(
    tree: &LoroTree,
    node: TreeID,
    parent: Option<BlockId>,
    depth: usize,
    trashed: bool,
    out: &mut Vec<Node>,
) -> Result<()> {
    let id = schema::block_id_of(tree, node)?;
    let trashed = trashed || schema::is_trash_marked(tree, node)?;
    let content = match schema::kind(tree, node)? {
        NodeKind::Block(text) => Content::Body {
            text: text.to_string(),
            container: text.id(),
        },
        NodeKind::Reference { target, heading } => Content::Reference { target, heading },
    };
    out.push(Node {
        id,
        parent,
        depth,
        trashed,
        content,
    });
    for child in tree.children(TreeParentId::Node(node)).unwrap_or_default() {
        collect(tree, child, Some(id), depth + 1, trashed, out)?;
    }
    Ok(())
}

fn index_by_id(roots: &[Vec<Node>]) -> Result<HashMap<BlockId, &Node>> {
    let mut index = HashMap::new();
    for node in roots.iter().flatten() {
        if index.insert(node.id, node).is_some() {
            return Err(WorkspaceError::Corrupt(format!(
                "logical id {} appears on more than one node",
                node.id
            )));
        }
    }
    Ok(index)
}

fn block_view(
    node: &Node,
    index: &HashMap<BlockId, &Node>,
    versions: &BodyVersions,
) -> Result<BlockView> {
    let content = match &node.content {
        Content::Body { text, container } => BlockContent::Body(body(text, container, versions)),
        Content::Reference { target, heading } => BlockContent::Reference {
            target: *target,
            heading: heading.clone(),
            resolved: resolve(node.id, *target, index, versions)?,
        },
    };
    Ok(BlockView {
        id: node.id,
        parent: node.parent,
        depth: node.depth,
        content,
    })
}

fn resolve(
    reference: BlockId,
    target: BlockId,
    index: &HashMap<BlockId, &Node>,
    versions: &BodyVersions,
) -> Result<TargetView> {
    let Some(found) = index.get(&target) else {
        return Ok(TargetView::Missing);
    };
    match &found.content {
        Content::Reference { .. } => Err(WorkspaceError::Corrupt(format!(
            "reference item {reference} points to the reference item {target}"
        ))),
        Content::Body { .. } if found.trashed => Ok(TargetView::Trashed),
        Content::Body { text, container } => Ok(TargetView::Live(body(text, container, versions))),
    }
}

fn body(text: &str, container: &ContainerID, versions: &BodyVersions) -> BodyView {
    BodyView {
        text: text.to_owned(),
        version: versions.token(container),
    }
}
