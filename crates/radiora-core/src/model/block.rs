//! Block content, presence and reference items.
//!
//! Invariants carried by the types:
//! - a purged Block keeps only its ID (`BlockRecord::Purged` has no content field);
//! - a Block in the trash keeps content, hierarchy and ID, and points at its trash entry;
//! - a reference item owns no body text; it points at the Block that owns the body.
//!
//! Invariants that need the whole workspace (no reference chains, unique root membership) are
//! checked by `resolve_reference` and the structure planners, and covered by property tests.
use super::id::{BlockId, TrashEntryId};
use std::collections::BTreeMap;

/// User-entered plain text (alias, reference-item heading). Whitespace-only values are not
/// stored; the original string is kept without normalization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlainLabel(String);

impl PlainLabel {
    /// Returns `None` for whitespace-only input, which means "unset".
    pub fn new(text: impl Into<String>) -> Option<Self> {
        let text = text.into();
        if text.trim().is_empty() {
            None
        } else {
            Some(Self(text))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Body owned by a Topic root or an ordinary Block. The display name is derived from the first
/// non-empty Markdown line, so there is no separate title field.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OwnedContent {
    pub markdown: String,
    pub aliases: Vec<PlainLabel>,
}

/// A placement that shows the body of another Block. Its own children stay independent, and its
/// heading is metadata of this placement only. It has no aliases in the first release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceItem {
    target: BlockId,
    pub heading: Option<PlainLabel>,
}

impl ReferenceItem {
    /// Creates a reference to `source`. A reference created from another reference item points
    /// directly at that item's target, so chains are never created.
    pub fn to(source: &Block) -> Self {
        Self {
            target: direct_reference_target(source),
            heading: None,
        }
    }

    /// Rebuilds a persisted reference item. Chain-freedom is a workspace invariant checked by
    /// `resolve_reference`, not by this constructor.
    pub fn from_persisted(target: BlockId, heading: Option<PlainLabel>) -> Self {
        Self { target, heading }
    }

    pub fn target(&self) -> BlockId {
        self.target
    }

    /// Applies the copy mapping: a target inside the copied set follows the copy, a target
    /// outside keeps the original. Callers issue a new ID for the copied item itself.
    pub fn remapped(&self, copies: &BTreeMap<BlockId, BlockId>) -> Self {
        Self {
            target: remap_on_copy(self.target, copies),
            heading: self.heading.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockContent {
    Owned(OwnedContent),
    Reference(ReferenceItem),
}

/// Whether a stored Block is visible or sitting in the trash. In the first release a trashed
/// subtree is not edited or moved directly; it is restored first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Live,
    Trashed(TrashEntryId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub id: BlockId,
    pub content: BlockContent,
    pub presence: Presence,
}

/// Minimal record left by a purge so that links and Relations can show "Missing".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PurgedBlock {
    pub id: BlockId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockRecord {
    Present(Block),
    Purged(PurgedBlock),
}

impl BlockRecord {
    pub fn id(&self) -> BlockId {
        match self {
            Self::Present(block) => block.id,
            Self::Purged(purged) => purged.id,
        }
    }
}

/// The Block that owns the body to reference when a reference is created from `source`.
pub fn direct_reference_target(source: &Block) -> BlockId {
    match &source.content {
        BlockContent::Owned(_) => source.id,
        BlockContent::Reference(reference) => reference.target,
    }
}

/// Copy mapping shared by reference items and internal links.
/// Example: copying B and C together maps B→C to B'→C'; copying only B keeps B'→C.
pub fn remap_on_copy(target: BlockId, copies: &BTreeMap<BlockId, BlockId>) -> BlockId {
    copies.get(&target).copied().unwrap_or(target)
}

/// What a reference item (or an internal link) shows. Trashed and Missing are displayed
/// differently: the former can still be restored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceResolution<'a> {
    Live(&'a OwnedContent),
    InTrash(TrashEntryId),
    /// Purged, or unknown to this workspace.
    Missing,
    /// The target is itself a reference item. This violates the no-chain invariant and is
    /// reported instead of being followed.
    Chained {
        via: BlockId,
    },
}

pub fn resolve_reference<'a>(
    target: BlockId,
    lookup: impl FnOnce(BlockId) -> Option<&'a BlockRecord>,
) -> ReferenceResolution<'a> {
    match lookup(target) {
        None | Some(BlockRecord::Purged(_)) => ReferenceResolution::Missing,
        Some(BlockRecord::Present(block)) => match (&block.content, block.presence) {
            (BlockContent::Reference(_), _) => ReferenceResolution::Chained { via: block.id },
            (BlockContent::Owned(_), Presence::Trashed(entry)) => {
                ReferenceResolution::InTrash(entry)
            }
            (BlockContent::Owned(content), Presence::Live) => ReferenceResolution::Live(content),
        },
    }
}
