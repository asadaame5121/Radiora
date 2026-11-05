//! v3 document model types derived from `docs/design/v3-model-decisions.md` (#381).
//!
//! Independent of the v2 payloads in `crate::legacy`, and of Loro/SQLite/Tauri types.
mod block;
mod id;
mod link;
mod trash;

pub use block::{
    Block, BlockContent, BlockRecord, OwnedContent, PlainLabel, Presence, PurgedBlock,
    ReferenceItem, ReferenceResolution, direct_reference_target, remap_on_copy, resolve_reference,
};
pub use id::{BlockId, IdError, TrashEntryId};
pub use link::{BLOCK_LINK_PREFIX, LinkError, block_link_url, parse_block_link_url};
pub use trash::{
    OriginalPlacement, PlacementObservation, RestorePlan, TrashEntry, TrashEntryError,
    collect_newly_deleted, plan_restore, purge_targets,
};
