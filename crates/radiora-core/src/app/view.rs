use crate::model::BlockId;

/// One Block of the committed read model, in document preorder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockView {
    pub id: BlockId,
    pub parent: Option<BlockId>,
    /// Position among its siblings (among documents for a root Block).
    pub index: usize,
    pub body: String,
}

/// The committed state of the workspace at the durable `version`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceView {
    pub version: u64,
    pub blocks: Vec<BlockView>,
}
