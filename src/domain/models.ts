export type RelationTypeDirection = "directed" | "symmetric";

export const LINK_TYPES = [
	"RELATED",
	"FROM",
	"LIKE",
	"SUPPORT",
	"DEF",
	"VS",
	"FIX",
	"CITE",
] as const;
export type BuiltInRelationTypeName = (typeof LINK_TYPES)[number];

/**
 * Runtime identifier of a semantic relation. Values crossing an I/O boundary
 * must be checked with `normalizeRelationTypeName` and a loaded definition catalog.
 */
export type RelationTypeName = BuiltInRelationTypeName | (string & {});

export interface RelationTypeDefinition {
	name: RelationTypeName;
	direction: RelationTypeDirection;
	builtIn: boolean;
	createdAt: string;
}

export const RELATION_TYPE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export function normalizeRelationTypeName(value: string): RelationTypeName {
	const normalized = value.trim().toUpperCase();
	if (!RELATION_TYPE_NAME_PATTERN.test(normalized)) {
		throw new Error(
			"Relation type name must start with A-Z and contain only A-Z, 0-9, or _ (maximum 64 characters)",
		);
	}
	return normalized;
}

/** @deprecated Prefer RelationTypeName. Retained while callers migrate to the runtime catalog. */
export type LinkType = RelationTypeName;

const BUILT_IN_CREATED_AT = "1970-01-01T00:00:00.000Z";
export const SYMMETRIC_LINK_TYPES = ["RELATED", "LIKE", "VS"] as const;

export const DEFAULT_RELATION_TYPE_DEFINITIONS = LINK_TYPES.map((name) => ({
	name,
	direction: (SYMMETRIC_LINK_TYPES as readonly string[]).includes(name)
		? "symmetric" as const
		: "directed" as const,
	builtIn: true,
	createdAt: BUILT_IN_CREATED_AT,
})) satisfies readonly RelationTypeDefinition[];

export function isSymmetricLinkType(type: RelationTypeName): boolean {
	return (SYMMETRIC_LINK_TYPES as readonly RelationTypeName[]).includes(type);
}

export type LinkStatus = "provisional" | "asserted" | "retracted";
export type LinkOrigin = "human" | "suggestion" | "import";

export type StubCreationKind = "stub-list" | "advanced-link-editor";

/**
 * Explicit placeholder state recorded on a Work created before its content exists.
 * Distinct from `OutlineItem.referenceStub`, which marks a recursive display item.
 */
export interface WorkStub {
	createdAt: string; // ISO 8601
	createdVia: StubCreationKind;
	context?: string; // Creation context; the unresolved name for the Advanced Link Editor
}

export interface Work {
	id: string;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string;
	stub?: WorkStub;
	/** Tombstone provenance retained after an explicit duplicate merge. */
	mergedIntoWorkId?: string;
	mergedAt?: string;
}

export interface Branch {
	id: string;
	workId: string;
	name: string;
	headRevisionId: string | null;
	createdAt: string;
	promotedAt?: string;
	archivedAt?: string;
}

export interface WorkingCopy {
	branchId: string;
	workId: string;
	text: string;
	updatedAt: string;
}

export interface UnplacedWork {
	workId: string;
	branchId: string;
	text: string;
	createdAt: string;
	updatedAt: string;
}

export type RevisionKind = "checkpoint" | "edition" | "merge";

export interface Revision {
	id: string;
	workId: string;
	text: string;
	parentRevisionIds: string[];
	kind: RevisionKind;
	createdAt: string;
	message?: string;
}

export interface SnapshotProtection {
	reason: "user" | "import" | "schema-migration" | "revision-source";
	protectedAt: string;
	expiresAt?: string;
}

export interface RecoverySnapshot {
	id: string;
	workId: string;
	branchId: string;
	text: string;
	contentHash: string;
	createdAt: string;
	/** Revision at the Branch head when this Snapshot was captured. */
	sourceRevisionId: string | null;
	name?: string;
	protection?: SnapshotProtection;
}

export type RevisionSelector =
	| { mode: "branch"; branchId: string }
	| { mode: "pinned"; revisionId: string };

export interface Occurrence {
	id: string;
	workId: string;
	parentOccurrenceId: string | null;
	orderKey: number;
	collapsed: boolean;
	revisionSelector: RevisionSelector;
	contextualHeading?: string;
}

export interface Bookmark {
	id: string;
	workId: string;
	occurrenceId: string;
	createdAt: string;
}

export interface ResumePosition {
	workId: string;
	occurrenceId: string;
	caretOffset: number;
	updatedAt: string;
}

export type NavigationTarget =
	| {
		kind: "occurrence";
		workId: string;
		occurrenceId: string;
		ancestorOccurrenceIds: string[];
		fellBack: boolean;
	}
	| { kind: "work"; workId: string; fellBack: true };

export interface ResolvedBookmark {
	bookmark: Bookmark;
	target: NavigationTarget;
}

export interface ResolvedResumePosition {
	position: ResumePosition;
	target: NavigationTarget;
	/** Safe caret for the currently projected text; the persisted historical offset is unchanged. */
	resolvedCaretOffset: number;
}

export type LinkEndpoint =
	| { scope: "work"; workId: string }
	| { scope: "revision"; workId: string; revisionId: string };

export interface OutlineItem {
	id: string;
	workId: string;
	text: string;
	parentId: string | null;
	orderKey: number;
	collapsed: boolean;
	revisionSelector: RevisionSelector;
	contextualHeading?: string;
	referenceStub?: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface OutlineLink {
	id: string;
	fromId: string;
	toId: string;
	from: LinkEndpoint;
	to: LinkEndpoint;
	type: RelationTypeName;
	status: LinkStatus;
	origin: LinkOrigin;
	createdAt: string;
	reason?: string;
}

export interface SystemRelation {
	id: string;
	fromWorkId: string;
	toWorkId: string;
	type: "IN";
	createdAt: string;
}

export interface Knot {
	id: string;
	cycleIds: string[];
	createdAt: string;
}

export interface OutlineSnapshot {
	items: OutlineItem[];
	links: OutlineLink[];
	knots: Knot[];
	stashItemIds: string[];
}

export interface CreateItemInput {
	text: string;
	parentId: string | null;
	afterId?: string | null;
}

export interface CreateOccurrenceInput {
	workId: string;
	parentId: string | null;
	afterId?: string | null;
	/** Selects a specific editable Branch instead of copying an existing placement. */
	branchId?: string;
	contextualHeading?: string;
}

export interface MoveItemInput {
	id: string;
	parentId: string | null;
	afterId?: string | null;
}

export interface CreateLinkInput {
	fromId: string;
	toId: string;
	type: RelationTypeName;
	status?: LinkStatus;
	origin?: LinkOrigin;
	reason?: string;
	fromEndpoint?: LinkEndpoint;
	toEndpoint?: LinkEndpoint;
}

export interface TrashEntry {
	work: Work;
	occurrenceCount: number;
	linkCount: number;
}

export interface PurgeManifest {
	id: string;
	workId: string;
	occurrenceIds: string[];
	branchIds: string[];
	revisionIds: string[];
	linkIds: string[];
	purgedAt: string;
}

export interface SearchResult {
	item: OutlineItem;
	ancestorIds: string[];
	score: number;
	reasons: SearchReason[];
}

export type SearchReasonKind =
	| "title"
	| "body"
	| "alias"
	| "direct-link"
	| "shared-link"
	| "shared-ancestor";

export interface SearchReason {
	kind: SearchReasonKind;
	label: string;
	score: number;
}

export interface SearchRequest {
	query: string;
	contextItemId?: string | null;
	limit?: number;
}

export interface Suggestion {
	item: OutlineItem;
	ancestorIds: string[];
	title: string;
}

export interface LexicalHit {
	item: OutlineItem;
	titleScore: number;
	bodyScore: number;
}

export interface SearchAlias {
	id: string;
	canonical: string;
	variants: string[];
	createdAt: string;
	updatedAt: string;
}

export interface TagScope {
	kind: "working-copy" | "revision";
	workId: string;
	branchId?: string;
	revisionId?: string;
}

export interface ScopedTagSet {
	scope: TagScope;
	/** Canonical display names without the leading `#`. */
	tags: string[];
}

export interface TagSummary {
	name: string;
	count: number;
}

export interface TagSearchRequest {
	/** Every tag must occur in the same Branch Working Copy or Revision. */
	all: string[];
	/** A matching scope is excluded if any of these tags occurs in it. */
	none?: string[];
	/** Past Revisions are searched only when explicitly selected here. */
	historyRevisionIds?: string[];
	limit?: number;
}

export interface TagAlias {
	id: string;
	canonicalName: string;
	variants: string[];
	createdAt: string;
	updatedAt: string;
}

export type EmergenceKind = "latent-relation" | "cross-branch-resonance" | "productive-tension";
export type EmergenceAction = "accept" | "dismiss" | "pin";
export type EmergenceStatus = "pending" | "accepted" | "dismissed" | "held";

export interface EvidenceStep {
	fromId: string;
	toId: string;
	relation: LinkType | "PARENT" | "LEXICAL";
}

export interface EmergenceSuggestion {
	id: string;
	kind: EmergenceKind;
	/** Stable endpoints. Occurrence IDs below are only the discovery-time audit snapshot. */
	contextWorkId: string;
	targetWorkId: string;
	contextItemId: string;
	targetItemId: string;
	proposedLinkType?: LinkType;
	title: string;
	explanation: string;
	evidence: EvidenceStep[];
	score: number;
	status?: "pinned";
	persistenceStatus: EmergenceStatus;
	createdAt: string;
	updatedAt: string;
	resolvedAt?: string;
	resolutionReason?: string;
}

export interface EmergenceFeedback {
	id: string;
	action: EmergenceAction;
	updatedAt: string;
}

export interface RuleQueryResult {
	columns: string[];
	rows: string[][];
	elapsedMs: number;
}

export interface SavedRuleQuery {
	id: string;
	name: string;
	source: string;
	createdAt: string;
	updatedAt: string;
}

export type TransientProjectionSource = "search" | "today" | "query";

export interface TransientProjectionNode {
	workId: string;
	occurrenceId?: string;
	text: string;
	parentNodeIndex?: number;
	sourceType: TransientProjectionSource;
	breadcrumb?: string[];
	reasons?: SearchReason[];
	score?: number;
}
