use crate::model::BlockId;
use std::fmt;
use uuid::Uuid;

/// Client-issued identity of one request, used only to recognise a resent request.
/// Any UUID version is accepted; it is not a logical ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RequestId(Uuid);

impl RequestId {
    pub fn new(uuid: Uuid) -> Self {
        Self(uuid)
    }

    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for RequestId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.hyphenated().fmt(f)
    }
}

/// Document commands of the stage B body slice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentCommand {
    /// Append an empty Topic root with an ID issued by the caller.
    CreateDocument { id: BlockId },
    /// Replace the body of a Block that owns one.
    UpdateBody { id: BlockId, body: String },
}

impl DocumentCommand {
    /// The Block the command reads or creates.
    pub fn target(&self) -> BlockId {
        match self {
            Self::CreateDocument { id } | Self::UpdateBody { id, .. } => *id,
        }
    }
}

/// One mutation request: identity, the durable version the caller based it on, and the command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub id: RequestId,
    pub base: u64,
    pub command: DocumentCommand,
}

impl Request {
    /// Canonical encoding of everything the request asks for. Two requests with the same ID
    /// are the same request only when their fingerprints are equal.
    pub fn fingerprint(&self) -> Fingerprint {
        let base = self.base.to_string();
        match &self.command {
            DocumentCommand::CreateDocument { id } => {
                Fingerprint::of(&["create_document", &base, &id.to_string()])
            }
            DocumentCommand::UpdateBody { id, body } => {
                Fingerprint::of(&["update_body", &base, &id.to_string(), body])
            }
        }
    }
}

/// Length-prefixed fields, so that no two field lists share an encoding.
/// Storage may keep a digest of it instead of the bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint(Vec<u8>);

impl Fingerprint {
    fn of(fields: &[&str]) -> Self {
        let mut bytes = Vec::new();
        for field in fields {
            bytes.extend_from_slice(&(field.len() as u64).to_le_bytes());
            bytes.extend_from_slice(field.as_bytes());
        }
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}
