//! v3 document model types derived from `docs/design/v3-model-decisions.md` (#381).
//!
//! Independent of the v2 payloads in `crate::legacy`, and of Loro/SQLite/Tauri types.
mod block;
mod id;
mod link;
mod markdown_links;
mod naming;
mod outline;
mod relation;
mod trash;

pub use block::{
    Block, BlockContent, BlockRecord, OwnedContent, PlainLabel, Presence, PurgedBlock,
    ReferenceItem, ReferenceResolution, direct_reference_target, remap_on_copy, resolve_reference,
};
pub use id::{BlockId, IdError, RelationId, TrashEntryId};
pub use link::{BLOCK_LINK_PREFIX, LinkError, block_link_url, parse_block_link_url};
pub use markdown_links::{InternalLink, internal_links, linked_targets, remap_internal_links};
pub use naming::{add_alias, display_name, search_key};
pub use outline::{InvariantViolation, Membership, Outline, Slot, StructureError};
pub use relation::{
    BUILT_IN_TYPES, CardEdge, CardPair, Direction, EndpointState, Excluded, ExclusionReason,
    Lineage, Relation, RelationStatus, RelationTypeDefinition, RelationTypeError, RelationTypeName,
    RelationTypes, TopicProjection, lineage, project_to_topics,
};
pub use trash::{
    OriginalPlacement, PlacementObservation, RestorePlan, TrashEntry, TrashEntryError,
    collect_newly_deleted, plan_restore, purge_targets,
};
