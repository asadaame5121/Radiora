//! IPC DTOs of the saved read model (#403, feat A of #385) and their validation at the trust
//! boundary. Names and shapes are recorded in `docs/design/v3-ipc-read-model.md`.
//!
//! JSON from the WebView is untrusted: requests reject unknown fields. Responses carry
//! logical IDs, bodies, opaque body versions and the publication generation only; no Loro
//! type, TreeID, graph index, SQL text or file path crosses this boundary, and storage
//! causes stay in the logs.

use radiora_core::app::{
    BlockContent, BlockView, BodyView, CommandError, TargetView, TopicView, WorkspaceView,
};
use serde::{Deserialize, Serialize};

/// Upper bound of one body (and one reference heading) in UTF-8 bytes, so that a single
/// value in an IPC message stays bounded. Shared with the body writes of feat B.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/// The largest generation a JavaScript number represents exactly (`Number.MAX_SAFE_INTEGER`).
pub const MAX_GENERATION: u64 = (1 << 53) - 1;

/// Request of `read_saved_workspace`. It has no field yet; any field is rejected.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadSavedWorkspaceRequest {}

impl ReadSavedWorkspaceRequest {
    /// Validates the raw `request` argument; a missing argument is invalid too, so that every
    /// malformed call is answered with `invalid_request` rather than a Tauri error string.
    pub fn parse(raw: Option<serde_json::Value>) -> Result<Self, ErrorDto> {
        let raw =
            raw.ok_or_else(|| ErrorDto::invalid_request("the request argument is missing"))?;
        // serde also accepts a struct as a sequence; the contract is a JSON object only.
        if !raw.is_object() {
            return Err(ErrorDto::invalid_request("the request is not an object"));
        }
        serde_json::from_value(raw).map_err(|error| ErrorDto::invalid_request(&error.to_string()))
    }
}

/// Response of `read_saved_workspace`: the saved read model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWorkspaceDto {
    /// Read-model publication generation: only grows; orders responses so that an older one
    /// never overwrites a newer state. Never a write precondition.
    pub generation: u64,
    /// Live Topics in document order.
    pub topics: Vec<TopicDto>,
}

/// One Topic: `blocks[0]` is the root, then its live descendants in outline order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicDto {
    pub blocks: Vec<BlockRowDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRowDto {
    /// Logical Block ID (UUIDv7).
    pub id: String,
    /// `null` only for the Topic root.
    pub parent_id: Option<String>,
    /// `0` for the Topic root.
    pub depth: usize,
    #[serde(flatten)]
    pub content: BlockContentDto,
}

/// `kind` tells whether the row owns its body or shows a reference target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum BlockContentDto {
    Block {
        body: String,
        body_version: String,
    },
    Reference {
        target: TargetDto,
        heading: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDto {
    /// Logical ID of the representative Block, also when it is trashed or missing.
    pub id: String,
    #[serde(flatten)]
    pub state: TargetStateDto,
}

/// `live` carries the representative's body read-only; `trashed` (restorable) and `missing`
/// (purged or unresolved) carry no body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum TargetStateDto {
    Live { body: String, body_version: String },
    Trashed,
    Missing,
}

impl TryFrom<WorkspaceView> for SavedWorkspaceDto {
    type Error = ErrorDto;

    fn try_from(view: WorkspaceView) -> Result<Self, ErrorDto> {
        if view.version > MAX_GENERATION {
            tracing::error!(
                generation = view.version,
                "the generation exceeds a safe JavaScript number"
            );
            return Err(ErrorDto::storage());
        }
        Ok(Self {
            generation: view.version,
            topics: view
                .topics
                .into_iter()
                .map(TopicDto::try_from)
                .collect::<Result<_, _>>()?,
        })
    }
}

impl TryFrom<TopicView> for TopicDto {
    type Error = ErrorDto;

    fn try_from(topic: TopicView) -> Result<Self, ErrorDto> {
        Ok(Self {
            blocks: topic
                .blocks
                .into_iter()
                .map(BlockRowDto::try_from)
                .collect::<Result<_, _>>()?,
        })
    }
}

impl TryFrom<BlockView> for BlockRowDto {
    type Error = ErrorDto;

    fn try_from(block: BlockView) -> Result<Self, ErrorDto> {
        let id = block.id.to_string();
        let content = match block.content {
            BlockContent::Body(body) => {
                let (body, body_version) = bounded_body(&id, body)?;
                BlockContentDto::Block { body, body_version }
            }
            BlockContent::Reference {
                target,
                heading,
                resolved,
            } => {
                if heading
                    .as_ref()
                    .is_some_and(|text| text.len() > MAX_BODY_BYTES)
                {
                    return Err(ErrorDto::body_too_large(&id));
                }
                let state = match resolved {
                    TargetView::Live(body) => {
                        let (body, body_version) = bounded_body(&id, body)?;
                        TargetStateDto::Live { body, body_version }
                    }
                    TargetView::Trashed => TargetStateDto::Trashed,
                    TargetView::Missing => TargetStateDto::Missing,
                };
                BlockContentDto::Reference {
                    target: TargetDto {
                        id: target.to_string(),
                        state,
                    },
                    heading,
                }
            }
        };
        Ok(Self {
            id,
            parent_id: block.parent.map(|parent| parent.to_string()),
            depth: block.depth,
            content,
        })
    }
}

fn bounded_body(row: &str, body: BodyView) -> Result<(String, String), ErrorDto> {
    if body.text.len() > MAX_BODY_BYTES {
        return Err(ErrorDto::body_too_large(row));
    }
    Ok((body.text, body.version.as_str().to_owned()))
}

/// Stable error kinds the frontend branches on. Messages are for display only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The request failed validation.
    InvalidRequest,
    /// The workspace could not be opened in this process.
    WorkspaceUnavailable,
    /// A write is running; read again after it settles. Reads never wait for it.
    Busy,
    /// An applied change is not durable yet; the saved read model is withheld until it is.
    PersistPending,
    /// The workspace must be reopened.
    RecoveryRequired,
    /// A body or heading exceeds `MAX_BODY_BYTES`.
    BodyTooLarge,
    /// Reading the workspace failed.
    Storage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDto {
    pub kind: ErrorKind,
    pub message: String,
    /// The logical Block ID the error is about (`body_too_large`), otherwise `null`.
    pub block_id: Option<String>,
}

impl ErrorDto {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            block_id: None,
        }
    }

    /// The validation detail goes to the log only.
    pub fn invalid_request(detail: &str) -> Self {
        tracing::debug!(detail, "refused an invalid request");
        Self::new(ErrorKind::InvalidRequest, "要求の形式が正しくありません。")
    }

    pub fn storage() -> Self {
        Self::new(ErrorKind::Storage, "ワークスペースを読み込めませんでした。")
    }

    pub fn busy() -> Self {
        Self::new(
            ErrorKind::Busy,
            "保存中のため読み込めませんでした。保存の完了後に再読込してください。",
        )
    }

    fn body_too_large(block_id: &str) -> Self {
        Self {
            block_id: Some(block_id.to_owned()),
            ..Self::new(
                ErrorKind::BodyTooLarge,
                format!("本文が上限（{MAX_BODY_BYTES} bytes）を超えているため表示できません。"),
            )
        }
    }

    /// Maps a refused read of the coordinator. The cause is logged by the caller.
    pub fn from_read(error: &CommandError) -> Self {
        match error {
            CommandError::PersistPending => Self::new(
                ErrorKind::PersistPending,
                "保存されていない変更があるため読み込めませんでした。保存の再試行後に再読込してください。",
            ),
            CommandError::RecoveryRequired => Self::new(
                ErrorKind::RecoveryRequired,
                "ワークスペースを開き直す必要があります。アプリを再起動してください。",
            ),
            CommandError::Store(_)
            | CommandError::Persist(_)
            | CommandError::Plan(_)
            | CommandError::StaleVersion { .. }
            | CommandError::RequestReused(_)
            | CommandError::NothingToRetry => Self::storage(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use radiora_core::app::{BodyVersion, StoreFailure};
    use radiora_core::model::BlockId;
    use serde_json::json;

    const ROOT: &str = "0190a6e0-0000-7000-8000-000000000001";
    const CHILD: &str = "0190a6e0-0000-7000-8000-000000000002";
    const LIVE_REF: &str = "0190a6e0-0000-7000-8000-000000000003";
    const TRASHED_REF: &str = "0190a6e0-0000-7000-8000-000000000004";
    const MISSING_REF: &str = "0190a6e0-0000-7000-8000-000000000005";
    const TRASHED: &str = "0190a6e0-0000-7000-8000-000000000006";
    const MISSING: &str = "0190a6e0-0000-7000-8000-000000000007";

    fn id(text: &str) -> BlockId {
        text.parse().expect("fixed UUIDv7")
    }

    fn body(text: &str, version: &str) -> BodyView {
        BodyView {
            text: text.into(),
            version: BodyVersion::new(version),
        }
    }

    fn row(own: &str, parent: Option<&str>, depth: usize, content: BlockContent) -> BlockView {
        BlockView {
            id: id(own),
            parent: parent.map(id),
            depth,
            content,
        }
    }

    fn reference(target: &str, heading: Option<&str>, resolved: TargetView) -> BlockContent {
        BlockContent::Reference {
            target: id(target),
            heading: heading.map(Into::into),
            resolved,
        }
    }

    fn sample() -> WorkspaceView {
        WorkspaceView {
            version: 7,
            topics: vec![TopicView {
                blocks: vec![
                    row(
                        ROOT,
                        None,
                        0,
                        BlockContent::Body(body("根\r\n🌱", "v-root")),
                    ),
                    row(
                        CHILD,
                        Some(ROOT),
                        1,
                        BlockContent::Body(body("子", "v-child")),
                    ),
                    row(
                        LIVE_REF,
                        Some(CHILD),
                        2,
                        reference(
                            CHILD,
                            Some("見出し"),
                            TargetView::Live(body("子", "v-child")),
                        ),
                    ),
                    row(
                        TRASHED_REF,
                        Some(ROOT),
                        1,
                        reference(TRASHED, None, TargetView::Trashed),
                    ),
                    row(
                        MISSING_REF,
                        Some(ROOT),
                        1,
                        reference(MISSING, None, TargetView::Missing),
                    ),
                ],
            }],
        }
    }

    /// The contract recorded in `docs/design/v3-ipc-read-model.md`.
    #[test]
    fn the_saved_workspace_serializes_to_the_recorded_shape() {
        let dto = SavedWorkspaceDto::try_from(sample()).expect("within limits");
        assert_eq!(
            serde_json::to_value(&dto).expect("json"),
            json!({
                "generation": 7,
                "topics": [{
                    "blocks": [
                        {"id": ROOT, "parentId": null, "depth": 0,
                         "kind": "block", "body": "根\r\n🌱", "bodyVersion": "v-root"},
                        {"id": CHILD, "parentId": ROOT, "depth": 1,
                         "kind": "block", "body": "子", "bodyVersion": "v-child"},
                        {"id": LIVE_REF, "parentId": CHILD, "depth": 2,
                         "kind": "reference", "heading": "見出し",
                         "target": {"id": CHILD, "state": "live",
                                    "body": "子", "bodyVersion": "v-child"}},
                        {"id": TRASHED_REF, "parentId": ROOT, "depth": 1,
                         "kind": "reference", "heading": null,
                         "target": {"id": TRASHED, "state": "trashed"}},
                        {"id": MISSING_REF, "parentId": ROOT, "depth": 1,
                         "kind": "reference", "heading": null,
                         "target": {"id": MISSING, "state": "missing"}}
                    ]
                }]
            })
        );
    }

    #[test]
    fn the_request_is_an_empty_object_and_rejects_unknown_fields() {
        let parse = |raw: Option<serde_json::Value>| ReadSavedWorkspaceRequest::parse(raw);
        assert!(parse(Some(json!({}))).is_ok());
        for raw in [
            None,
            Some(json!({"path": "C:/Users"})),
            Some(json!({"topicId": ROOT})),
            Some(json!(null)),
            Some(json!([])),
        ] {
            let error = parse(raw).expect_err("invalid");
            assert_eq!(error.kind, ErrorKind::InvalidRequest);
            assert!(!error.message.contains("C:/"), "no echo of the input");
        }
    }

    #[test]
    fn bodies_and_headings_over_the_limit_are_refused_with_their_block() {
        let at_limit = "a".repeat(MAX_BODY_BYTES);
        let over = "あ".repeat(MAX_BODY_BYTES / 3 + 1);
        assert!(over.len() > MAX_BODY_BYTES && over.chars().count() < MAX_BODY_BYTES);
        let cases = [
            (BlockContent::Body(body(&at_limit, "v")), None),
            (BlockContent::Body(body(&over, "v")), Some(ROOT)),
            (
                reference(CHILD, None, TargetView::Live(body(&over, "v"))),
                Some(ROOT),
            ),
            (
                reference(CHILD, Some(&over), TargetView::Missing),
                Some(ROOT),
            ),
        ];
        for (content, refused) in cases {
            let result = BlockRowDto::try_from(row(ROOT, None, 0, content));
            match refused {
                None => assert!(result.is_ok()),
                Some(block) => {
                    let error = result.expect_err("over the limit");
                    assert_eq!(error.kind, ErrorKind::BodyTooLarge);
                    assert_eq!(error.block_id.as_deref(), Some(block));
                }
            }
        }
    }

    #[test]
    fn the_generation_stays_within_a_safe_javascript_number() {
        let mut view = sample();
        view.version = MAX_GENERATION;
        assert!(SavedWorkspaceDto::try_from(view.clone()).is_ok());
        view.version = MAX_GENERATION + 1;
        let error = SavedWorkspaceDto::try_from(view).expect_err("unsafe");
        assert_eq!(error.kind, ErrorKind::Storage);
    }

    #[test]
    fn error_kinds_are_stable_and_carry_no_storage_detail() {
        let kinds = [
            (ErrorKind::InvalidRequest, "invalid_request"),
            (ErrorKind::WorkspaceUnavailable, "workspace_unavailable"),
            (ErrorKind::Busy, "busy"),
            (ErrorKind::PersistPending, "persist_pending"),
            (ErrorKind::RecoveryRequired, "recovery_required"),
            (ErrorKind::BodyTooLarge, "body_too_large"),
            (ErrorKind::Storage, "storage"),
        ];
        for (kind, text) in kinds {
            assert_eq!(serde_json::to_value(kind).expect("json"), json!(text));
        }
        assert_eq!(
            ErrorDto::from_read(&CommandError::PersistPending).kind,
            ErrorKind::PersistPending
        );
        assert_eq!(
            ErrorDto::from_read(&CommandError::RecoveryRequired).kind,
            ErrorKind::RecoveryRequired
        );
        let cause = std::io::Error::other("SELECT * FROM updates at C:\\data\\workspace.db");
        let storage = ErrorDto::from_read(&CommandError::Store(StoreFailure::new(cause)));
        assert_eq!(
            serde_json::to_value(&storage).expect("json"),
            json!({
                "kind": "storage",
                "message": "ワークスペースを読み込めませんでした。",
                "blockId": null
            })
        );
    }
}
