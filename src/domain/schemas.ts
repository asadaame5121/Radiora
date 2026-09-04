import * as v from "valibot";
import { CreatedAtSchema, RelationTypeNameSchema } from "./relation_type.ts";

export const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const UuidSchema = v.pipe(
	v.string("Expected value to be a string"),
	v.regex(UUID_PATTERN, "Expected value to be a valid UUID"),
);

export const RevisionKindSchema = v.picklist(["checkpoint", "edition", "merge"]);
export const LinkStatusSchema = v.picklist(["provisional", "asserted", "retracted"]);
export const PersistedLinkOriginSchema = v.picklist(["human", "suggestion", "import"]);
export const LinkOriginSchema = v.picklist(["human", "suggestion", "import", "derived"]);
export const StubCreationKindSchema = v.picklist(["stub-list", "advanced-link-editor"]);

export const WorkStubSchema = v.object({
	createdAt: CreatedAtSchema,
	createdVia: StubCreationKindSchema,
	context: v.optional(v.string()),
});

export const WorkSchema = v.object({
	id: UuidSchema,
	createdAt: CreatedAtSchema,
	updatedAt: CreatedAtSchema,
	deletedAt: v.optional(CreatedAtSchema),
	stub: v.optional(WorkStubSchema),
	mergedIntoWorkId: v.optional(UuidSchema),
	mergedAt: v.optional(CreatedAtSchema),
});

export const BranchSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	name: v.string(),
	headRevisionId: v.nullable(UuidSchema),
	createdAt: CreatedAtSchema,
	promotedAt: v.optional(CreatedAtSchema),
	archivedAt: v.optional(CreatedAtSchema),
});

export const WorkingCopySchema = v.object({
	branchId: UuidSchema,
	workId: UuidSchema,
	text: v.string(),
	updatedAt: CreatedAtSchema,
});

export const RevisionSelectorSchema = v.variant("mode", [
	v.object({ mode: v.literal("branch"), branchId: UuidSchema }),
	v.object({ mode: v.literal("pinned"), revisionId: UuidSchema }),
]);

export const OccurrenceSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	parentOccurrenceId: v.nullable(UuidSchema),
	orderKey: v.number(),
	collapsed: v.boolean(),
	revisionSelector: RevisionSelectorSchema,
	contextualHeading: v.optional(v.string()),
});

export const RevisionSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	text: v.string(),
	parentRevisionIds: v.array(UuidSchema),
	kind: RevisionKindSchema,
	createdAt: CreatedAtSchema,
	message: v.optional(v.string()),
});

export const SnapshotProtectionSchema = v.object({
	reason: v.picklist(["user", "import", "schema-migration", "revision-source"]),
	protectedAt: CreatedAtSchema,
	expiresAt: v.optional(CreatedAtSchema),
});

export const RecoverySnapshotSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	branchId: UuidSchema,
	text: v.string(),
	contentHash: v.string(),
	createdAt: CreatedAtSchema,
	sourceRevisionId: v.nullable(UuidSchema),
	name: v.optional(v.string()),
	protection: v.optional(SnapshotProtectionSchema),
});

export const LinkEndpointSchema = v.variant("scope", [
	v.object({ scope: v.literal("work"), workId: UuidSchema }),
	v.object({ scope: v.literal("revision"), workId: UuidSchema, revisionId: UuidSchema }),
]);

export const OutlineLinkSchema = v.object({
	id: UuidSchema,
	fromId: UuidSchema,
	toId: UuidSchema,
	from: LinkEndpointSchema,
	to: LinkEndpointSchema,
	type: RelationTypeNameSchema,
	status: LinkStatusSchema,
	origin: LinkOriginSchema,
	createdAt: CreatedAtSchema,
	reason: v.optional(v.string()),
});

export const BookmarkSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	occurrenceId: UuidSchema,
	createdAt: CreatedAtSchema,
});

export const ResumePositionSchema = v.object({
	workId: UuidSchema,
	occurrenceId: UuidSchema,
	caretOffset: v.number(),
	updatedAt: CreatedAtSchema,
});

export const PurgeManifestSchema = v.object({
	id: UuidSchema,
	workId: UuidSchema,
	occurrenceIds: v.array(UuidSchema),
	branchIds: v.array(UuidSchema),
	revisionIds: v.array(UuidSchema),
	linkIds: v.array(UuidSchema),
	purgedAt: CreatedAtSchema,
});

export const KnotSchema = v.object({
	id: UuidSchema,
	cycleIds: v.array(UuidSchema),
	createdAt: CreatedAtSchema,
});

export const SystemRelationSchema = v.object({
	id: UuidSchema,
	fromWorkId: UuidSchema,
	toWorkId: UuidSchema,
	type: v.literal("IN"),
	createdAt: CreatedAtSchema,
});

export const SearchAliasSchema = v.object({
	id: UuidSchema,
	canonical: v.string(),
	variants: v.array(v.string()),
	createdAt: CreatedAtSchema,
	updatedAt: CreatedAtSchema,
});

export const EmergenceKindSchema = v.picklist([
	"latent-relation",
	"cross-branch-resonance",
	"productive-tension",
]);
export const EmergenceActionSchema = v.picklist(["accept", "dismiss", "pin"]);
export const EmergenceStatusSchema = v.picklist(["pending", "accepted", "dismissed", "held"]);

export const EvidenceStepSchema = v.object({
	fromId: UuidSchema,
	toId: UuidSchema,
	relation: v.string(),
});

export const EmergenceSuggestionSchema = v.object({
	id: UuidSchema,
	kind: EmergenceKindSchema,
	contextWorkId: UuidSchema,
	targetWorkId: UuidSchema,
	contextItemId: UuidSchema,
	targetItemId: UuidSchema,
	proposedLinkType: v.optional(RelationTypeNameSchema),
	title: v.string(),
	explanation: v.string(),
	evidence: v.array(EvidenceStepSchema),
	score: v.number(),
	status: v.optional(v.literal("pinned")),
	persistenceStatus: EmergenceStatusSchema,
	createdAt: CreatedAtSchema,
	updatedAt: CreatedAtSchema,
	resolvedAt: v.optional(CreatedAtSchema),
	resolutionReason: v.optional(v.string()),
});

export const SavedRuleQuerySchema = v.object({
	id: UuidSchema,
	name: v.string(),
	source: v.string(),
	createdAt: CreatedAtSchema,
	updatedAt: CreatedAtSchema,
});
