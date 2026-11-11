//! Typed Relations between logical Block IDs and their type definitions.
//!
//! Endpoints may be Topic roots, ordinary Blocks or reference items. A Relation to a reference
//! item belongs to that item and is never re-targeted to the body owner. Internal body links are
//! a separate feature and are never converted into Relations.
mod projection;

pub use projection::{
    CardEdge, CardPair, EndpointState, Excluded, ExclusionReason, Lineage, TopicProjection,
    lineage, project_to_topics,
};

use super::id::{BlockId, RelationId};
use std::collections::BTreeMap;
use std::fmt;

/// Canonical upper-case type name: `^[A-Z][A-Z0-9_]{0,63}$`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RelationTypeName(String);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RelationTypeError {
    #[error(
        "relation type name must match ^[A-Z][A-Z0-9_]{{0,63}}$ after trim/uppercase: {input:?}"
    )]
    InvalidName { input: String },
    #[error("relation type {name} conflicts with a built-in type")]
    ConflictsWithBuiltIn { name: RelationTypeName },
    #[error("relation type {name} is defined more than once")]
    Duplicate { name: RelationTypeName },
    #[error("built-in relation type {name} is missing")]
    MissingBuiltIn { name: RelationTypeName },
    #[error("built-in relation type {name} has non-standard attributes")]
    AlteredBuiltIn { name: RelationTypeName },
    #[error("custom relation type {name} is marked built-in")]
    CustomMarkedBuiltIn { name: RelationTypeName },
}

impl RelationTypeName {
    /// Trims and upper-cases user input, then validates the canonical pattern.
    pub fn normalize(input: &str) -> Result<Self, RelationTypeError> {
        let candidate = input.trim().to_uppercase();
        let bytes = candidate.as_bytes();
        let valid = !bytes.is_empty()
            && bytes.len() <= 64
            && bytes[0].is_ascii_uppercase()
            && bytes
                .iter()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || *b == b'_');
        if valid {
            Ok(Self(candidate))
        } else {
            Err(RelationTypeError::InvalidName {
                input: input.to_owned(),
            })
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RelationTypeName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Direction {
    Directed,
    Symmetric,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationTypeDefinition {
    pub name: RelationTypeName,
    pub direction: Direction,
    pub built_in: bool,
    /// Relations of this type advance the lineage generation. They are stored as
    /// `derived TYPE origin` (e.g. `New FROM Old`) and displayed origin → derived.
    pub advances_generation: bool,
}

/// Built-in types carried over from v2: name, direction, advances generation.
pub const BUILT_IN_TYPES: [(&str, Direction, bool); 8] = [
    ("RELATED", Direction::Symmetric, false),
    ("FROM", Direction::Directed, true),
    ("LIKE", Direction::Symmetric, false),
    ("SUPPORT", Direction::Directed, false),
    ("DEF", Direction::Directed, false),
    ("VS", Direction::Symmetric, false),
    ("FIX", Direction::Directed, false),
    ("CITE", Direction::Directed, false),
];

fn built_in_definition(name: &str) -> Option<RelationTypeDefinition> {
    BUILT_IN_TYPES
        .iter()
        .find(|(built_in, _, _)| *built_in == name)
        .map(|(name, direction, advances)| RelationTypeDefinition {
            name: RelationTypeName((*name).to_owned()),
            direction: *direction,
            built_in: true,
            advances_generation: *advances,
        })
}

/// A validated set of type definitions: every built-in exactly as specified, unique names, and
/// custom types never marked built-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationTypes(BTreeMap<RelationTypeName, RelationTypeDefinition>);

impl RelationTypes {
    pub fn built_in() -> Self {
        Self(
            BUILT_IN_TYPES
                .iter()
                .filter_map(|(name, _, _)| built_in_definition(name))
                .map(|definition| (definition.name.clone(), definition))
                .collect(),
        )
    }

    pub fn from_definitions(
        definitions: impl IntoIterator<Item = RelationTypeDefinition>,
    ) -> Result<Self, RelationTypeError> {
        let mut map = BTreeMap::new();
        for definition in definitions {
            match built_in_definition(definition.name.as_str()) {
                Some(expected) if expected != definition => {
                    return Err(RelationTypeError::AlteredBuiltIn {
                        name: definition.name,
                    });
                }
                None if definition.built_in => {
                    return Err(RelationTypeError::CustomMarkedBuiltIn {
                        name: definition.name,
                    });
                }
                _ => {}
            }
            if map.contains_key(&definition.name) {
                return Err(RelationTypeError::Duplicate {
                    name: definition.name,
                });
            }
            map.insert(definition.name.clone(), definition);
        }
        for (name, _, _) in BUILT_IN_TYPES {
            let name = RelationTypeName(name.to_owned());
            if !map.contains_key(&name) {
                return Err(RelationTypeError::MissingBuiltIn { name });
            }
        }
        Ok(Self(map))
    }

    /// Adds a custom type. Names are compared after normalization.
    pub fn add_custom(
        &mut self,
        input: &str,
        direction: Direction,
        advances_generation: bool,
    ) -> Result<&RelationTypeDefinition, RelationTypeError> {
        let name = RelationTypeName::normalize(input)?;
        if built_in_definition(name.as_str()).is_some() {
            return Err(RelationTypeError::ConflictsWithBuiltIn { name });
        }
        if self.0.contains_key(&name) {
            return Err(RelationTypeError::Duplicate { name });
        }
        let definition = RelationTypeDefinition {
            name: name.clone(),
            direction,
            built_in: false,
            advances_generation,
        };
        Ok(self.0.entry(name).or_insert(definition))
    }

    pub fn get(&self, name: &RelationTypeName) -> Option<&RelationTypeDefinition> {
        self.0.get(name)
    }

    pub fn definitions(&self) -> impl Iterator<Item = &RelationTypeDefinition> {
        self.0.values()
    }
}

/// Whether the Relation is currently asserted. How retraction is kept long-term (record vs.
/// history only) is not decided; retracted Relations never enter projections.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationStatus {
    Asserted,
    Retracted,
}

/// A typed Relation as stored: `source TYPE target`. Layout and projections never write back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relation {
    pub id: RelationId,
    pub kind: RelationTypeName,
    pub source: BlockId,
    pub target: BlockId,
    pub status: RelationStatus,
}
