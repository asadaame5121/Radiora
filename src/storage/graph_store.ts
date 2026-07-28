import type {
	Branch,
	Knot,
	LexicalHit,
	LinkType,
	Occurrence,
	OutlineItem,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";

export interface GraphStore {
	initialize(): Promise<void>;
	close(): Promise<void>;
	listItems(): Promise<OutlineItem[]>;
	listWorks(includeDeleted?: boolean): Promise<Work[]>;
	listOccurrences(includeDeletedWorks?: boolean): Promise<Occurrence[]>;
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
	createOccurrence(occurrence: Occurrence): Promise<void>;
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
	listSavedRuleQueries(): Promise<SavedRuleQuery[]>;
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void>;
	deleteSavedRuleQuery(id: string): Promise<void>;
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
