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
	StubCreationKind,
	Suggestion,
	TagAlias,
	TagSearchRequest,
	TagSummary,
	TransientProjectionNode,
	TrashEntry,
	UnplacedWork,
} from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";
import {
	BranchService,
	type GlobalLineageProjection,
	type WorkLineageProjection,
} from "./branch_service.ts";
import {
	type RecoverySnapshotPreview,
	RecoverySnapshotService,
} from "./recovery_snapshot_service.ts";
import { TagService } from "./tag_service.ts";
import { NavigationService } from "./navigation_service.ts";
import { type DateProjection, DateProjectionService, type DateRange } from "./date_projection.ts";
import { QuickCaptureService } from "./quick_capture_service.ts";
import {
	type AdvancedLinkResolution,
	AdvancedLinkResolverService,
	type AdvancedLinkSelections,
} from "./advanced_link_resolver.ts";
import {
	type InternalReferenceBacklink,
	type InternalReferenceCompletion,
	type InternalReferenceResolution,
	InternalReferenceService,
} from "./internal_reference_service.ts";
import type { RadioraReferenceScope } from "./markdown_parser.ts";
import {
	ComparisonService,
	type LinkComparisonProjection,
	type WorkComparisonDocuments,
} from "./comparison_service.ts";
import { type CreatedStub, type StubListEntry, StubService } from "./stub_service.ts";
import { type DuplicateCandidate, DuplicateCandidateService } from "./duplicate_candidates.ts";
import { type WorkMergePreview, WorkMergeService } from "./work_merge_service.ts";
import { SemanticLinkOperations } from "./semantic_link_operations.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { DiscoveryOperations } from "./discovery_operations.ts";
import { ManuscriptProjectionService, type ManuscriptSection } from "./manuscript_projection.ts";
import { type OpmlImportResult, OpmlService } from "./opml_service.ts";
import { JsonBackupService } from "./json_backup.ts";

/** Compatibility façade for the desktop binding contract. */
export class OutlineService {
	private readonly discovery: DiscoveryOperations;

	constructor(private readonly store: GraphStore) {
		this.discovery = new DiscoveryOperations(store);
	}

	listBookmarks(): Promise<Bookmark[]> {
		return new NavigationService(this.store).listBookmarks();
	}
	createBookmark(occurrenceId: string): Promise<Bookmark> {
		return new NavigationService(this.store).createBookmark(occurrenceId);
	}
	deleteBookmark(id: string): Promise<void> {
		return new NavigationService(this.store).deleteBookmark(id);
	}
	resolveBookmark(id: string): Promise<ResolvedBookmark> {
		return new NavigationService(this.store).resolveBookmark(id);
	}
	saveResumePosition(occurrenceId: string, caretOffset: number): Promise<ResumePosition> {
		return new NavigationService(this.store).saveResumePosition(occurrenceId, caretOffset);
	}
	resolveResumePosition(): Promise<ResolvedResumePosition | null> {
		return new NavigationService(this.store).resolveResumePosition();
	}
	clearResumePosition(): Promise<void> {
		return new NavigationService(this.store).clearResumePosition();
	}
	projectDates(range: DateRange): Promise<DateProjection> {
		return new DateProjectionService(this.store).project(range);
	}

	projectManuscript(rootOccurrenceId: string): Promise<ManuscriptSection[]> {
		return new ManuscriptProjectionService(this.store).project(rootOccurrenceId);
	}

	exportOpml(): Promise<string> {
		return new OpmlService(this.store).export();
	}

	importOpml(source: string): Promise<OpmlImportResult> {
		return new OpmlService(this.store).import(source);
	}

	exportJsonBackup(): Promise<string> {
		return new JsonBackupService(this.store).export();
	}
	quickCapture(text: string): Promise<UnplacedWork> {
		return new QuickCaptureService(this.store).capture(text);
	}
	listUnplacedWorks(): Promise<UnplacedWork[]> {
		return new QuickCaptureService(this.store).list();
	}
	updateUnplacedWorkText(workId: string, text: string): Promise<void> {
		return new QuickCaptureService(this.store).updateText(workId, text);
	}
	async placeUnplacedWork(input: CreateOccurrenceInput): Promise<OutlineItem> {
		const unplaced = await this.listUnplacedWorks();
		if (!unplaced.some((candidate) => candidate.workId === input.workId)) {
			throw new Error(`Unplaced Work not found: ${input.workId}`);
		}
		return this.createOccurrence(input);
	}

	listOutline(): Promise<OutlineSnapshot> {
		return new OccurrenceOperations(this.store).listOutline();
	}
	listRevisions(workId: string): Promise<Revision[]> {
		return new OccurrenceOperations(this.store).listRevisions(workId);
	}
	listRecoverySnapshots(workId: string, branchId: string): Promise<RecoverySnapshot[]> {
		return new RecoverySnapshotService(this.store).list(workId, branchId);
	}
	previewRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
	): Promise<RecoverySnapshotPreview> {
		return new RecoverySnapshotService(this.store).preview(snapshotId, workId, branchId);
	}
	restoreRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
	): Promise<RecoverySnapshot | null> {
		return new RecoverySnapshotService(this.store).restore(
			snapshotId,
			workId,
			branchId,
			confirmation,
		);
	}
	promoteRecoverySnapshot(
		snapshotId: string,
		workId: string,
		branchId: string,
		confirmation: "confirmed" | "cancelled",
		message?: string,
	): Promise<Revision | null> {
		return new RecoverySnapshotService(this.store).promote(
			snapshotId,
			workId,
			branchId,
			confirmation,
			message,
		);
	}
	listGlobalLineage(): Promise<GlobalLineageProjection> {
		return new BranchService(this.store).listGlobalLineage();
	}
	listWorkLineage(workId: string): Promise<WorkLineageProjection> {
		return new BranchService(this.store).listWorkLineage(workId);
	}
	createItem(input: CreateItemInput): Promise<OutlineItem> {
		return new OccurrenceOperations(this.store).createItem(input);
	}
	createOccurrence(input: CreateOccurrenceInput): Promise<OutlineItem> {
		return new OccurrenceOperations(this.store).createOccurrence(input);
	}
	updateItemText(id: string, text: string): Promise<void> {
		return new OccurrenceOperations(this.store).updateItemText(id, text);
	}
	setCollapsed(id: string, collapsed: boolean): Promise<void> {
		return new OccurrenceOperations(this.store).setCollapsed(id, collapsed);
	}
	setContextualHeading(id: string, contextualHeading?: string): Promise<void> {
		return new OccurrenceOperations(this.store).setContextualHeading(id, contextualHeading);
	}
	moveItem(input: MoveItemInput): Promise<void> {
		return new OccurrenceOperations(this.store).moveItem(input);
	}
	deleteItem(id: string): Promise<void> {
		return new OccurrenceOperations(this.store).deleteItem(id);
	}
	trashWork(id: string): Promise<void> {
		return new OccurrenceOperations(this.store).trashWork(id);
	}
	listTrash(): Promise<TrashEntry[]> {
		return new OccurrenceOperations(this.store).listTrash();
	}
	restoreWork(workId: string): Promise<void> {
		return new OccurrenceOperations(this.store).restoreWork(workId);
	}
	purgeWork(workId: string): Promise<PurgeManifest> {
		return new OccurrenceOperations(this.store).purgeWork(workId);
	}

	createLink(input: CreateLinkInput): Promise<void> {
		return new SemanticLinkOperations(this.store).createLink(input);
	}
	resolveAdvancedLink(
		input: string,
		selections?: AdvancedLinkSelections,
	): Promise<AdvancedLinkResolution> {
		return new AdvancedLinkResolverService(this.store).resolve(input, selections);
	}
	listInternalReferenceCompletions(
		query?: string,
		limit?: number,
	): Promise<InternalReferenceCompletion[]> {
		return new InternalReferenceService(this.store).listCompletions(query, limit);
	}
	resolveInternalReferences(markdown: string): Promise<InternalReferenceResolution[]> {
		return new InternalReferenceService(this.store).resolve(markdown);
	}
	listInternalReferenceBacklinks(
		scope: RadioraReferenceScope,
		id: string,
	): Promise<InternalReferenceBacklink[]> {
		return new InternalReferenceService(this.store).listBacklinks(scope, id);
	}
	listStubs(): Promise<StubListEntry[]> {
		return new StubService(this.store).listStubs();
	}
	createStub(createdVia: StubCreationKind, context?: string): Promise<CreatedStub> {
		return new StubService(this.store).createStub(createdVia, context);
	}
	resolveStub(workId: string): Promise<void> {
		return new StubService(this.store).resolveStub(workId);
	}
	listDuplicateCandidates(limit?: number): Promise<DuplicateCandidate[]> {
		return new DuplicateCandidateService(this.store).listCandidates(limit);
	}
	previewWorkMerge(sourceWorkId: string, survivorWorkId: string): Promise<WorkMergePreview> {
		return new WorkMergeService(this.store).preview(sourceWorkId, survivorWorkId);
	}
	mergeWorks(preview: WorkMergePreview): Promise<void> {
		return new WorkMergeService(this.store).merge(preview);
	}
	resolveLinkComparison(linkId: string): Promise<LinkComparisonProjection> {
		return new ComparisonService(this.store).resolveLink(linkId);
	}
	listWorkComparisonDocuments(workId: string): Promise<WorkComparisonDocuments> {
		return new ComparisonService(this.store).listWorkDocuments(workId);
	}
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		return new SemanticLinkOperations(this.store).deleteLink(fromId, toId, type);
	}

	suggestItems(prefix: string, limit = 8): Promise<Suggestion[]> {
		return this.discovery.suggestItems(prefix, limit);
	}
	searchItems(request: SearchRequest | string): Promise<SearchResult[]> {
		return this.discovery.searchItems(request);
	}
	listSearchAliases(): Promise<SearchAlias[]> {
		return this.discovery.listSearchAliases();
	}
	saveSearchAlias(
		input: { id?: string; canonical: string; variants: string[] },
	): Promise<SearchAlias> {
		return this.discovery.saveSearchAlias(input);
	}
	deleteSearchAlias(id: string): Promise<void> {
		return this.discovery.deleteSearchAlias(id);
	}
	listEmergenceSuggestions(contextItemId: string, limit = 10): Promise<EmergenceSuggestion[]> {
		return this.discovery.listEmergenceSuggestions(contextItemId, limit);
	}
	resolveEmergenceSuggestion(id: string, action: EmergenceAction, reason?: string): Promise<void> {
		return this.discovery.resolveEmergenceSuggestion(id, action, reason);
	}
	runRuleQuery(source: string, limit = 500): Promise<RuleQueryResult> {
		return this.discovery.runRuleQuery(source, limit);
	}
	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return this.discovery.listSavedRuleQueries();
	}
	saveRuleQuery(input: { id?: string; name: string; source: string }): Promise<SavedRuleQuery> {
		return this.discovery.saveRuleQuery(input);
	}
	deleteRuleQuery(id: string): Promise<void> {
		return this.discovery.deleteRuleQuery(id);
	}
	buildQueryProjectionNodes(
		queryId: string,
		limit = 500,
	): Promise<{ nodes: TransientProjectionNode[]; result: RuleQueryResult }> {
		return this.discovery.buildQueryProjectionNodes(queryId, limit);
	}

	listScopedTags(historyRevisionIds: string[] = []): Promise<ScopedTagSet[]> {
		return new TagService(this.store).listScopedTags(historyRevisionIds);
	}
	listTags(historyRevisionIds: string[] = []): Promise<TagSummary[]> {
		return new TagService(this.store).listTags(historyRevisionIds);
	}
	suggestTags(prefix: string, limit = 8): Promise<TagSummary[]> {
		return new TagService(this.store).suggest(prefix, limit);
	}
	searchTags(request: TagSearchRequest): Promise<ScopedTagSet[]> {
		return new TagService(this.store).search(request);
	}
	listTagAliases(): Promise<TagAlias[]> {
		return new TagService(this.store).listAliases();
	}
	renameTag(from: string, to: string): Promise<TagAlias> {
		return new TagService(this.store).rename(from, to);
	}
	mergeTags(sources: string[], target: string): Promise<TagAlias> {
		return new TagService(this.store).merge(sources, target);
	}
}
