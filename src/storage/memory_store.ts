import type {
	Bookmark,
	Branch,
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
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import {
	type GraphStore,
	validateRevisionCreation,
	validateUnplacedWorkCreation,
} from "./graph_store.ts";
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
	protected savedRuleQueries: SavedRuleQuery[] = [];
	protected purgeManifests: PurgeManifest[] = [];

	initialize(): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	listItems(): Promise<OutlineItem[]> {
		return Promise.resolve(structuredClone(this.projectItems(false)));
	}

	listWorks(includeDeleted = false): Promise<Work[]> {
		return Promise.resolve(structuredClone(
			this.works.filter((work) => includeDeleted || !work.deletedAt),
		));
	}

	listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visibleWorkIds = new Set(
			this.works.filter((work) => includeDeletedWorks || !work.deletedAt).map((work) => work.id),
		);
		return Promise.resolve(structuredClone(
			this.occurrences.filter((occurrence) => visibleWorkIds.has(occurrence.workId)),
		));
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
		const workById = new Map(
			this.works.filter((work) => includeDeleted || !work.deletedAt).map((work) => [work.id, work]),
		);
		const copyByBranchId = new Map(this.workingCopies.map((copy) => [copy.branchId, copy]));
		const revisionById = new Map(this.revisions.map((revision) => [revision.id, revision]));
		return this.occurrences.flatMap((occurrence): OutlineItem[] => {
			const work = workById.get(occurrence.workId);
			if (!work) return [];
			const text = occurrence.revisionSelector.mode === "branch"
				? copyByBranchId.get(occurrence.revisionSelector.branchId)?.text ?? ""
				: revisionById.get(occurrence.revisionSelector.revisionId)?.text ?? "";
			return [{
				id: occurrence.id,
				workId: occurrence.workId,
				text,
				parentId: occurrence.parentOccurrenceId,
				orderKey: occurrence.orderKey,
				collapsed: occurrence.collapsed,
				revisionSelector: structuredClone(occurrence.revisionSelector),
				contextualHeading: occurrence.contextualHeading,
				createdAt: work.createdAt,
				updatedAt: work.updatedAt,
			}];
		});
	}

	private representativeItems(): OutlineItem[] {
		const byWork = new Map<string, OutlineItem>();
		for (const item of this.projectItems(false)) {
			if (!byWork.has(item.workId)) byWork.set(item.workId, item);
		}
		return [...byWork.values()];
	}
}
