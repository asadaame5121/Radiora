//! The saved (durable) read model published to callers. It never holds an unsaved value.
//!
//! Shape (#403, feat A of #385): per Topic, the root Block and its live descendants in
//! outline order. A Block either owns its body or is a reference item showing its target's
//! body. Blocks in the trash are not part of a Topic's outline; a reference item whose
//! target is in the trash or missing says so instead. No Loro, tree or graph index appears.

use crate::model::BlockId;
use std::fmt;

/// Opaque per-Block body version (#381 conflict-unit contract). It changes whenever that
/// Block's body changes, never returns to an earlier value and is unaffected by other
/// Blocks. Compare only for equality; its text has no meaning to callers.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BodyVersion(String);

impl BodyVersion {
    /// Wraps a token issued by the document adapter.
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for BodyVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A saved body with its version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BodyView {
    pub text: String,
    pub version: BodyVersion,
}

/// What a reference item's target resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetView {
    /// The target Block is live; its body is shown read-only.
    Live(BodyView),
    /// The target Block is in the trash (restorable); its body is not shown.
    Trashed,
    /// The target was purged or never resolved.
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockContent {
    /// `kind = "block"`: the Block owns its body.
    Body(BodyView),
    /// `kind = "reference"`: shows the body of `target`, which always owns a body.
    Reference {
        target: BlockId,
        /// The reference item's own heading, when it has one.
        heading: Option<String>,
        resolved: TargetView,
    },
}

/// One live Block of a Topic outline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockView {
    pub id: BlockId,
    /// `None` only for the Topic root.
    pub parent: Option<BlockId>,
    /// `0` for the Topic root.
    pub depth: usize,
    pub content: BlockContent,
}

impl BlockView {
    /// The body this Block owns; `None` for a reference item.
    pub fn own_body(&self) -> Option<&BodyView> {
        match &self.content {
            BlockContent::Body(body) => Some(body),
            BlockContent::Reference { .. } => None,
        }
    }
}

/// One Topic: `blocks[0]` is the root, followed by its live descendants in outline order
/// (preorder, children in document order).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopicView {
    pub blocks: Vec<BlockView>,
}

impl TopicView {
    pub fn root(&self) -> Option<&BlockView> {
        self.blocks.first()
    }
}

/// The saved state of the workspace. `version` is the read-model publication generation:
/// it only grows and orders responses; it is never a write precondition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceView {
    pub version: u64,
    /// Live Topics in document order.
    pub topics: Vec<TopicView>,
}

impl WorkspaceView {
    /// All Blocks of all Topics, in order.
    pub fn blocks(&self) -> impl Iterator<Item = &BlockView> {
        self.topics.iter().flat_map(|topic| topic.blocks.iter())
    }
}
