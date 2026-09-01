import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LexicalHit,
	LinkType,
	Occurrence,
	OutlineItem,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	StubCreationKind,
	SystemRelation,
	Work,
	WorkingCopy,
	WorkStub,
} from "../domain/models.ts";

export interface MergeWorksInput {
	sourceWorkId: string;
	survivorWorkId: string;
	mergedAt: string;
	alias?: SearchAlias;
}

export interface WorkBundle {
	work: Work;
	branch: Branch;
	workingCopy: WorkingCopy;
	occurrence: Occurrence;
}

export interface GraphStateSnapshot {
	works: Work[];
	branches: Branch[];
	workingCopies: WorkingCopy[];
	occurrences: Occurrence[];
	links: OutlineLink[];
	systemRelations: SystemRelation[];
	knots: Knot[];
	aliases: SearchAlias[];
	emergenceFeedback: Record<string, "accept" | "dismiss" | "pin">;
	emergenceSuggestions: EmergenceSuggestion[];
	savedRuleQueries: SavedRuleQuery[];
	purgeManifests: PurgeManifest[];
	revisions: Revision[];
	recoverySnapshots: RecoverySnapshot[];
	bookmarks: Bookmark[];
	resumePosition: ResumePosition | null;
	relationTypeDefinitions?: RelationTypeDefinition[];
}

export interface BackupStorePort {
	exportGraphState(): Promise<GraphStateSnapshot>;
	restoreGraphState(state: GraphStateSnapshot): Promise<void>;
}

export interface OutlineStorePort {
	listItems(): Promise<OutlineItem[]>;
	listOccurrences(includeDeletedWorks?: boolean): Promise<Occurrence[]>;
	createOccurrence(occurrence: Occurrence): Promise<void>;
	updateOccurrence(occurrence: Occurrence): Promise<void>;
	deleteOccurrence(id: string): Promise<void>;
	listBookmarks(): Promise<Bookmark[]>;
	createBookmark(bookmark: Bookmark): Promise<void>;
	deleteBookmark(id: string): Promise<void>;
	getResumePosition(): Promise<ResumePosition | null>;
	setResumePosition(position: ResumePosition): Promise<void>;
	clearResumePosition(): Promise<void>;
}

export interface WorkStorePort {
	listWorks(includeDeleted?: boolean): Promise<Work[]>;
	listBranches(workId?: string): Promise<Branch[]>;
	listWorkingCopies(workId?: string): Promise<WorkingCopy[]>;
	listRevisions(workId?: string): Promise<Revision[]>;
	listRecoverySnapshots(workId?: string, branchId?: string): Promise<RecoverySnapshot[]>;
	createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void>;
	importWorkBundles(bundles: readonly WorkBundle[]): Promise<void>;
	createUnplacedWork(work: Work, branch: Branch, workingCopy: WorkingCopy): Promise<void>;
	resolveWorkStub(workId: string, updatedAt: string): Promise<void>;
	mergeWorks(input: MergeWorksInput): Promise<void>;
	createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void>;
	updateBranch(branch: Branch): Promise<void>;
	updateBranchWorkingCopy(branchId: string, text: string, updatedAt: string): Promise<void>;
	updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void>;
	createRevision(revision: Revision, branchId: string): Promise<void>;
	createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void>;
	applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void>;
	restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void>;
	promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void>;
	trashWork(workId: string, deletedAt: string): Promise<void>;
	restoreWork(workId: string): Promise<void>;
	purgeWork(workId: string): Promise<PurgeManifest>;
	listPurgeManifests(): Promise<PurgeManifest[]>;
}

export interface RelationStorePort {
	listLinks(): Promise<OutlineLink[]>;
	createLink(link: OutlineLink): Promise<void>;
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	listSystemRelations(): Promise<SystemRelation[]>;
	listKnots(): Promise<Knot[]>;
	replaceKnots(knots: Knot[]): Promise<void>;
}

export interface DiscoveryStorePort {
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]>;
	searchLexical(query: string, limit: number): Promise<LexicalHit[]>;
	listAliases(): Promise<SearchAlias[]>;
	upsertAlias(alias: SearchAlias): Promise<void>;
	deleteAlias(id: string): Promise<void>;
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null>;
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void>;
	listEmergenceSuggestions(): Promise<EmergenceSuggestion[]>;
	upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void>;
	resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void>;
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void>;
	deleteSavedRuleQuery(id: string): Promise<void>;
}

export interface RelationTypeDefinitionStorePort {
	listRelationTypeDefinitions(): Promise<RelationTypeDefinition[]>;
	createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void>;
}

export interface GraphStore
	extends BackupStorePort, OutlineStorePort, WorkStorePort, RelationStorePort, DiscoveryStorePort {
	initialize(): Promise<void>;
	close(): Promise<void>;
}

export { validatedGraphStateSnapshot } from "./graph_state_validation.ts";
export {
	isValidWorkStub,
	validateRevisionCreation,
	validateUnplacedWorkCreation,
	validateWorkBundleImport,
} from "./graph_mutation_validation.ts";
