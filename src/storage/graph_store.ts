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
}

export interface GraphStore {
	initialize(): Promise<void>;
	close(): Promise<void>;
	/** Returns every persisted entity, including deleted and historical records. */
	exportGraphState(): Promise<GraphStateSnapshot>;
	listItems(): Promise<OutlineItem[]>;
	listWorks(includeDeleted?: boolean): Promise<Work[]>;
	listOccurrences(includeDeletedWorks?: boolean): Promise<Occurrence[]>;
	listBranches(workId?: string): Promise<Branch[]>;
	listWorkingCopies(workId?: string): Promise<WorkingCopy[]>;
	listRevisions(workId?: string): Promise<Revision[]>;
	listRecoverySnapshots(workId?: string, branchId?: string): Promise<RecoverySnapshot[]>;
	listBookmarks(): Promise<Bookmark[]>;
	getResumePosition(): Promise<ResumePosition | null>;
	createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void>;
	/** Atomically appends a fully validated collection of outline Work bundles. */
	importWorkBundles(bundles: readonly WorkBundle[]): Promise<void>;
	/** Atomically creates a Work and its editable main Branch without a placement. */
	createUnplacedWork(work: Work, branch: Branch, workingCopy: WorkingCopy): Promise<void>;
	/** Removes the Stub state from a Work and records the resolution instant. */
	resolveWorkStub(workId: string, updatedAt: string): Promise<void>;
	/** Atomically moves all source-owned graph state and leaves a provenance tombstone. */
	mergeWorks(input: MergeWorksInput): Promise<void>;
	createOccurrence(occurrence: Occurrence): Promise<void>;
	createBookmark(bookmark: Bookmark): Promise<void>;
	deleteBookmark(id: string): Promise<void>;
	setResumePosition(position: ResumePosition): Promise<void>;
	clearResumePosition(): Promise<void>;
	createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void>;
	updateBranch(branch: Branch): Promise<void>;
	updateBranchWorkingCopy(branchId: string, text: string, updatedAt: string): Promise<void>;
	/**
	 * Compatibility API for the pre-Branch service layer. Updates only the Work's
	 * `main` Branch; new callers must use updateBranchWorkingCopy.
	 */
	updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void>;
	/** Creates an immutable Revision and advances the selected Branch head atomically. */
	createRevision(revision: Revision, branchId: string): Promise<void>;
	createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void>;
	/** Applies Snapshot text to its Working Copy without creating a Revision. */
	applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void>;
	/**
	 * Atomically saves the current Working Copy as a new Snapshot, then applies
	 * the selected Snapshot text. Neither the Branch head nor Revisions change.
	 */
	restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void>;
	/**
	 * Atomically creates a Revision from a Snapshot, advances its Branch head,
	 * and protects the source Snapshot.
	 */
	promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void>;
	updateOccurrence(occurrence: Occurrence): Promise<void>;
	deleteOccurrence(id: string): Promise<void>;
	trashWork(workId: string, deletedAt: string): Promise<void>;
	restoreWork(workId: string): Promise<void>;
	purgeWork(workId: string): Promise<PurgeManifest>;
	listPurgeManifests(): Promise<PurgeManifest[]>;
	listLinks(): Promise<OutlineLink[]>;
	createLink(link: OutlineLink): Promise<void>;
	/** Marks matching active links as retracted while retaining them for history. */
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void>;
	listSystemRelations(): Promise<SystemRelation[]>;
	listKnots(): Promise<Knot[]>;
	replaceKnots(knots: Knot[]): Promise<void>;
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]>;
	searchLexical(query: string, limit: number): Promise<LexicalHit[]>;
	listAliases(): Promise<SearchAlias[]>;
	upsertAlias(alias: SearchAlias): Promise<void>;
	deleteAlias(id: string): Promise<void>;
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null>;
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void>;
	listEmergenceSuggestions(): Promise<EmergenceSuggestion[]>;
	upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void>;
	/**
	 * Atomically records a decision and, for acceptance, creates the supplied
	 * suggestion-origin asserted link. Repeated decisions are idempotent.
	 */
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

export function validateWorkBundleImport(
	bundles: readonly WorkBundle[],
	existing: {
		works: readonly Work[];
		branches: readonly Branch[];
		workingCopies: readonly WorkingCopy[];
		occurrences: readonly Occurrence[];
	},
): void {
	if (bundles.length === 0) throw new Error("Outline import contains no items");
	const workIds = new Set(existing.works.map((entry) => entry.id));
	const branchIds = new Set(existing.branches.map((entry) => entry.id));
	const copyBranchIds = new Set(existing.workingCopies.map((entry) => entry.branchId));
	const occurrenceIds = new Set(existing.occurrences.map((entry) => entry.id));
	const importedOccurrenceIds = new Set(bundles.map((bundle) => bundle.occurrence.id));

	for (const { work, branch, workingCopy, occurrence } of bundles) {
		requireFreshId(work.id, workIds, "Work");
		requireFreshId(branch.id, branchIds, "Branch");
		requireFreshId(workingCopy.branchId, copyBranchIds, "Working Copy");
		requireFreshId(occurrence.id, occurrenceIds, "Occurrence");
		if (
			branch.workId !== work.id || branch.name !== "main" ||
			workingCopy.workId !== work.id || workingCopy.branchId !== branch.id ||
			occurrence.workId !== work.id ||
			occurrence.revisionSelector.mode !== "branch" ||
			occurrence.revisionSelector.branchId !== branch.id
		) {
			throw new Error(`Invalid imported Work bundle: ${work.id}`);
		}
		const parentId = occurrence.parentOccurrenceId;
		if (
			parentId === occurrence.id ||
			(parentId !== null && !occurrenceIds.has(parentId) && !importedOccurrenceIds.has(parentId))
		) {
			throw new Error(`Imported parent Occurrence not found: ${parentId}`);
		}
	}

	const parentById = new Map(
		bundles.map((bundle) => [bundle.occurrence.id, bundle.occurrence.parentOccurrenceId]),
	);
	for (const start of parentById.keys()) {
		const path = new Set<string>();
		let cursor: string | null | undefined = start;
		while (cursor && parentById.has(cursor)) {
			if (path.has(cursor)) throw new Error(`Imported Occurrence cycle: ${cursor}`);
			path.add(cursor);
			cursor = parentById.get(cursor);
		}
	}
}

function requireFreshId(id: string, ids: Set<string>, label: string): void {
	if (!id || ids.has(id)) throw new Error(`${label} ID collision: ${id}`);
	ids.add(id);
}

const STUB_CREATION_KINDS: readonly StubCreationKind[] = ["stub-list", "advanced-link-editor"];

/**
 * A blank Working Copy is accepted only for an explicitly recorded Stub:
 * a valid ISO creation instant and a known creation path are both required.
 */
export function isValidWorkStub(stub: WorkStub | undefined): boolean {
	if (!stub) return false;
	const parsedCreatedAt = Date.parse(stub.createdAt);
	if (
		!Number.isFinite(parsedCreatedAt) || new Date(parsedCreatedAt).toISOString() !== stub.createdAt
	) {
		return false;
	}
	return (STUB_CREATION_KINDS as readonly string[]).includes(stub.createdVia);
}

export function validateUnplacedWorkCreation(
	work: Work,
	branch: Branch,
	workingCopy: WorkingCopy,
	existingWorks: readonly Work[],
	existingBranches: readonly Branch[],
	existingWorkingCopies: readonly WorkingCopy[],
): void {
	if (!work.id || !branch.id) throw new Error("Work and Branch IDs are required");
	if (!workingCopy.text.trim() && !isValidWorkStub(work.stub)) {
		throw new Error("Quick Capture text must not be blank");
	}
	if (
		branch.workId !== work.id || workingCopy.workId !== work.id ||
		workingCopy.branchId !== branch.id
	) {
		throw new Error("Work, Branch, and Working Copy identity must match");
	}
	if (
		branch.name !== "main" || branch.headRevisionId !== null || branch.promotedAt ||
		branch.archivedAt
	) {
		throw new Error("Quick Capture requires an active main Branch without a Revision");
	}
	const parsedCreatedAt = Date.parse(work.createdAt);
	if (
		!Number.isFinite(parsedCreatedAt) || new Date(parsedCreatedAt).toISOString() !== work.createdAt
	) {
		throw new Error("Quick Capture requires a valid ISO creation instant");
	}
	if (
		work.deletedAt || work.createdAt !== work.updatedAt ||
		branch.createdAt !== work.createdAt || workingCopy.updatedAt !== work.updatedAt
	) {
		throw new Error("Quick Capture timestamps must describe one new active Work");
	}
	if (existingWorks.some((candidate) => candidate.id === work.id)) {
		throw new Error(`Work already exists: ${work.id}`);
	}
	if (existingBranches.some((candidate) => candidate.id === branch.id)) {
		throw new Error(`Branch already exists: ${branch.id}`);
	}
	if (existingWorkingCopies.some((candidate) => candidate.branchId === workingCopy.branchId)) {
		throw new Error(`Working Copy already exists for Branch: ${workingCopy.branchId}`);
	}
}

/**
 * Validates the append-only Revision boundary.
 *
 * Revisions are immutable after creation, and every parent must already exist.
 * Therefore accepting a new Revision through this boundary cannot introduce a
 * cycle: a new node can only point to nodes that predate it.
 */
export function validateRevisionCreation(
	revision: Revision,
	branch: Branch | undefined,
	existingRevisions: readonly Revision[],
): void {
	if (!branch || branch.workId !== revision.workId) {
		throw new Error(`Branch does not belong to Revision Work: ${branch?.id ?? "unknown"}`);
	}
	if (existingRevisions.some((candidate) => candidate.id === revision.id)) {
		throw new Error(`Revision already exists: ${revision.id}`);
	}
	if (revision.parentRevisionIds.includes(revision.id)) {
		throw new Error(`Revision cannot be its own parent: ${revision.id}`);
	}
	if (new Set(revision.parentRevisionIds).size !== revision.parentRevisionIds.length) {
		throw new Error(`Revision parents must be unique: ${revision.id}`);
	}

	const revisionsById = new Map(existingRevisions.map((candidate) => [candidate.id, candidate]));
	for (const parentId of revision.parentRevisionIds) {
		const parent = revisionsById.get(parentId);
		if (!parent) {
			throw new Error(`Parent Revision not found: ${parentId}`);
		}
		if (parent.workId !== revision.workId) {
			throw new Error(`Parent Revision does not belong to Revision Work: ${parentId}`);
		}
	}
}
