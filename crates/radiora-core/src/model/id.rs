//! Logical identifiers. infra issues UUIDv7 values; core only validates and compares them.
//!
//! These IDs are independent of Loro `TreeID`s: they survive moves, extraction, Undo and restore.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;
use uuid::{Uuid, Variant};

/// Length of the canonical hyphenated UUID text form.
const HYPHENATED_LEN: usize = 36;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IdError {
    #[error("logical ID must be a hyphenated UUID: {text:?}")]
    NotHyphenated { text: String },
    #[error("logical ID is not a UUID: {text:?}")]
    Malformed {
        text: String,
        #[source]
        source: uuid::Error,
    },
    #[error("logical ID must be an RFC 9562 UUIDv7: {text:?}")]
    NotVersion7 { text: String },
}

fn parse_v7(text: &str) -> Result<Uuid, IdError> {
    if text.len() != HYPHENATED_LEN {
        return Err(IdError::NotHyphenated {
            text: text.to_owned(),
        });
    }
    let uuid = Uuid::try_parse(text).map_err(|source| IdError::Malformed {
        text: text.to_owned(),
        source,
    })?;
    require_v7(uuid)
}

fn require_v7(uuid: Uuid) -> Result<Uuid, IdError> {
    if uuid.get_version_num() == 7 && uuid.get_variant() == Variant::RFC4122 {
        Ok(uuid)
    } else {
        Err(IdError::NotVersion7 {
            text: uuid.hyphenated().to_string(),
        })
    }
}

macro_rules! logical_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Uuid);

        impl $name {
            /// Accepts an already issued UUID, rejecting anything other than UUIDv7.
            pub fn from_uuid(uuid: Uuid) -> Result<Self, IdError> {
                require_v7(uuid).map(Self)
            }

            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
        }

        impl FromStr for $name {
            type Err = IdError;
            fn from_str(text: &str) -> Result<Self, IdError> {
                parse_v7(text).map(Self)
            }
        }

        /// Canonical form: lowercase hyphenated.
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0.hyphenated(), f)
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.collect_str(self)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let text = String::deserialize(deserializer)?;
                text.parse().map_err(serde::de::Error::custom)
            }
        }
    };
}

logical_id!(
    /// Workspace-unique, never reused logical ID shared by Topic roots, ordinary Blocks and
    /// reference items.
    BlockId
);

logical_id!(
    /// Identifies one trash entry, i.e. one ordinary-delete operation.
    /// The UUIDv7 format is an implementation choice, not a product decision.
    TrashEntryId
);
