//! Application layer of the stage B body slice (#385): commands, the pure planner, the
//! document-storage port and the coordinator that drives it
//! (`docs/design/v3-c4-architecture.md` C3). No Loro, SQLite or Tauri type appears here.

mod command;
mod coordinator;
mod planner;
mod port;
mod view;

pub use command::{DocumentCommand, Fingerprint, Request, RequestId};
pub use coordinator::{CommandError, DocumentCoordinator, Saved};
pub use planner::{DocumentChange, PlanError, plan};
pub use port::{ApplyFailure, BlockPresence, DocumentStore, Receipt, StoreFailure};
pub use view::{
    BlockContent, BlockView, BodyVersion, BodyView, TargetView, TopicView, WorkspaceView,
};
