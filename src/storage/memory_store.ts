import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LexicalHit,
	LinkEndpoint,
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
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import {
	type GraphStateSnapshot,
	type GraphStore,
	type MergeWorksInput,
	validatedGraphStateSnapshot,
	validateRevisionCreation,
	validateUnplacedWorkCreation,
	validateWorkBundleImport,
	type WorkBundle,
} from "./graph_store.ts";
import {
	mergedBranchName,
	projectOutlineItems,
	replaceEndpointWork,
	retractDuplicateActiveLinks,
	validateMergeInput,
} from "./memory_store_operations.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";

export class MemoryGraphStore implements GraphStore {
	protected works: Work[] = [];
	protected branches: Branch[] = [];
	protected workingCopies: WorkingCopy[] = [];
	protected revisions: Revision[] = [];
	protected recoverySnapshots: RecoverySnapshot[] = [];
	protected bookmarks: Bookmark[] = [];
	protected resumePosition: ResumePosition | null = null;
	protected occurrences: Occurrence[] = [];
	protected links: OutlineLink[] = [];
	protected systemRelations: SystemRelation[] = [];
	protected knots: Knot[] = [];
	protected aliases: SearchAlias[] = [];
	protected emergenceFeedback: Record<string, "accept" | "dismiss" | "pin"> = {};
	protected emergenceSuggestions: EmergenceSuggestion[] = [];
	protected savedRuleQueries: SavedRuleQuery[] = [];
	protected purgeManifests: PurgeManifest[] = [];

	initialize(): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	exportGraphState(): Promise<GraphStateSnapshot> {
		return Promise.resolve(structuredClone({
			works: this.works,
			branches: this.branches,
			workingCopies: this.workingCopies,
			occurrences: this.occurrences,
			links: this.links,
			systemRelations: this.systemRelations,
			knots: this.knots,
			aliases: this.aliases,
			emergenceFeedback: this.emergenceFeedback,
			emergenceSuggestions: this.emergenceSuggestions,
			savedRuleQueries: this.savedRuleQueries,
			purgeManifests: this.purgeManifests,
			revisions: this.revisions,
			recoverySnapshots: this.recoverySnapshots,
			bookmarks: this.bookmarks,
			resumePosition: this.resumePosition,
		}));
	}

	restoreGraphState(source: GraphStateSnapshot): Promise<void> {
		let state: GraphStateSnapshot;
		try {
			state = validatedGraphStateSnapshot(source);
		} catch (error) {
			return Promise.reject(error);
		}
		this.works = state.works;
		this.branches = state.branches;
		this.workingCopies = state.workingCopies;
		this.occurrences = state.occurrences;
		this.links = state.links;
		this.systemRelations = state.systemRelations;
		this.knots = state.knots;
		this.aliases = state.aliases;
		this.emergenceFeedback = state.emergenceFeedback;
		this.emergenceSuggestions = state.emergenceSuggestions;
		this.savedRuleQueries = state.savedRuleQueries;
		this.purgeManifests = state.purgeManifests;
		this.revisions = state.revisions;
		this.recoverySnapshots = state.recoverySnapshots;
		this.bookmarks = state.bookmarks;
		this.resumePosition = state.resumePosition;
		return Promise.resolve();
	}

	listItems(): Promise<OutlineItem[]> {
		return Promise.resolve(structuredClone(this.projectItems(false)));
	}

	listWorks(includeDeleted = false): Promise<Work[]> {
		return Promise.resolve(structuredClone(
			this.works.filter((work) => includeDeleted || (!work.deletedAt && !work.mergedIntoWorkId)),
		));
	}

	listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visibleWorkIds = new Set(
			this.works.filter((work) =>
				includeDeletedWorks || (!work.deletedAt && !work.mergedIntoWorkId)
			).map((work) => work.id),
		);
		return Promise.resolve(structuredClone(
			this.occurrences.filter((occurrence) => visibleWorkIds.has(occurrence.workId)),
		));
	}

	async mergeWorks(input: MergeWorksInput): Promise<void> {
		const source = this.works.find((work) => work.id === input.sourceWorkId);
		const survivor = this.works.find((work) => work.id === input.survivorWorkId);
		validateMergeInput(input, source, survivor, this.aliases);

		const next = structuredClone({
			works: this.works,
			branches: this.branches,
			workingCopies: this.workingCopies,
			revisions: this.revisions,
			recoverySnapshots: this.recoverySnapshots,
			bookmarks: this.bookmarks,
			resumePosition: this.resumePosition,
			occurrences: this.occurrences,
			links: this.links,
			systemRelations: this.systemRelations,
			aliases: this.aliases,
		});
		const takenNames = new Set(
			next.branches.filter((branch) => branch.workId === input.survivorWorkId).map((branch) =>
				branch.name
			),
		);
		for (const branch of next.branches.filter((entry) => entry.workId === input.sourceWorkId)) {
			branch.workId = input.survivorWorkId;
			branch.name = mergedBranchName(input.sourceWorkId, branch.name, takenNames);
			takenNames.add(branch.name);
		}
		for (const copy of next.workingCopies) {
			if (copy.workId === input.sourceWorkId) copy.workId = input.survivorWorkId;
		}
		for (const revision of next.revisions) {
			if (revision.workId === input.sourceWorkId) revision.workId = input.survivorWorkId;
		}
		for (const snapshot of next.recoverySnapshots) {
			if (snapshot.workId === input.sourceWorkId) snapshot.workId = input.survivorWorkId;
		}
		for (const occurrence of next.occurrences) {
			if (occurrence.workId === input.sourceWorkId) occurrence.workId = input.survivorWorkId;
		}
		for (const bookmark of next.bookmarks) {
			if (bookmark.workId === input.sourceWorkId) bookmark.workId = input.survivorWorkId;
		}
		if (next.resumePosition?.workId === input.sourceWorkId) {
			next.resumePosition.workId = input.survivorWorkId;
		}
		for (const link of next.links) {
			link.from = replaceEndpointWork(link.from, input);
			link.to = replaceEndpointWork(link.to, input);
			link.fromId = link.from.workId;
			link.toId = link.to.workId;
		}
		retractDuplicateActiveLinks(next.links);
		for (const relation of next.systemRelations) {
			if (relation.fromWorkId === input.sourceWorkId) {
				relation.fromWorkId = input.survivorWorkId;
			}
			if (relation.toWorkId === input.sourceWorkId) relation.toWorkId = input.survivorWorkId;
		}
		const sourceTombstone = next.works.find((work) => work.id === input.sourceWorkId)!;
		sourceTombstone.mergedIntoWorkId = input.survivorWorkId;
		sourceTombstone.mergedAt = input.mergedAt;
		const survivorNext = next.works.find((work) => work.id === input.survivorWorkId)!;
		survivorNext.updatedAt = input.mergedAt;
		if (input.alias) {
			next.aliases = [
				...next.aliases.filter((alias) => alias.id !== input.alias!.id),
				structuredClone(input.alias),
			];
		}

		Object.assign(this, next);
	}

	listBranches(workId?: string): Promise<Branch[]> {
		return Promise.resolve(structuredClone(
			this.branches.filter((branch) => workId == null || branch.workId === workId),
		));
	}

	listWorkingCopies(workId?: string): Promise<WorkingCopy[]> {
		return Promise.resolve(structuredClone(
			this.workingCopies.filter((copy) => workId == null || copy.workId === workId),
		));
	}

	listRevisions(workId?: string): Promise<Revision[]> {
		return Promise.resolve(structuredClone(
			this.revisions.filter((revision) => workId == null || revision.workId === workId),
		));
	}

	listRecoverySnapshots(workId?: string, branchId?: string): Promise<RecoverySnapshot[]> {
		return Promise.resolve(structuredClone(
			this.recoverySnapshots.filter((snapshot) =>
				(workId == null || snapshot.workId === workId) &&
				(branchId == null || snapshot.branchId === branchId)
			),
		));
	}

	listBookmarks(): Promise<Bookmark[]> {
		const activeWorkIds = new Set(
			this.works.filter((work) => !work.deletedAt).map((work) => work.id),
		);
		return Promise.resolve(structuredClone(
			this.bookmarks.filter((bookmark) => activeWorkIds.has(bookmark.workId)),
		));
	}

	getResumePosition(): Promise<ResumePosition | null> {
		const active = this.resumePosition &&
			this.works.some((work) => work.id === this.resumePosition?.workId && !work.deletedAt);
		return Promise.resolve(active ? structuredClone(this.resumePosition) : null);
	}

	createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		this.works.push(structuredClone(work));
		this.branches.push(structuredClone(branch));
		this.workingCopies.push(structuredClone(workingCopy));
		this.occurrences.push(structuredClone(occurrence));
		return Promise.resolve();
	}

	importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		try {
			validateWorkBundleImport(bundles, {
				works: this.works,
				branches: this.branches,
				workingCopies: this.workingCopies,
				occurrences: this.occurrences,
			});
		} catch (error) {
			return Promise.reject(error);
		}
		this.works = [...this.works, ...bundles.map((bundle) => structuredClone(bundle.work))];
		this.branches = [...this.branches, ...bundles.map((bundle) => structuredClone(bundle.branch))];
		this.workingCopies = [
			...this.workingCopies,
			...bundles.map((bundle) => structuredClone(bundle.workingCopy)),
		];
		this.occurrences = [
			...this.occurrences,
			...bundles.map((bundle) => structuredClone(bundle.occurrence)),
		];
		return Promise.resolve();
	}

	createUnplacedWork(work: Work, branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		try {
			validateUnplacedWorkCreation(
				work,
				branch,
				workingCopy,
				this.works,
				this.branches,
				this.workingCopies,
			);
		} catch (error) {
			return Promise.reject(error);
		}
		this.works.push(structuredClone(work));
		this.branches.push(structuredClone(branch));
		this.workingCopies.push(structuredClone(workingCopy));
		return Promise.resolve();
	}

	resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		const work = this.works.find((candidate) => candidate.id === workId);
		if (!work) return Promise.reject(new Error(`Work not found: ${workId}`));
		if (!work.stub) return Promise.reject(new Error(`Work is not a Stub: ${workId}`));
		this.works = this.works.map((candidate) => {
			if (candidate.id !== workId) return candidate;
			const resolved = { ...candidate, updatedAt };
			delete resolved.stub;
			return resolved;
		});
		return Promise.resolve();
	}

	createOccurrence(occurrence: Occurrence): Promise<void> {
		this.occurrences.push(structuredClone(occurrence));
		return Promise.resolve();
	}

	createBookmark(bookmark: Bookmark): Promise<void> {
		if (this.bookmarks.some((candidate) => candidate.id === bookmark.id)) {
			return Promise.reject(new Error(`Bookmark already exists: ${bookmark.id}`));
		}
		const occurrence = this.occurrences.find((candidate) => candidate.id === bookmark.occurrenceId);
		const work = this.works.find((candidate) =>
			candidate.id === bookmark.workId && !candidate.deletedAt
		);
		if (!work || occurrence?.workId !== bookmark.workId) {
			return Promise.reject(new Error("Bookmark Work and Occurrence must exist and match"));
		}
		this.bookmarks.push(structuredClone(bookmark));
		return Promise.resolve();
	}

	deleteBookmark(id: string): Promise<void> {
		this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
		return Promise.resolve();
	}

	setResumePosition(position: ResumePosition): Promise<void> {
		if (!Number.isSafeInteger(position.caretOffset) || position.caretOffset < 0) {
			return Promise.reject(new Error(`Invalid caret offset: ${position.caretOffset}`));
		}
		const occurrence = this.occurrences.find((candidate) => candidate.id === position.occurrenceId);
		const work = this.works.find((candidate) =>
			candidate.id === position.workId && !candidate.deletedAt
		);
		if (!work || occurrence?.workId !== position.workId) {
			return Promise.reject(new Error("Resume Work and Occurrence must exist and match"));
		}
		this.resumePosition = structuredClone(position);
		return Promise.resolve();
	}

	clearResumePosition(): Promise<void> {
		this.resumePosition = null;
		return Promise.resolve();
	}

	createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		if (branch.id !== workingCopy.branchId || branch.workId !== workingCopy.workId) {
			return Promise.reject(new Error("Branch and Working Copy identity must match"));
		}
		this.branches.push(structuredClone(branch));
		this.workingCopies.push(structuredClone(workingCopy));
		return Promise.resolve();
	}

	updateBranch(branch: Branch): Promise<void> {
		this.branches = this.branches.map((candidate) =>
			candidate.id === branch.id ? structuredClone(branch) : candidate
		);
		return Promise.resolve();
	}

	updateBranchWorkingCopy(branchId: string, text: string, updatedAt: string): Promise<void> {
		const copy = this.workingCopies.find((candidate) => candidate.branchId === branchId);
		if (!copy) return Promise.reject(new Error(`Working Copy not found for Branch: ${branchId}`));
		this.workingCopies = this.workingCopies.map((candidate) =>
			candidate.branchId === branchId ? { ...candidate, text, updatedAt } : candidate
		);
		this.works = this.works.map((work) => work.id === copy.workId ? { ...work, updatedAt } : work);
		return Promise.resolve();
	}

	updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		const main = this.branches.find((branch) => branch.workId === workId && branch.name === "main");
		if (!main) return Promise.reject(new Error(`Main Branch not found for Work: ${workId}`));
		return this.updateBranchWorkingCopy(main.id, text, updatedAt);
	}

	createRevision(revision: Revision, branchId: string): Promise<void> {
		const branch = this.branches.find((candidate) => candidate.id === branchId);
		try {
			validateRevisionCreation(revision, branch, this.revisions);
		} catch (error) {
			return Promise.reject(error);
		}
		this.revisions.push(structuredClone(revision));
		this.branches = this.branches.map((candidate) =>
			candidate.id === branchId ? { ...candidate, headRevisionId: revision.id } : candidate
		);
		return Promise.resolve();
	}

	createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		if (this.recoverySnapshots.some((candidate) => candidate.id === snapshot.id)) {
			return Promise.reject(new Error(`Recovery Snapshot already exists: ${snapshot.id}`));
		}
		const copy = this.workingCopies.find((candidate) => candidate.branchId === snapshot.branchId);
		if (!copy || copy.workId !== snapshot.workId) {
			return Promise.reject(new Error(`Working Copy not found for Snapshot: ${snapshot.branchId}`));
		}
		this.recoverySnapshots.push(structuredClone(snapshot));
		return Promise.resolve();
	}

	applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		const snapshot = this.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
		if (!snapshot) {
			return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
		}
		return this.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
	}

	restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		const target = this.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
		if (!target) {
			return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
		}
		const copy = this.workingCopies.find((candidate) => candidate.branchId === target.branchId);
		if (
			!copy || copy.workId !== target.workId ||
			beforeRestore.workId !== target.workId ||
			beforeRestore.branchId !== target.branchId
		) {
			return Promise.reject(new Error("Recovery Snapshot scope does not match Working Copy"));
		}
		if (this.recoverySnapshots.some((candidate) => candidate.id === beforeRestore.id)) {
			return Promise.reject(
				new Error(`Recovery Snapshot already exists: ${beforeRestore.id}`),
			);
		}
		if (beforeRestore.text !== copy.text) {
			return Promise.reject(new Error("Recovery Snapshot does not capture current Working Copy"));
		}
		this.recoverySnapshots.push(structuredClone(beforeRestore));
		this.workingCopies = this.workingCopies.map((candidate) =>
			candidate.branchId === target.branchId
				? { ...candidate, text: target.text, updatedAt }
				: candidate
		);
		this.works = this.works.map((work) =>
			work.id === target.workId ? { ...work, updatedAt } : work
		);
		return Promise.resolve();
	}

	promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		const snapshot = this.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
		const branch = this.branches.find((candidate) => candidate.id === branchId);
		if (!snapshot) {
			return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
		}
		if (
			snapshot.branchId !== branchId || snapshot.workId !== revision.workId ||
			branch?.workId !== snapshot.workId || revision.text !== snapshot.text
		) {
			return Promise.reject(new Error("Recovery Snapshot scope does not match Revision"));
		}
		try {
			validateRevisionCreation(revision, branch, this.revisions);
		} catch (error) {
			return Promise.reject(error);
		}
		this.revisions.push(structuredClone(revision));
		this.branches = this.branches.map((candidate) =>
			candidate.id === branchId ? { ...candidate, headRevisionId: revision.id } : candidate
		);
		this.recoverySnapshots = this.recoverySnapshots.map((candidate) =>
			candidate.id === snapshotId
				? {
					...candidate,
					protection: { reason: "revision-source", protectedAt },
				}
				: candidate
		);
		return Promise.resolve();
	}

	updateOccurrence(occurrence: Occurrence): Promise<void> {
		this.occurrences = this.occurrences.map((candidate) =>
			candidate.id === occurrence.id ? structuredClone(occurrence) : candidate
		);
		return Promise.resolve();
	}

	deleteOccurrence(id: string): Promise<void> {
		this.occurrences = this.occurrences.filter((occurrence) => occurrence.id !== id);
		return Promise.resolve();
	}

	trashWork(workId: string, deletedAt: string): Promise<void> {
		this.works = this.works.map((work) =>
			work.id === workId ? { ...work, deletedAt, updatedAt: deletedAt } : work
		);
		return Promise.resolve();
	}

	restoreWork(workId: string): Promise<void> {
		this.works = this.works.map((work) => {
			if (work.id !== workId) return work;
			const restored = { ...work };
			delete restored.deletedAt;
			return restored;
		});
		const occurrenceIds = new Set(this.occurrences.map((occurrence) => occurrence.id));
		this.occurrences = this.occurrences.map((occurrence) =>
			occurrence.workId === workId && occurrence.parentOccurrenceId &&
				!occurrenceIds.has(occurrence.parentOccurrenceId)
				? { ...occurrence, parentOccurrenceId: null }
				: occurrence
		);
		return Promise.resolve();
	}

	purgeWork(workId: string): Promise<PurgeManifest> {
		const work = this.works.find((candidate) => candidate.id === workId);
		if (!work?.deletedAt) {
			return Promise.reject(new Error(`Work must be in trash before it can be purged: ${workId}`));
		}
		const branchIds = new Set(
			this.branches.filter((branch) => branch.workId === workId).map((branch) => branch.id),
		);
		const manifest: PurgeManifest = {
			id: crypto.randomUUID(),
			workId,
			occurrenceIds: this.occurrences
				.filter((occurrence) => occurrence.workId === workId)
				.map((occurrence) => occurrence.id),
			branchIds: [...branchIds],
			revisionIds: [],
			linkIds: this.links
				.filter((link) => link.from.workId === workId || link.to.workId === workId)
				.map((link) => link.id),
			purgedAt: new Date().toISOString(),
		};
		this.purgeManifests.push(manifest);
		this.works = this.works.filter((work) => work.id !== workId);
		this.branches = this.branches.filter((branch) => branch.workId !== workId);
		this.workingCopies = this.workingCopies.filter((copy) =>
			copy.workId !== workId && !branchIds.has(copy.branchId)
		);
		manifest.revisionIds = this.revisions
			.filter((revision) => revision.workId === workId)
			.map((revision) => revision.id);
		this.revisions = this.revisions.filter((revision) => revision.workId !== workId);
		this.recoverySnapshots = this.recoverySnapshots.filter((snapshot) =>
			snapshot.workId !== workId
		);
		this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.workId !== workId);
		if (this.resumePosition?.workId === workId) this.resumePosition = null;
		this.occurrences = this.occurrences.filter((occurrence) => occurrence.workId !== workId);
		const remainingOccurrenceIds = new Set(this.occurrences.map((occurrence) => occurrence.id));
		this.occurrences = this.occurrences.map((occurrence) =>
			occurrence.parentOccurrenceId && !remainingOccurrenceIds.has(occurrence.parentOccurrenceId)
				? { ...occurrence, parentOccurrenceId: null }
				: occurrence
		);
		this.links = this.links.filter((link) =>
			link.from.workId !== workId && link.to.workId !== workId
		);
		return Promise.resolve(structuredClone(manifest));
	}

	listPurgeManifests(): Promise<PurgeManifest[]> {
		return Promise.resolve(structuredClone(this.purgeManifests));
	}

	listLinks(): Promise<OutlineLink[]> {
		return Promise.resolve(structuredClone(this.links));
	}
	createLink(link: OutlineLink): Promise<void> {
		this.links.push(structuredClone(link));
		return Promise.resolve();
	}
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		this.links = this.links.map((link) =>
			link.fromId === fromId && link.toId === toId && link.type === type &&
				link.status !== "retracted"
				? { ...link, status: "retracted" }
				: link
		);
		return Promise.resolve();
	}

	listSystemRelations(): Promise<SystemRelation[]> {
		return Promise.resolve(structuredClone(this.systemRelations));
	}
	listKnots(): Promise<Knot[]> {
		return Promise.resolve(structuredClone(this.knots));
	}
	replaceKnots(knots: Knot[]): Promise<void> {
		this.knots = structuredClone(knots);
		return Promise.resolve();
	}
	suggestItems(prefix: string, limit: number): Promise<OutlineItem[]> {
		const normalized = normalizeSearchText(prefix);
		if (!normalized) return Promise.resolve([]);
		const items = this.representativeItems();
		return Promise.resolve(structuredClone(
			items
				.filter((item) => normalizeSearchText(titleOf(item)).startsWith(normalized))
				.sort((a, b) =>
					titleOf(a).length - titleOf(b).length || b.updatedAt.localeCompare(a.updatedAt)
				)
				.slice(0, limit),
		));
	}
	searchLexical(query: string, limit: number): Promise<LexicalHit[]> {
		const normalized = normalizeSearchText(query);
		const tokenized = searchTerms(query).split(" ").filter(Boolean);
		if (!normalized) return Promise.resolve([]);
		const hits = this.representativeItems().map((item) => {
			const title = normalizeSearchText(titleOf(item));
			const body = normalizeSearchText(item.text);
			const titleCount = countOccurrences(title, normalized) +
				tokenized.reduce((score, token) => score + countOccurrences(title, token), 0);
			const bodyCount = countOccurrences(body, normalized) +
				tokenized.reduce((score, token) => score + countOccurrences(body, token), 0);
			return {
				item,
				titleScore: title === normalized ? 3 : title.startsWith(normalized) ? 2 : titleCount,
				bodyScore: bodyCount,
			};
		}).filter((hit) => hit.titleScore > 0 || hit.bodyScore > 0)
			.sort((a, b) => (b.titleScore * 2 + b.bodyScore) - (a.titleScore * 2 + a.bodyScore))
			.slice(0, limit);
		return Promise.resolve(structuredClone(hits));
	}
	listAliases(): Promise<SearchAlias[]> {
		return Promise.resolve(structuredClone(this.aliases));
	}
	upsertAlias(alias: SearchAlias): Promise<void> {
		this.aliases = [
			...this.aliases.filter((candidate) => candidate.id !== alias.id),
			structuredClone(alias),
		];
		return Promise.resolve();
	}
	deleteAlias(id: string): Promise<void> {
		this.aliases = this.aliases.filter((alias) => alias.id !== id);
		return Promise.resolve();
	}
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null> {
		return Promise.resolve(this.emergenceFeedback[id] ?? null);
	}
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void> {
		this.emergenceFeedback[id] = action;
		return Promise.resolve();
	}
	listEmergenceSuggestions(): Promise<EmergenceSuggestion[]> {
		return Promise.resolve(structuredClone(this.emergenceSuggestions));
	}
	upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		const existing = this.emergenceSuggestions.find((candidate) => candidate.id === suggestion.id);
		this.emergenceSuggestions = [
			...this.emergenceSuggestions.filter((candidate) => candidate.id !== suggestion.id),
			structuredClone(
				existing
					? {
						...suggestion,
						persistenceStatus: existing.persistenceStatus,
						createdAt: existing.createdAt,
						resolvedAt: existing.resolvedAt,
						resolutionReason: existing.resolutionReason,
					}
					: suggestion,
			),
		];
		return Promise.resolve();
	}
	resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		const index = this.emergenceSuggestions.findIndex((candidate) => candidate.id === id);
		if (index < 0) return Promise.reject(new Error(`Emergence suggestion not found: ${id}`));
		const current = this.emergenceSuggestions[index];
		const status = action === "accept" ? "accepted" : action === "dismiss" ? "dismissed" : "held";
		if (current.persistenceStatus === status) return Promise.resolve();
		if (current.persistenceStatus === "accepted" || current.persistenceStatus === "dismissed") {
			return Promise.reject(new Error(`Emergence suggestion already resolved: ${id}`));
		}
		const normalizedReason = reason?.trim();
		if (action === "dismiss" && !normalizedReason) {
			return Promise.reject(new Error("Dismissed emergence suggestion requires a reason"));
		}
		if (action === "accept") {
			if (!link || link.origin !== "suggestion" || link.status !== "asserted") {
				return Promise.reject(
					new Error("Accepted emergence suggestion requires an asserted suggestion link"),
				);
			}
			const endpointsMatch = (link.from.workId === current.contextWorkId &&
				link.to.workId === current.targetWorkId) ||
				(isSymmetricLinkType(link.type) &&
					link.from.workId === current.targetWorkId &&
					link.to.workId === current.contextWorkId);
			if (!endpointsMatch || link.type !== current.proposedLinkType) {
				return Promise.reject(new Error("Emergence suggestion link does not match its proposal"));
			}
			const duplicate = this.links.some((candidate) =>
				candidate.status !== "retracted" &&
				candidate.origin === "suggestion" &&
				candidate.from.scope === "work" &&
				candidate.to.scope === "work" &&
				candidate.type === link.type &&
				((candidate.from.workId === link.from.workId &&
					candidate.to.workId === link.to.workId) ||
					(isSymmetricLinkType(link.type) &&
						candidate.from.workId === link.to.workId &&
						candidate.to.workId === link.from.workId))
			);
			if (!duplicate) this.links.push(structuredClone(link));
		}
		const now = new Date().toISOString();
		this.emergenceSuggestions[index] = {
			...current,
			persistenceStatus: status,
			status: status === "held" ? "pinned" : undefined,
			updatedAt: now,
			resolvedAt: status === "held" ? undefined : now,
			resolutionReason: normalizedReason,
		};
		return Promise.resolve();
	}
	listSavedRuleQueries(): Promise<SavedRuleQuery[]> {
		return Promise.resolve(structuredClone(this.savedRuleQueries));
	}
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		this.savedRuleQueries = [
			...this.savedRuleQueries.filter((candidate) => candidate.id !== query.id),
			structuredClone(query),
		];
		return Promise.resolve();
	}
	deleteSavedRuleQuery(id: string): Promise<void> {
		this.savedRuleQueries = this.savedRuleQueries.filter((query) => query.id !== id);
		return Promise.resolve();
	}

	private projectItems(includeDeleted: boolean): OutlineItem[] {
		return projectOutlineItems(
			this.works,
			this.workingCopies,
			this.revisions,
			this.occurrences,
			includeDeleted,
		);
	}

	private representativeItems(): OutlineItem[] {
		const byWork = new Map<string, OutlineItem>();
		for (const item of this.projectItems(false)) {
			if (!byWork.has(item.workId)) byWork.set(item.workId, item);
		}
		return [...byWork.values()];
	}
}
