export const LINK_TYPES = ["RELATED", "FROM", "LIKE", "SUPPORT", "VS", "FIX", "CITE"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const SYMMETRIC_LINK_TYPES = [
	"RELATED",
	"LIKE",
	"VS",
] as const satisfies readonly LinkType[];

export function isSymmetricLinkType(type: LinkType): boolean {
	return (SYMMETRIC_LINK_TYPES as readonly LinkType[]).includes(type);
}

export type LinkStatus = "provisional" | "asserted" | "retracted";
export type LinkOrigin = "human" | "suggestion" | "import";

export interface Work {
	id: string;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string;
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
	type: LinkType;
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
	type: LinkType;
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

export interface EvidenceStep {
	fromId: string;
	toId: string;
	relation: LinkType | "PARENT" | "LEXICAL";
}

export interface EmergenceSuggestion {
	id: string;
	kind: EmergenceKind;
	contextItemId: string;
	targetItemId: string;
	proposedLinkType?: LinkType;
	title: string;
	explanation: string;
	evidence: EvidenceStep[];
	score: number;
	status?: "pinned";
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
