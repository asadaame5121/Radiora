import type {
	Bookmark,
	CreateItemInput,
	CreateLinkInput,
	CreateOccurrenceInput,
	EmergenceAction,
	EmergenceSuggestion,
	LinkType,
	MoveItemInput,
	OutlineItem,
	OutlineSnapshot,
	PurgeManifest,
	RecoverySnapshot,
	ResolvedBookmark,
	ResolvedResumePosition,
	ResumePosition,
	Revision,
	RuleQueryResult,
	SavedRuleQuery,
	ScopedTagSet,
	SearchAlias,
	SearchRequest,
	SearchResult,
	Suggestion,
	TagAlias,
	TagSearchRequest,
	TagSummary,
	TransientProjectionNode,
	TrashEntry,
	UnplacedWork,
} from "../domain/models.ts";
import type { GlobalLineageProjection, WorkLineageProjection } from "../services/branch_service.ts";
import type { DateProjection, DateRange } from "../services/date_projection.ts";
import type { RecoverySnapshotPreview } from "../services/recovery_snapshot_service.ts";
import type {
	AdvancedLinkResolution,
	AdvancedLinkSelections,
} from "../services/advanced_link_resolver.ts";
import type {
	InternalReferenceBacklink,
	InternalReferenceCompletion,
	InternalReferenceResolution,
} from "../services/internal_reference_service.ts";
import type { RadioraReferenceScope } from "../services/markdown_parser.ts";
import type {
	LinkComparisonProjection,
	WorkComparisonDocuments,
} from "../services/comparison_service.ts";
import type {
	RewriteAsNewBranchResult,
	RewriteConfirmation,
} from "../services/revision_service.ts";

export interface RadioraBindings {
	getStartupStatus(): Promise<StartupStatus>;
	retryStartup(): Promise<StartupStatus>;
	listOutline(): Promise<OutlineSnapshot>;
	projectDates(range: DateRange): Promise<DateProjection>;
	listBookmarks(): Promise<Bookmark[]>;
	createBookmark(occurrenceId: string): Promise<Bookmark>;
	deleteBookmark(id: string): Promise<void>;
	resolveBookmark(id: string): Promise<ResolvedBookmark>;
	saveResumePosition(occurrenceId: string, caretOffset: number): Promise<ResumePosition>;
	resolveResumePosition(): Promise<ResolvedResumePosition | null>;
	clearResumePosition(): Promise<void>;
	listRevisions(workId: string): Promise<Revision[]>;
	listRecoverySnapshots(workId: string, branchId: string): Promise<RecoverySnapshot[]>;
	previewRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
	): Promise<RecoverySnapshotPreview>;
	restoreRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
	): Promise<RecoverySnapshot | null>;
	promoteRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
		message?: string,
	): Promise<Revision | null>;
	listGlobalLineage(): Promise<GlobalLineageProjection>;
	listWorkLineage(workId: string): Promise<WorkLineageProjection>;
	rewriteAsNewBranch(
		sourceBranchId: string,
		newBranchName: string,
		confirmation: RewriteConfirmation,
	): Promise<RewriteAsNewBranchResult>;
	createItem(input: CreateItemInput): Promise<OutlineItem>;
	quickCapture(text: string): Promise<UnplacedWork>;
	listUnplacedWorks(): Promise<UnplacedWork[]>;
	updateUnplacedWorkText(workId: string, text: string): Promise<void>;
	placeUnplacedWork(input: CreateOccurrenceInput): Promise<OutlineItem>;
	createOccurrence(input: CreateOccurrenceInput): Promise<OutlineItem>;
	updateItemText(id: string, text: string): Promise<void>;
	setContextualHeading(id: string, contextualHeading?: string): Promise<void>;
	moveItem(input: MoveItemInput): Promise<void>;
	deleteItem(id: string): Promise<void>;
	trashWork(id: string): Promise<void>;
	listTrash(): Promise<TrashEntry[]>;
	restoreWork(workId: string): Promise<void>;
	purgeWork(workId: string): Promise<PurgeManifest>;
	setCollapsed(id: string, collapsed: boolean): Promise<void>;
	createLink(input: CreateLinkInput): Promise<void>;
	resolveAdvancedLink(
		input: string,
		selections?: AdvancedLinkSelections,
	): Promise<AdvancedLinkResolution>;
	listInternalReferenceCompletions(
		query?: string,
		limit?: number,
	): Promise<InternalReferenceCompletion[]>;
	resolveInternalReferences(markdown: string): Promise<InternalReferenceResolution[]>;
	listInternalReferenceBacklinks(
		scope: RadioraReferenceScope,
		id: string,
	): Promise<InternalReferenceBacklink[]>;
	resolveLinkComparison(linkId: string): Promise<LinkComparisonProjection>;
	listWorkComparisonDocuments(workId: string): Promise<WorkComparisonDocuments>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	suggestItems(prefix: string, limit?: number): Promise<Suggestion[]>;
	searchItems(request: SearchRequest | string): Promise<SearchResult[]>;
	listScopedTags(historyRevisionIds?: string[]): Promise<ScopedTagSet[]>;
	listTags(historyRevisionIds?: string[]): Promise<TagSummary[]>;
	suggestTags(prefix: string, limit?: number): Promise<TagSummary[]>;
	searchTags(request: TagSearchRequest): Promise<ScopedTagSet[]>;
	listTagAliases(): Promise<TagAlias[]>;
	renameTag(from: string, to: string): Promise<TagAlias>;
	mergeTags(sources: string[], target: string): Promise<TagAlias>;
	listSearchAliases(): Promise<SearchAlias[]>;
	saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias>;
	deleteSearchAlias(id: string): Promise<void>;
	listEmergenceSuggestions(contextItemId: string, limit?: number): Promise<EmergenceSuggestion[]>;
	resolveEmergenceSuggestion(id: string, action: EmergenceAction): Promise<void>;
	runRuleQuery(source: string, limit?: number): Promise<RuleQueryResult>;
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	saveRuleQuery(input: { id?: string; name: string; source: string }): Promise<SavedRuleQuery>;
	deleteRuleQuery(id: string): Promise<void>;
	buildQueryProjectionNodes(
		queryId: string,
		limit?: number,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }>;
}

export type StartupPhase = "starting" | "ready" | "failed";

export interface StartupStatus {
	phase: StartupPhase;
	message: string;
	detail?: string;
	logPath?: string;
}

declare global {
	const bindings: RadioraBindings;
}
