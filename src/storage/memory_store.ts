import type { HistoricalTime } from "../domain/historical_time.ts";
import { resolveWorkStub, updateHistoricalTime } from "./memory_work_metadata.ts";
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
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SystemRelation,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import {
	BUILT_IN_RELATION_TYPES,
	isRelationTypeSymmetric,
	validateRelationTypeDefinitions,
} from "../domain/relation_type.ts";
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

import { MemoryStateContainer } from "./memory_state_container.ts";

export class MemoryGraphStore implements GraphStore {
	readonly state: MemoryStateContainer;

	constructor(state?: MemoryStateContainer) {
		this.state = state ?? new MemoryStateContainer();
	}
	initialize(): Promise<void> {
		return Promise.resolve();
	}

	close(): Promise<void> {
		return Promise.resolve();
	}

	exportGraphState(): Promise<GraphStateSnapshot> {
		return Promise.resolve(this.state.exportGraphState());
	}

	restoreGraphState(source: GraphStateSnapshot): Promise<void> {
		try {
			this.state.restoreGraphState(source);
			return Promise.resolve();
		} catch (error) {
			return Promise.reject(error);
		}
	}

	listRelationTypeDefinitions(): Promise<RelationTypeDefinition[]> {
		return Promise.resolve(structuredClone(this.state.relationTypeDefinitions));
	}

	createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		let validated: RelationTypeDefinition[];
		try {
			validated = validateRelationTypeDefinitions([
				...this.state.relationTypeDefinitions,
				definition,
			]);
		} catch (error) {
			return Promise.reject(error);
		}
		this.state.relationTypeDefinitions = validated;
		return Promise.resolve();
	}

	listItems(): Promise<OutlineItem[]> {
		return Promise.resolve(structuredClone(this.projectItems(false)));
	}

	listWorks(includeDeleted = false): Promise<Work[]> {
		return Promise.resolve(structuredClone(
			this.state.works.filter((work) =>
				includeDeleted || (!work.deletedAt && !work.mergedIntoWorkId)
			),
		));
	}

	listOccurrences(includeDeletedWorks = false): Promise<Occurrence[]> {
		const visibleWorkIds = new Set(
			this.state.works.filter((work) =>
				includeDeletedWorks || (!work.deletedAt && !work.mergedIntoWorkId)
			).map((work) => work.id),
		);
		return Promise.resolve(structuredClone(
			this.state.occurrences.filter((occurrence) => visibleWorkIds.has(occurrence.workId)),
		));
	}

	async mergeWorks(input: MergeWorksInput): Promise<void> {
		const source = this.state.works.find((work) => work.id === input.sourceWorkId);
		const survivor = this.state.works.find((work) => work.id === input.survivorWorkId);
		validateMergeInput(input, source, survivor, this.state.aliases);

		const next = structuredClone({
			works: this.state.works,
			branches: this.state.branches,
			workingCopies: this.state.workingCopies,
			revisions: this.state.revisions,
			recoverySnapshots: this.state.recoverySnapshots,
			bookmarks: this.state.bookmarks,
			resumePosition: this.state.resumePosition,
			occurrences: this.state.occurrences,
			links: this.state.links,
			systemRelations: this.state.systemRelations,
			aliases: this.state.aliases,
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
		retractDuplicateActiveLinks(next.links, this.state.relationTypeDefinitions);
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

		Object.assign(this.state, next);
	}

	listBranches(workId?: string): Promise<Branch[]> {
		return Promise.resolve(structuredClone(
			this.state.branches.filter((branch) => workId == null || branch.workId === workId),
		));
	}

	listWorkingCopies(workId?: string): Promise<WorkingCopy[]> {
		return Promise.resolve(structuredClone(
			this.state.workingCopies.filter((copy) => workId == null || copy.workId === workId),
		));
	}

	listRevisions(workId?: string): Promise<Revision[]> {
		return Promise.resolve(structuredClone(
			this.state.revisions.filter((revision) => workId == null || revision.workId === workId),
		));
	}

	listRecoverySnapshots(workId?: string, branchId?: string): Promise<RecoverySnapshot[]> {
		return Promise.resolve(structuredClone(
			this.state.recoverySnapshots.filter((snapshot) =>
				(workId == null || snapshot.workId === workId) &&
				(branchId == null || snapshot.branchId === branchId)
			),
		));
	}

	listBookmarks(): Promise<Bookmark[]> {
		const activeWorkIds = new Set(
			this.state.works.filter((work) => !work.deletedAt).map((work) => work.id),
		);
		return Promise.resolve(structuredClone(
			this.state.bookmarks.filter((bookmark) => activeWorkIds.has(bookmark.workId)),
		));
	}

	getResumePosition(): Promise<ResumePosition | null> {
		const active = this.state.resumePosition &&
			this.state.works.some((work) =>
				work.id === this.state.resumePosition?.workId && !work.deletedAt
			);
		return Promise.resolve(active ? structuredClone(this.state.resumePosition) : null);
	}

	createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		this.state.works.push(structuredClone(work));
		this.state.branches.push(structuredClone(branch));
		this.state.workingCopies.push(structuredClone(workingCopy));
		this.state.occurrences.push(structuredClone(occurrence));
		return Promise.resolve();
	}

	importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		try {
			validateWorkBundleImport(bundles, {
				works: this.state.works,
				branches: this.state.branches,
				workingCopies: this.state.workingCopies,
				occurrences: this.state.occurrences,
			});
		} catch (error) {
			return Promise.reject(error);
		}
		this.state.works = [
			...this.state.works,
			...bundles.map((bundle) => structuredClone(bundle.work)),
		];
		this.state.branches = [
			...this.state.branches,
			...bundles.map((bundle) => structuredClone(bundle.branch)),
		];
		this.state.workingCopies = [
			...this.state.workingCopies,
			...bundles.map((bundle) => structuredClone(bundle.workingCopy)),
		];
		this.state.occurrences = [
			...this.state.occurrences,
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
				this.state.works,
				this.state.branches,
				this.state.workingCopies,
			);
		} catch (error) {
			return Promise.reject(error);
		}
		this.state.works.push(structuredClone(work));
		this.state.branches.push(structuredClone(branch));
		this.state.workingCopies.push(structuredClone(workingCopy));
		return Promise.resolve();
	}

	async resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		this.state.works = resolveWorkStub(this.state.works, workId, updatedAt);
	}

	async setWorkHistoricalTime(
		workId: string,
		value: HistoricalTime | null,
		updatedAt: string,
	): Promise<void> {
		updateHistoricalTime(this.state.works, workId, value, updatedAt);
	}

	createOccurrence(occurrence: Occurrence): Promise<void> {
		this.state.occurrences.push(structuredClone(occurrence));
		return Promise.resolve();
	}

	createBookmark(bookmark: Bookmark): Promise<void> {
		if (this.state.bookmarks.some((candidate) => candidate.id === bookmark.id)) {
			return Promise.reject(new Error(`Bookmark already exists: ${bookmark.id}`));
		}
		const occurrence = this.state.occurrences.find((candidate) =>
			candidate.id === bookmark.occurrenceId
		);
		const work = this.state.works.find((candidate) =>
			candidate.id === bookmark.workId && !candidate.deletedAt
		);
		if (!work || occurrence?.workId !== bookmark.workId) {
			return Promise.reject(new Error("Bookmark Work and Occurrence must exist and match"));
		}
		this.state.bookmarks.push(structuredClone(bookmark));
		return Promise.resolve();
	}

	deleteBookmark(id: string): Promise<void> {
		this.state.bookmarks = this.state.bookmarks.filter((bookmark) => bookmark.id !== id);
		return Promise.resolve();
	}

	setResumePosition(position: ResumePosition): Promise<void> {
		if (!Number.isSafeInteger(position.caretOffset) || position.caretOffset < 0) {
			return Promise.reject(new Error(`Invalid caret offset: ${position.caretOffset}`));
		}
		const occurrence = this.state.occurrences.find((candidate) =>
			candidate.id === position.occurrenceId
		);
		const work = this.state.works.find((candidate) =>
			candidate.id === position.workId && !candidate.deletedAt
		);
		if (!work || occurrence?.workId !== position.workId) {
			return Promise.reject(new Error("Resume Work and Occurrence must exist and match"));
		}
		this.state.resumePosition = structuredClone(position);
		return Promise.resolve();
	}

	clearResumePosition(): Promise<void> {
		this.state.resumePosition = null;
		return Promise.resolve();
	}

	createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		if (branch.id !== workingCopy.branchId || branch.workId !== workingCopy.workId) {
			return Promise.reject(new Error("Branch and Working Copy identity must match"));
		}
		this.state.branches.push(structuredClone(branch));
		this.state.workingCopies.push(structuredClone(workingCopy));
		return Promise.resolve();
	}

	updateBranch(branch: Branch): Promise<void> {
		this.state.branches = this.state.branches.map((candidate) =>
			candidate.id === branch.id ? structuredClone(branch) : candidate
		);
		return Promise.resolve();
	}

	updateBranchWorkingCopy(branchId: string, text: string, updatedAt: string): Promise<void> {
		const copy = this.state.workingCopies.find((candidate) => candidate.branchId === branchId);
		if (!copy) return Promise.reject(new Error(`Working Copy not found for Branch: ${branchId}`));
		this.state.workingCopies = this.state.workingCopies.map((candidate) =>
			candidate.branchId === branchId ? { ...candidate, text, updatedAt } : candidate
		);
		this.state.works = this.state.works.map((work) =>
			work.id === copy.workId ? { ...work, updatedAt } : work
		);
		return Promise.resolve();
	}

	updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		const main = this.state.branches.find((branch) =>
			branch.workId === workId && branch.name === "main"
		);
		if (!main) return Promise.reject(new Error(`Main Branch not found for Work: ${workId}`));
		return this.updateBranchWorkingCopy(main.id, text, updatedAt);
	}

	createRevision(revision: Revision, branchId: string): Promise<void> {
		const branch = this.state.branches.find((candidate) => candidate.id === branchId);
		try {
			validateRevisionCreation(revision, branch, this.state.revisions);
		} catch (error) {
			return Promise.reject(error);
		}
		this.appendRevisionToBranch(revision, branchId);
		return Promise.resolve();
	}

	private appendRevisionToBranch(revision: Revision, branchId: string): void {
		this.state.revisions.push(structuredClone(revision));
		this.state.branches = this.state.branches.map((candidate) =>
			candidate.id === branchId ? { ...candidate, headRevisionId: revision.id } : candidate
		);
	}

	createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		if (this.state.recoverySnapshots.some((candidate) => candidate.id === snapshot.id)) {
			return Promise.reject(new Error(`Recovery Snapshot already exists: ${snapshot.id}`));
		}
		const copy = this.state.workingCopies.find((candidate) =>
			candidate.branchId === snapshot.branchId
		);
		if (!copy || copy.workId !== snapshot.workId) {
			return Promise.reject(new Error(`Working Copy not found for Snapshot: ${snapshot.branchId}`));
		}
		this.state.recoverySnapshots.push(structuredClone(snapshot));
		return Promise.resolve();
	}

	applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		const snapshot = this.state.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
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
		const target = this.state.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
		if (!target) {
			return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
		}
		const copy = this.state.workingCopies.find((candidate) =>
			candidate.branchId === target.branchId
		);
		if (
			!copy || copy.workId !== target.workId ||
			beforeRestore.workId !== target.workId ||
			beforeRestore.branchId !== target.branchId
		) {
			return Promise.reject(new Error("Recovery Snapshot scope does not match Working Copy"));
		}
		if (this.state.recoverySnapshots.some((candidate) => candidate.id === beforeRestore.id)) {
			return Promise.reject(
				new Error(`Recovery Snapshot already exists: ${beforeRestore.id}`),
			);
		}
		if (beforeRestore.text !== copy.text) {
			return Promise.reject(new Error("Recovery Snapshot does not capture current Working Copy"));
		}
		this.state.recoverySnapshots.push(structuredClone(beforeRestore));
		this.state.workingCopies = this.state.workingCopies.map((candidate) =>
			candidate.branchId === target.branchId
				? { ...candidate, text: target.text, updatedAt }
				: candidate
		);
		this.state.works = this.state.works.map((work) =>
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
		const snapshot = this.state.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
		const branch = this.state.branches.find((candidate) => candidate.id === branchId);
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
			validateRevisionCreation(revision, branch, this.state.revisions);
		} catch (error) {
			return Promise.reject(error);
		}
		this.appendRevisionToBranch(revision, branchId);
		this.state.recoverySnapshots = this.state.recoverySnapshots.map((candidate) =>
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
		this.state.occurrences = this.state.occurrences.map((candidate) =>
			candidate.id === occurrence.id ? structuredClone(occurrence) : candidate
		);
		return Promise.resolve();
	}

	deleteOccurrence(id: string): Promise<void> {
		this.state.occurrences = this.state.occurrences.filter((occurrence) => occurrence.id !== id);
		return Promise.resolve();
	}

	trashWork(workId: string, deletedAt: string): Promise<void> {
		this.state.works = this.state.works.map((work) =>
			work.id === workId ? { ...work, deletedAt, updatedAt: deletedAt } : work
		);
		return Promise.resolve();
	}

	restoreWork(workId: string): Promise<void> {
		this.state.works = this.state.works.map((work) => {
			if (work.id !== workId) return work;
			const restored = { ...work };
			delete restored.deletedAt;
			return restored;
		});
		const occurrenceIds = new Set(this.state.occurrences.map((occurrence) => occurrence.id));
		this.state.occurrences = this.state.occurrences.map((occurrence) =>
			occurrence.workId === workId && occurrence.parentOccurrenceId &&
				!occurrenceIds.has(occurrence.parentOccurrenceId)
				? { ...occurrence, parentOccurrenceId: null }
				: occurrence
		);
		return Promise.resolve();
	}

	purgeWork(workId: string): Promise<PurgeManifest> {
		const work = this.state.works.find((candidate) => candidate.id === workId);
		if (!work?.deletedAt) {
			return Promise.reject(new Error(`Work must be in trash before it can be purged: ${workId}`));
		}
		const branchIds = new Set(
			this.state.branches.filter((branch) => branch.workId === workId).map((branch) => branch.id),
		);
		const manifest: PurgeManifest = {
			id: crypto.randomUUID(),
			workId,
			occurrenceIds: this.state.occurrences
				.filter((occurrence) => occurrence.workId === workId)
				.map((occurrence) => occurrence.id),
			branchIds: [...branchIds],
			revisionIds: [],
			linkIds: this.state.links
				.filter((link) => link.from.workId === workId || link.to.workId === workId)
				.map((link) => link.id),
			purgedAt: new Date().toISOString(),
		};
		this.state.purgeManifests.push(manifest);
		this.state.works = this.state.works.filter((work) => work.id !== workId);
		this.state.branches = this.state.branches.filter((branch) => branch.workId !== workId);
		this.state.workingCopies = this.state.workingCopies.filter((copy) =>
			copy.workId !== workId && !branchIds.has(copy.branchId)
		);
		manifest.revisionIds = this.state.revisions
			.filter((revision) => revision.workId === workId)
			.map((revision) => revision.id);
		this.state.revisions = this.state.revisions.filter((revision) => revision.workId !== workId);
		this.state.recoverySnapshots = this.state.recoverySnapshots.filter((snapshot) =>
			snapshot.workId !== workId
		);
		this.state.bookmarks = this.state.bookmarks.filter((bookmark) => bookmark.workId !== workId);
		if (this.state.resumePosition?.workId === workId) this.state.resumePosition = null;
		this.state.occurrences = this.state.occurrences.filter((occurrence) =>
			occurrence.workId !== workId
		);
		const remainingOccurrenceIds = new Set(
			this.state.occurrences.map((occurrence) => occurrence.id),
		);
		this.state.occurrences = this.state.occurrences.map((occurrence) =>
			occurrence.parentOccurrenceId && !remainingOccurrenceIds.has(occurrence.parentOccurrenceId)
				? { ...occurrence, parentOccurrenceId: null }
				: occurrence
		);
		this.state.links = this.state.links.filter((link) =>
			link.from.workId !== workId && link.to.workId !== workId
		);
		return Promise.resolve(structuredClone(manifest));
	}

	listPurgeManifests(): Promise<PurgeManifest[]> {
		return Promise.resolve(structuredClone(this.state.purgeManifests));
	}

	listLinks(): Promise<OutlineLink[]> {
		return Promise.resolve(structuredClone(this.state.links));
	}
	createLink(link: OutlineLink): Promise<void> {
		this.state.links.push(structuredClone(link));
		return Promise.resolve();
	}
	deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		this.state.links = this.state.links.map((link) =>
			link.fromId === fromId && link.toId === toId && link.type === type &&
				link.status !== "retracted"
				? { ...link, status: "retracted" }
				: link
		);
		return Promise.resolve();
	}

	listSystemRelations(): Promise<SystemRelation[]> {
		return Promise.resolve(structuredClone(this.state.systemRelations));
	}
	listKnots(): Promise<Knot[]> {
		return Promise.resolve(structuredClone(this.state.knots));
	}
	replaceKnots(knots: Knot[]): Promise<void> {
		this.state.knots = structuredClone(knots);
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
		return Promise.resolve(structuredClone(this.state.aliases));
	}
	upsertAlias(alias: SearchAlias): Promise<void> {
		this.state.aliases = [
			...this.state.aliases.filter((candidate) => candidate.id !== alias.id),
			structuredClone(alias),
		];
		return Promise.resolve();
	}
	deleteAlias(id: string): Promise<void> {
		this.state.aliases = this.state.aliases.filter((alias) => alias.id !== id);
		return Promise.resolve();
	}
	getEmergenceFeedback(id: string): Promise<"accept" | "dismiss" | "pin" | null> {
		return Promise.resolve(this.state.emergenceFeedback[id] ?? null);
	}
	setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void> {
		this.state.emergenceFeedback[id] = action;
		return Promise.resolve();
	}
	listEmergenceSuggestions(): Promise<EmergenceSuggestion[]> {
		return Promise.resolve(structuredClone(this.state.emergenceSuggestions));
	}
	upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		const existing = this.state.emergenceSuggestions.find((candidate) =>
			candidate.id === suggestion.id
		);
		this.state.emergenceSuggestions = [
			...this.state.emergenceSuggestions.filter((candidate) => candidate.id !== suggestion.id),
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
		const index = this.state.emergenceSuggestions.findIndex((candidate) => candidate.id === id);
		if (index < 0) return Promise.reject(new Error(`Emergence suggestion not found: ${id}`));
		const current = this.state.emergenceSuggestions[index];
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
			const isSymmetric = isRelationTypeSymmetric(link.type, this.state.relationTypeDefinitions);
			const endpointsMatch = (link.from.workId === current.contextWorkId &&
				link.to.workId === current.targetWorkId) ||
				(isSymmetric &&
					link.from.workId === current.targetWorkId &&
					link.to.workId === current.contextWorkId);
			if (!endpointsMatch || link.type !== current.proposedLinkType) {
				return Promise.reject(new Error("Emergence suggestion link does not match its proposal"));
			}
			const duplicate = this.state.links.some((candidate) =>
				candidate.status !== "retracted" &&
				candidate.origin === "suggestion" &&
				candidate.from.scope === "work" &&
				candidate.to.scope === "work" &&
				candidate.type === link.type &&
				((candidate.from.workId === link.from.workId &&
					candidate.to.workId === link.to.workId) ||
					(isSymmetric &&
						candidate.from.workId === link.to.workId &&
						candidate.to.workId === link.from.workId))
			);
			if (!duplicate) this.state.links.push(structuredClone(link));
		}
		const now = new Date().toISOString();
		this.state.emergenceSuggestions[index] = {
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
		return Promise.resolve(structuredClone(this.state.savedRuleQueries));
	}
	upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		this.state.savedRuleQueries = [
			...this.state.savedRuleQueries.filter((candidate) => candidate.id !== query.id),
			structuredClone(query),
		];
		return Promise.resolve();
	}
	deleteSavedRuleQuery(id: string): Promise<void> {
		this.state.savedRuleQueries = this.state.savedRuleQueries.filter((query) => query.id !== id);
		return Promise.resolve();
	}

	private projectItems(includeDeleted: boolean): OutlineItem[] {
		return projectOutlineItems(
			this.state.works,
			this.state.workingCopies,
			this.state.revisions,
			this.state.occurrences,
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
