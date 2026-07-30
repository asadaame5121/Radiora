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
import { LINK_TYPES } from "../domain/models.ts";

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
	/** Atomically replaces all graph data after complete validation. */
	restoreGraphState(state: GraphStateSnapshot): Promise<void>;
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

export function validatedGraphStateSnapshot(value: unknown): GraphStateSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Backup data must be an object");
	}
	const source = value as Record<string, unknown>;
	for (
		const key of [
			"works",
			"branches",
			"workingCopies",
			"occurrences",
			"links",
			"systemRelations",
			"knots",
			"aliases",
			"emergenceSuggestions",
			"savedRuleQueries",
			"purgeManifests",
			"revisions",
			"recoverySnapshots",
			"bookmarks",
		]
	) {
		if (!Array.isArray(source[key])) throw new Error(`Backup data.${key} must be an array`);
	}
	if (
		!source.emergenceFeedback || typeof source.emergenceFeedback !== "object" ||
		Array.isArray(source.emergenceFeedback)
	) {
		throw new Error("Backup data.emergenceFeedback must be an object");
	}
	if (
		source.resumePosition !== null &&
		(!source.resumePosition || typeof source.resumePosition !== "object" ||
			Array.isArray(source.resumePosition))
	) {
		throw new Error("Backup data.resumePosition must be an object or null");
	}

	const state = structuredClone(value) as GraphStateSnapshot;
	const workById = uniqueById(state.works, "Work");
	const branchById = uniqueById(state.branches, "Branch");
	const occurrenceById = uniqueById(state.occurrences, "Occurrence");
	const revisionById = uniqueById(state.revisions, "Revision");
	uniqueById(state.recoverySnapshots, "Recovery Snapshot");
	uniqueById(state.links, "Link");
	uniqueById(state.systemRelations, "System Relation");
	uniqueById(state.knots, "Knot");
	uniqueById(state.aliases, "Search Alias");
	uniqueById(state.emergenceSuggestions, "Emergence Suggestion");
	uniqueById(state.savedRuleQueries, "Saved Rule Query");
	uniqueById(state.purgeManifests, "Purge Manifest");
	uniqueById(state.bookmarks, "Bookmark");
	const purgedWorkIds = new Set(state.purgeManifests.map((manifest) => manifest.workId));
	const purgedOccurrenceIds = new Set(
		state.purgeManifests.flatMap((manifest) => manifest.occurrenceIds),
	);

	for (const work of state.works) {
		if (
			!isIsoInstant(work.createdAt) || !isIsoInstant(work.updatedAt) ||
			(work.stub !== undefined && !isValidWorkStub(work.stub))
		) {
			throw new Error(`Invalid Work: ${work.id}`);
		}
		if (work.deletedAt && !isIsoInstant(work.deletedAt)) {
			throw new Error(`Invalid Work: ${work.id}`);
		}
		if (
			work.mergedIntoWorkId && !workById.has(work.mergedIntoWorkId) &&
			!purgedWorkIds.has(work.mergedIntoWorkId)
		) {
			throw new Error(`Merged Work target not found: ${work.mergedIntoWorkId}`);
		}
		if (
			work.mergedIntoWorkId === work.id ||
			(work.mergedIntoWorkId && !isIsoInstant(work.mergedAt))
		) {
			throw new Error(`Invalid Work merge provenance: ${work.id}`);
		}
	}
	for (const branch of state.branches) {
		if (
			!workById.has(branch.workId) || !branch.name || !isIsoInstant(branch.createdAt) ||
			(branch.promotedAt !== undefined && !isIsoInstant(branch.promotedAt)) ||
			(branch.archivedAt !== undefined && !isIsoInstant(branch.archivedAt))
		) {
			throw new Error(`Invalid Branch: ${branch.id}`);
		}
		if (branch.headRevisionId) {
			const head = revisionById.get(branch.headRevisionId);
			if (!head || head.workId !== branch.workId) {
				throw new Error(`Branch head Revision not found: ${branch.id}`);
			}
		}
	}
	const copyBranchIds = new Set<string>();
	for (const copy of state.workingCopies) {
		if (copyBranchIds.has(copy.branchId)) {
			throw new Error(`Working Copy ID collision: ${copy.branchId}`);
		}
		copyBranchIds.add(copy.branchId);
		const branch = branchById.get(copy.branchId);
		if (
			!branch || branch.workId !== copy.workId || !workById.has(copy.workId) ||
			typeof copy.text !== "string" || !isIsoInstant(copy.updatedAt)
		) {
			throw new Error(`Invalid Working Copy: ${copy.branchId}`);
		}
	}
	for (const revision of state.revisions) {
		if (
			!workById.has(revision.workId) || typeof revision.text !== "string" ||
			!Array.isArray(revision.parentRevisionIds) || !isIsoInstant(revision.createdAt) ||
			!["checkpoint", "edition", "merge"].includes(revision.kind)
		) {
			throw new Error(`Invalid Revision: ${revision.id}`);
		}
		const parents = new Set<string>();
		for (const parentId of revision.parentRevisionIds) {
			const parent = revisionById.get(parentId);
			if (
				!parent || parent.workId !== revision.workId || parentId === revision.id ||
				parents.has(parentId)
			) {
				throw new Error(`Invalid Revision parent: ${revision.id}`);
			}
			parents.add(parentId);
		}
	}
	assertRevisionDag(state.revisions);
	for (const snapshot of state.recoverySnapshots) {
		const branch = branchById.get(snapshot.branchId);
		const sourceRevision = snapshot.sourceRevisionId
			? revisionById.get(snapshot.sourceRevisionId)
			: undefined;
		if (
			!workById.has(snapshot.workId) || !branch || branch.workId !== snapshot.workId ||
			typeof snapshot.text !== "string" || !snapshot.contentHash ||
			!isIsoInstant(snapshot.createdAt) ||
			(snapshot.sourceRevisionId &&
				(!sourceRevision || sourceRevision.workId !== snapshot.workId))
		) {
			throw new Error(`Invalid Recovery Snapshot: ${snapshot.id}`);
		}
		if (
			snapshot.protection &&
			(!["user", "import", "schema-migration", "revision-source"].includes(
				snapshot.protection.reason,
			) ||
				!isIsoInstant(snapshot.protection.protectedAt) ||
				(snapshot.protection.expiresAt !== undefined &&
					!isIsoInstant(snapshot.protection.expiresAt)))
		) {
			throw new Error(`Invalid Recovery Snapshot protection: ${snapshot.id}`);
		}
	}
	for (const occurrence of state.occurrences) {
		if (
			!workById.has(occurrence.workId) || !Number.isFinite(occurrence.orderKey) ||
			(occurrence.parentOccurrenceId !== null &&
				!occurrenceById.has(occurrence.parentOccurrenceId))
		) {
			throw new Error(`Invalid Occurrence: ${occurrence.id}`);
		}
		if (occurrence.revisionSelector.mode === "branch") {
			const branch = branchById.get(occurrence.revisionSelector.branchId);
			if (!branch || branch.workId !== occurrence.workId) {
				throw new Error(`Invalid Occurrence Branch: ${occurrence.id}`);
			}
		} else {
			const revision = revisionById.get(occurrence.revisionSelector.revisionId);
			if (!revision || revision.workId !== occurrence.workId) {
				throw new Error(`Invalid Occurrence Revision: ${occurrence.id}`);
			}
		}
	}
	for (const link of state.links) {
		validateLinkEndpoint(link.from, workById, revisionById, link.id);
		validateLinkEndpoint(link.to, workById, revisionById, link.id);
		if (link.fromId !== link.from.workId || link.toId !== link.to.workId) {
			throw new Error(`Invalid Link endpoint IDs: ${link.id}`);
		}
		if (
			!(LINK_TYPES as readonly string[]).includes(link.type) ||
			!["provisional", "asserted", "retracted"].includes(link.status) ||
			!["human", "suggestion", "import"].includes(link.origin) ||
			!isIsoInstant(link.createdAt)
		) {
			throw new Error(`Invalid Link: ${link.id}`);
		}
	}
	for (const relation of state.systemRelations) {
		if (
			!workById.has(relation.fromWorkId) || !workById.has(relation.toWorkId) ||
			relation.type !== "IN" || !isIsoInstant(relation.createdAt)
		) {
			throw new Error(`Invalid System Relation: ${relation.id}`);
		}
	}
	for (const knot of state.knots) {
		if (
			!Array.isArray(knot.cycleIds) ||
			knot.cycleIds.some((id) => !occurrenceById.has(id) && !purgedOccurrenceIds.has(id)) ||
			!isIsoInstant(knot.createdAt)
		) {
			throw new Error(`Invalid Knot: ${knot.id}`);
		}
	}
	for (const alias of state.aliases) {
		if (
			!alias.canonical || !Array.isArray(alias.variants) ||
			!isIsoInstant(alias.createdAt) || !isIsoInstant(alias.updatedAt)
		) {
			throw new Error(`Invalid Search Alias: ${alias.id}`);
		}
	}
	for (const suggestion of state.emergenceSuggestions) {
		if (
			(!workById.has(suggestion.contextWorkId) &&
				!purgedWorkIds.has(suggestion.contextWorkId)) ||
			(!workById.has(suggestion.targetWorkId) &&
				!purgedWorkIds.has(suggestion.targetWorkId)) ||
			(!purgedOccurrenceIds.has(suggestion.contextItemId) &&
				occurrenceById.get(suggestion.contextItemId)?.workId !== suggestion.contextWorkId) ||
			(!purgedOccurrenceIds.has(suggestion.targetItemId) &&
				occurrenceById.get(suggestion.targetItemId)?.workId !== suggestion.targetWorkId) ||
			!["pending", "accepted", "dismissed", "held"].includes(suggestion.persistenceStatus) ||
			!Number.isFinite(suggestion.score) || !Array.isArray(suggestion.evidence) ||
			!isIsoInstant(suggestion.createdAt) || !isIsoInstant(suggestion.updatedAt) ||
			(suggestion.resolvedAt !== undefined && !isIsoInstant(suggestion.resolvedAt))
		) {
			throw new Error(`Invalid Emergence Suggestion: ${suggestion.id}`);
		}
	}
	for (const query of state.savedRuleQueries) {
		if (
			!query.name || typeof query.source !== "string" ||
			!isIsoInstant(query.createdAt) || !isIsoInstant(query.updatedAt)
		) {
			throw new Error(`Invalid Saved Rule Query: ${query.id}`);
		}
	}
	for (const manifest of state.purgeManifests) {
		if (
			!manifest.workId || !Array.isArray(manifest.occurrenceIds) ||
			!Array.isArray(manifest.branchIds) || !Array.isArray(manifest.revisionIds) ||
			!Array.isArray(manifest.linkIds) || !isIsoInstant(manifest.purgedAt)
		) {
			throw new Error(`Invalid Purge Manifest: ${manifest.id}`);
		}
	}
	for (const bookmark of state.bookmarks) {
		const occurrence = occurrenceById.get(bookmark.occurrenceId);
		if (
			!workById.has(bookmark.workId) || occurrence?.workId !== bookmark.workId ||
			!isIsoInstant(bookmark.createdAt)
		) {
			throw new Error(`Invalid Bookmark: ${bookmark.id}`);
		}
	}
	if (state.resumePosition) {
		const occurrence = occurrenceById.get(state.resumePosition.occurrenceId);
		if (
			!workById.has(state.resumePosition.workId) ||
			occurrence?.workId !== state.resumePosition.workId ||
			!Number.isInteger(state.resumePosition.caretOffset) ||
			state.resumePosition.caretOffset < 0 || !isIsoInstant(state.resumePosition.updatedAt)
		) {
			throw new Error("Invalid Resume Position");
		}
	}
	for (const action of Object.values(state.emergenceFeedback)) {
		if (action !== "accept" && action !== "dismiss" && action !== "pin") {
			throw new Error("Invalid emergence feedback");
		}
	}
	return state;
}

function uniqueById<T extends { id: string }>(
	entries: readonly T[],
	label: string,
): Map<string, T> {
	const result = new Map<string, T>();
	for (const entry of entries) {
		if (!entry?.id || result.has(entry.id)) throw new Error(`${label} ID collision: ${entry?.id}`);
		result.set(entry.id, entry);
	}
	return result;
}

function isIsoInstant(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function assertRevisionDag(revisions: readonly Revision[]): void {
	const parents = new Map(revisions.map((revision) => [revision.id, revision.parentRevisionIds]));
	const complete = new Set<string>();
	const visit = (id: string, path: Set<string>): void => {
		if (complete.has(id)) return;
		if (path.has(id)) throw new Error(`Revision cycle: ${id}`);
		const nextPath = new Set(path).add(id);
		for (const parent of parents.get(id) ?? []) visit(parent, nextPath);
		complete.add(id);
	};
	for (const id of parents.keys()) visit(id, new Set());
}

function validateLinkEndpoint(
	endpoint: OutlineLink["from"],
	works: ReadonlyMap<string, Work>,
	revisions: ReadonlyMap<string, Revision>,
	linkId: string,
): void {
	if (!works.has(endpoint.workId)) throw new Error(`Invalid Link Work endpoint: ${linkId}`);
	if (endpoint.scope === "revision") {
		const revision = revisions.get(endpoint.revisionId);
		if (!revision || revision.workId !== endpoint.workId) {
			throw new Error(`Invalid Link Revision endpoint: ${linkId}`);
		}
	}
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
