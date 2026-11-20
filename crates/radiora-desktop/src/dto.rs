//! IPC DTOs of the body slice and their validation at the trust boundary.
//!
//! JSON from the WebView is untrusted: unknown fields are rejected, IDs are parsed into
//! core types, and the body size is bounded. Responses carry logical IDs and versions
//! only; no Loro type, SQL text or file path crosses this boundary.

use radiora_core::app::{
    CommandError, DocumentCommand, PlanError, Request, RequestId, Saved, WorkspaceView,
};
use radiora_core::model::BlockId;
use serde::{Deserialize, Serialize};

/// Upper bound of one body in UTF-8 bytes, so that a single IPC message stays bounded.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateDocumentArgs {
    pub request_id: String,
    pub base_version: u64,
    pub block_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateBodyArgs {
    pub request_id: String,
    pub base_version: u64,
    pub block_id: String,
    pub body: String,
}

impl CreateDocumentArgs {
    pub fn into_request(self) -> Result<Request, ErrorDto> {
        Ok(Request {
            id: request_id(&self.request_id)?,
            base: self.base_version,
            command: DocumentCommand::CreateDocument {
                id: block_id(&self.block_id)?,
            },
        })
    }
}

impl UpdateBodyArgs {
    pub fn into_request(self) -> Result<Request, ErrorDto> {
        if self.body.len() > MAX_BODY_BYTES {
            return Err(ErrorDto::invalid(format!(
                "body exceeds {MAX_BODY_BYTES} bytes"
            )));
        }
        Ok(Request {
            id: request_id(&self.request_id)?,
            base: self.base_version,
            command: DocumentCommand::UpdateBody {
                id: block_id(&self.block_id)?,
                body: self.body,
            },
        })
    }
}

fn request_id(text: &str) -> Result<RequestId, ErrorDto> {
    text.parse()
        .map_err(|error: radiora_core::app::InvalidRequestId| ErrorDto::invalid(error.to_string()))
}

fn block_id(text: &str) -> Result<BlockId, ErrorDto> {
    text.parse()
        .map_err(|error: radiora_core::model::IdError| ErrorDto::invalid(error.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDto {
    pub version: u64,
    pub replayed: bool,
}

impl From<Saved> for SavedDto {
    fn from(saved: Saved) -> Self {
        Self {
            version: saved.version,
            replayed: saved.replayed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDto {
    pub id: String,
    pub parent_id: Option<String>,
    pub index: usize,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceViewDto {
    pub version: u64,
    pub blocks: Vec<BlockDto>,
}

impl From<WorkspaceView> for WorkspaceViewDto {
    fn from(view: WorkspaceView) -> Self {
        Self {
            version: view.version,
            blocks: view
                .blocks
                .into_iter()
                .map(|block| BlockDto {
                    id: block.id.to_string(),
                    parent_id: block.parent.map(|parent| parent.to_string()),
                    index: block.index,
                    body: block.body,
                })
                .collect(),
        }
    }
}

/// Stable error kinds the frontend branches on. Messages are for display and logs only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    InvalidRequest,
    WorkspaceUnavailable,
    StaleVersion,
    RequestReused,
    PersistPending,
    PersistFailed,
    RecoveryRequired,
    NothingToRetry,
    UnknownBlock,
    DuplicateBlock,
    NoBody,
    Storage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDto {
    pub kind: ErrorKind,
    pub message: String,
    /// The durable version, for `stale_version`.
    pub current_version: Option<u64>,
}

impl ErrorDto {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            current_version: None,
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidRequest, message)
    }
}

impl From<CommandError> for ErrorDto {
    /// Storage causes are logged by the host; only a generic message crosses IPC.
    fn from(error: CommandError) -> Self {
        let kind = match &error {
            CommandError::Plan(PlanError::UnknownBlock(_)) => ErrorKind::UnknownBlock,
            CommandError::Plan(PlanError::DuplicateBlock(_)) => ErrorKind::DuplicateBlock,
            CommandError::Plan(PlanError::NoBody(_)) => ErrorKind::NoBody,
            CommandError::StaleVersion { current, .. } => {
                return Self {
                    current_version: Some(*current),
                    ..Self::new(ErrorKind::StaleVersion, error.to_string())
                };
            }
            CommandError::RequestReused(_) => ErrorKind::RequestReused,
            CommandError::PersistPending => ErrorKind::PersistPending,
            CommandError::RecoveryRequired => ErrorKind::RecoveryRequired,
            CommandError::NothingToRetry => ErrorKind::NothingToRetry,
            CommandError::Persist(_) => {
                return Self::new(
                    ErrorKind::PersistFailed,
                    "保存に失敗しました。入力は保持されています。再試行してください。",
                );
            }
            CommandError::Store(_) => {
                return Self::new(
                    ErrorKind::Storage,
                    "ワークスペースの読み書きに失敗しました。",
                );
            }
        };
        Self::new(kind, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOCK: &str = "0190a6e0-0000-7000-8000-000000000001";
    const REQUEST: &str = "6f0c1d3e-5b2a-4c8e-9f10-123456789abc";

    fn update(json: &str) -> Result<UpdateBodyArgs, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn a_valid_update_becomes_a_core_request() {
        let args = update(&format!(
            r#"{{"requestId":"{REQUEST}","baseVersion":3,"blockId":"{BLOCK}","body":"本文"}}"#
        ))
        .expect("valid JSON");
        let request = args.into_request().expect("valid request");
        assert_eq!(request.base, 3);
        assert_eq!(request.id.to_string(), REQUEST);
        assert_eq!(
            request.command,
            DocumentCommand::UpdateBody {
                id: BLOCK.parse().expect("block"),
                body: "本文".into()
            }
        );
    }

    #[test]
    fn unknown_fields_and_wrong_types_are_rejected() {
        assert!(
            update(&format!(
                r#"{{"requestId":"{REQUEST}","baseVersion":3,"blockId":"{BLOCK}","body":"x","path":"C:/"}}"#
            ))
            .is_err()
        );
        assert!(
            update(&format!(
                r#"{{"requestId":"{REQUEST}","baseVersion":-1,"blockId":"{BLOCK}","body":"x"}}"#
            ))
            .is_err()
        );
        assert!(update(r#"{"requestId":"x","baseVersion":1,"blockId":"y"}"#).is_err());
    }

    #[test]
    fn malformed_ids_and_oversized_bodies_are_invalid_requests() {
        let cases = [
            ("not-a-uuid", BLOCK, "x".to_owned()),
            // A UUIDv4 is not a logical Block ID.
            (REQUEST, REQUEST, "x".to_owned()),
            (REQUEST, BLOCK, "x".repeat(MAX_BODY_BYTES + 1)),
        ];
        for (request_id, block_id, body) in cases {
            let args = UpdateBodyArgs {
                request_id: request_id.into(),
                base_version: 0,
                block_id: block_id.into(),
                body,
            };
            let error = args.into_request().unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidRequest);
        }
    }

    #[test]
    fn errors_serialize_with_stable_kinds() {
        let stale = ErrorDto::from(CommandError::StaleVersion {
            base: 1,
            current: 4,
        });
        assert_eq!(
            serde_json::to_value(&stale).expect("json"),
            serde_json::json!({
                "kind": "stale_version",
                "message": "the workspace changed since version 1 (now 4)",
                "currentVersion": 4
            })
        );
        assert_eq!(
            ErrorDto::from(CommandError::PersistPending).kind,
            ErrorKind::PersistPending
        );
    }
}
