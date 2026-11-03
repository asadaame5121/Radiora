use super::{HistoricalTime, Id, Instant, Number, RelationName, nullable, optional};
use serde::{Deserialize, Serialize};

macro_rules! choices {
    ($name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $text)] $variant),+ }
    };
}
choices!(RevisionKind { Checkpoint=>"checkpoint", Edition=>"edition", Merge=>"merge" });
choices!(LinkStatus { Provisional=>"provisional", Asserted=>"asserted", Retracted=>"retracted" });
choices!(LinkOrigin { Human=>"human", Suggestion=>"suggestion", Import=>"import", Derived=>"derived" });
choices!(StubCreationKind { StubList=>"stub-list", AdvancedLinkEditor=>"advanced-link-editor" });
choices!(ProtectionReason { User=>"user", Import=>"import", SchemaMigration=>"schema-migration", RevisionSource=>"revision-source" });
choices!(SystemRelationType { In=>"IN" });
choices!(EmergenceKind { LatentRelation=>"latent-relation", CrossBranchResonance=>"cross-branch-resonance", ProductiveTension=>"productive-tension" });
choices!(EmergenceAction { Accept=>"accept", Dismiss=>"dismiss", Pin=>"pin" });
choices!(EmergenceStatus { Pending=>"pending", Accepted=>"accepted", Dismissed=>"dismissed", Held=>"held" });
choices!(Pinned { Pinned=>"pinned" });
choices!(Direction { Directed=>"directed", Symmetric=>"symmetric" });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkStub {
    pub created_at: Instant,
    pub created_via: StubCreationKind,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub context: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: Id,
    pub created_at: Instant,
    pub updated_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub historical_time: Option<HistoricalTime>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub deleted_at: Option<Instant>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub stub: Option<WorkStub>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub merged_into_work_id: Option<Id>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub merged_at: Option<Instant>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub id: Id,
    pub work_id: Id,
    pub name: String,
    #[serde(deserialize_with = "nullable")]
    pub head_revision_id: Option<Id>,
    pub created_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub promoted_at: Option<Instant>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub archived_at: Option<Instant>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingCopy {
    pub branch_id: Id,
    pub work_id: Id,
    pub text: String,
    pub updated_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: Id,
    pub work_id: Id,
    pub text: String,
    pub parent_revision_ids: Vec<Id>,
    pub kind: RevisionKind,
    pub created_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub message: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProtection {
    pub reason: ProtectionReason,
    pub protected_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub expires_at: Option<Instant>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub id: Id,
    pub work_id: Id,
    pub branch_id: Id,
    pub text: String,
    pub content_hash: String,
    pub created_at: Instant,
    #[serde(deserialize_with = "nullable")]
    pub source_revision_id: Option<Id>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub name: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub protection: Option<SnapshotProtection>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum RevisionSelector {
    Branch {
        #[serde(rename = "branchId")]
        branch_id: Id,
    },
    Pinned {
        #[serde(rename = "revisionId")]
        revision_id: Id,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub id: Id,
    pub work_id: Id,
    #[serde(deserialize_with = "nullable")]
    pub parent_occurrence_id: Option<Id>,
    pub order_key: Number,
    pub collapsed: bool,
    pub revision_selector: RevisionSelector,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub contextual_heading: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "lowercase")]
pub enum LinkEndpoint {
    Work {
        #[serde(rename = "workId")]
        work_id: Id,
    },
    Revision {
        #[serde(rename = "workId")]
        work_id: Id,
        #[serde(rename = "revisionId")]
        revision_id: Id,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLink {
    pub id: Id,
    pub from_id: Id,
    pub to_id: Id,
    pub from: LinkEndpoint,
    pub to: LinkEndpoint,
    pub r#type: RelationName,
    pub status: LinkStatus,
    pub origin: LinkOrigin,
    pub created_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub reason: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemRelation {
    pub id: Id,
    pub from_work_id: Id,
    pub to_work_id: Id,
    pub r#type: SystemRelationType,
    pub created_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Knot {
    pub id: Id,
    pub cycle_ids: Vec<Id>,
    pub created_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchAlias {
    pub id: Id,
    pub canonical: String,
    pub variants: Vec<String>,
    pub created_at: Instant,
    pub updated_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceStep {
    pub from_id: Id,
    pub to_id: Id,
    pub relation: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmergenceSuggestion {
    pub id: Id,
    pub kind: EmergenceKind,
    pub context_work_id: Id,
    pub target_work_id: Id,
    pub context_item_id: Id,
    pub target_item_id: Id,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub proposed_link_type: Option<RelationName>,
    pub title: String,
    pub explanation: String,
    pub evidence: Vec<EvidenceStep>,
    pub score: Number,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<Pinned>,
    pub persistence_status: EmergenceStatus,
    pub created_at: Instant,
    pub updated_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub resolved_at: Option<Instant>,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub resolution_reason: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRuleQuery {
    pub id: Id,
    pub name: String,
    pub source: String,
    pub created_at: Instant,
    pub updated_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeManifest {
    pub id: Id,
    pub work_id: Id,
    pub occurrence_ids: Vec<Id>,
    pub branch_ids: Vec<Id>,
    pub revision_ids: Vec<Id>,
    pub link_ids: Vec<Id>,
    pub purged_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: Id,
    pub work_id: Id,
    pub occurrence_id: Id,
    pub created_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumePosition {
    pub work_id: Id,
    pub occurrence_id: Id,
    pub caret_offset: Number,
    pub updated_at: Instant,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationTypeDefinition {
    pub name: RelationName,
    pub direction: Direction,
    pub built_in: bool,
    pub created_at: Instant,
    #[serde(
        default,
        deserialize_with = "optional",
        skip_serializing_if = "Option::is_none"
    )]
    pub advances_generation: Option<bool>,
}
