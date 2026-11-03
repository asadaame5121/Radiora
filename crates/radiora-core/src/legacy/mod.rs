//! v2 persisted payloads only; no I/O and no v3 conversion policy.
mod historical;
mod scalars;
mod types;
pub use historical::{HistoricalDate, HistoricalTime};
pub use scalars::{Id, Instant, Number, RelationName};
use serde::{Deserialize, Deserializer};
pub use types::*;

pub const RECORD_TABLES: [&str; 17] = [
    "work",
    "branch",
    "working_copy",
    "revision",
    "recovery_snapshot",
    "occurrence",
    "semantic_link",
    "system_relation",
    "knot",
    "search_alias",
    "emergence_feedback",
    "emergence_suggestion",
    "saved_rule_query",
    "purge_manifest",
    "bookmark",
    "resume_position",
    "relation_type_definition",
];
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid legacy {table} record {id}: {reason}")]
pub struct RecordError {
    pub table: String,
    pub id: String,
    pub reason: String,
}
#[derive(Debug, Clone, PartialEq)]
pub enum Payload {
    Work(Work),
    Branch(Branch),
    WorkingCopy(WorkingCopy),
    Revision(Revision),
    RecoverySnapshot(RecoverySnapshot),
    Occurrence(Occurrence),
    SemanticLink(SemanticLink),
    SystemRelation(SystemRelation),
    Knot(Knot),
    SearchAlias(SearchAlias),
    EmergenceFeedback(EmergenceAction),
    EmergenceSuggestion(EmergenceSuggestion),
    SavedRuleQuery(SavedRuleQuery),
    PurgeManifest(PurgeManifest),
    Bookmark(Bookmark),
    ResumePosition(ResumePosition),
    RelationTypeDefinition(RelationTypeDefinition),
}
impl Payload {
    fn identity(&self) -> Option<&str> {
        match self {
            Self::Work(v) => Some(&v.id.0),
            Self::Branch(v) => Some(&v.id.0),
            Self::WorkingCopy(v) => Some(&v.branch_id.0),
            Self::Revision(v) => Some(&v.id.0),
            Self::RecoverySnapshot(v) => Some(&v.id.0),
            Self::Occurrence(v) => Some(&v.id.0),
            Self::SemanticLink(v) => Some(&v.id.0),
            Self::SystemRelation(v) => Some(&v.id.0),
            Self::Knot(v) => Some(&v.id.0),
            Self::SearchAlias(v) => Some(&v.id.0),
            Self::EmergenceSuggestion(v) => Some(&v.id.0),
            Self::SavedRuleQuery(v) => Some(&v.id.0),
            Self::PurgeManifest(v) => Some(&v.id.0),
            Self::Bookmark(v) => Some(&v.id.0),
            Self::RelationTypeDefinition(v) => Some(&v.name.0),
            Self::EmergenceFeedback(_) | Self::ResumePosition(_) => None,
        }
    }
}
pub fn validate_record(table: &str, id: &str, json: &str) -> Result<Payload, RecordError> {
    let error = |reason: String| RecordError {
        table: table.into(),
        id: id.into(),
        reason,
    };
    if id.is_empty() {
        return Err(error("empty row ID".into()));
    }
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|cause| error(cause.to_string()))?;
    let parsed = match table {
        "work" => serde_json::from_value(value).map(Payload::Work),
        "branch" => serde_json::from_value(value).map(Payload::Branch),
        "working_copy" => serde_json::from_value(value).map(Payload::WorkingCopy),
        "revision" => serde_json::from_value(value).map(Payload::Revision),
        "recovery_snapshot" => serde_json::from_value(value).map(Payload::RecoverySnapshot),
        "occurrence" => serde_json::from_value(value).map(Payload::Occurrence),
        "semantic_link" => serde_json::from_value(value).map(Payload::SemanticLink),
        "system_relation" => serde_json::from_value(value).map(Payload::SystemRelation),
        "knot" => serde_json::from_value(value).map(Payload::Knot),
        "search_alias" => serde_json::from_value(value).map(Payload::SearchAlias),
        "emergence_feedback" => serde_json::from_value(value).map(Payload::EmergenceFeedback),
        "emergence_suggestion" => serde_json::from_value(value).map(Payload::EmergenceSuggestion),
        "saved_rule_query" => serde_json::from_value(value).map(Payload::SavedRuleQuery),
        "purge_manifest" => serde_json::from_value(value).map(Payload::PurgeManifest),
        "bookmark" => serde_json::from_value(value).map(Payload::Bookmark),
        "resume_position" => serde_json::from_value(value).map(Payload::ResumePosition),
        "relation_type_definition" => {
            serde_json::from_value(value).map(Payload::RelationTypeDefinition)
        }
        _ => return Err(error("unknown record table".into())),
    }
    .map_err(|cause| error(cause.to_string()))?;
    if parsed.identity().is_some_and(|identity| identity != id) {
        return Err(error("row ID does not match payload identity".into()));
    }
    Ok(parsed)
}
// serde's Option conflates absent and null; Valibot optional does not.
fn optional<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
