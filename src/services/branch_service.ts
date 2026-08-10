import type {
	Branch,
	Occurrence,
	OutlineItem,
	OutlineLink,
	OutlineSnapshot,
	Revision,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort, WorkStorePort } from "../storage/graph_store.ts";
import { applyGlobalLineageFilter, type GlobalLineageFilter } from "./global_lineage_filter.ts";

type BranchStore = OutlineStorePort & RelationStorePort & WorkStorePort;

export interface BranchServiceOptions {
	/** Supplies lifecycle timestamps so callers and tests can make mutations deterministic. */
	now?: () => string;
	/** Supplies identifiers so callers and tests can make creation deterministic. */
	createId?: () => string;
}

export interface SelectedBranch {
	branch: Branch;
	workingCopy: WorkingCopy;
}

/** Placement is deliberately supplied by the caller; this service never infers a parent. */
export interface DetachAsIndependentWorkInput {
	parentOccurrenceId: string | null;
	orderKey: number;
}

export interface DetachedWorkBundle {
	work: Work;
	branch: Branch;
	workingCopy: WorkingCopy;
	occurrence: Occurrence;
}

export interface DetachAsIndependentWorkResult {
	bundle: DetachedWorkBundle;
	link: OutlineLink;
}

export interface GlobalLineageBranch {
	branch: Branch;
	/** The explicitly confirmed edition represented by this promoted Branch, when one exists. */
	headRevision: Revision | null;
}

/**
 * The global projection deliberately uses one representative per Work. Outline placement,
 * Branch internals, and ordinary Revisions do not become additional tree nodes.
 */
export interface GlobalLineageProjection {
	snapshot: OutlineSnapshot;
	promotedBranches: GlobalLineageBranch[];
	/** Number of representative Works before the filter was applied. */
	totalWorkCount: number;
	/** Number of representative Works that survived the filter. */
	filteredWorkCount: number;
}

export interface WorkLineageProjection {
	work: Work;
	branches: Branch[];
	revisions: Revision[];
}

/**
 * Manages explicit Branch lifecycle operations without implicitly creating Revisions.
 */
export class BranchService {
	readonly #now: () => string;
	readonly #createId: () => string;

	constructor(
		private readonly store: BranchStore,
		options: BranchServiceOptions = {},
	) {
		this.#now = options.now ?? (() => new Date().toISOString());
		this.#createId = options.createId ?? (() => crypto.randomUUID());
	}

	/**
	 * Loads the selected Branch and its Working Copy. Switching is deliberately read-only.
	 */
	async switchBranch(branchId: string): Promise<SelectedBranch> {
		const [branches, workingCopies] = await Promise.all([
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const branch = this.#requireBranch(branches, branchId);
		this.#requireUniqueMain(branches, branch.workId);
		if (branch.archivedAt) throw new Error(`Archived Branch cannot be selected: ${branchId}`);

		const workingCopy = this.#requireWorkingCopy(workingCopies, branch);
		return { branch, workingCopy };
	}

	async archiveBranch(branchId: string): Promise<Branch> {
		const branches = await this.store.listBranches();
		const branch = this.#requireBranch(branches, branchId);
		this.#requireUniqueMain(branches, branch.workId);
		if (branch.name === "main") throw new Error(`Main Branch cannot be archived: ${branchId}`);
		if (branch.archivedAt) return branch;

		const archived = { ...branch, archivedAt: this.#now() };
		await this.store.updateBranch(archived);
		return archived;
	}

	async promoteBranch(branchId: string): Promise<Branch> {
		const branches = await this.store.listBranches();
		const branch = this.#requireBranch(branches, branchId);
		this.#requireUniqueMain(branches, branch.workId);
		if (branch.archivedAt) throw new Error(`Archived Branch cannot be promoted: ${branchId}`);
		if (branch.promotedAt) return branch;

		const promoted = { ...branch, promotedAt: this.#now() };
		await this.store.updateBranch(promoted);
		return promoted;
	}

	async unpromoteBranch(branchId: string): Promise<Branch> {
		const branches = await this.store.listBranches();
		const branch = this.#requireBranch(branches, branchId);
		this.#requireUniqueMain(branches, branch.workId);
		if (!branch.promotedAt) return branch;

		const unpromoted = { ...branch };
		delete unpromoted.promotedAt;
		await this.store.updateBranch(unpromoted);
		return unpromoted;
	}

	/**
	 * Returns only Branches explicitly promoted into the global lineage.
	 */
	async listGlobalLineageBranches(): Promise<Branch[]> {
		const [works, branches] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
		]);
		const activeWorkIds = new Set(works.map((work) => work.id));
		for (const work of works) this.#requireUniqueMain(branches, work.id);
		return branches.filter((branch) =>
			activeWorkIds.has(branch.workId) && branch.promotedAt && !branch.archivedAt
		);
	}

	/**
	 * Projects the application-wide semantic lineage independently from any outline placement.
	 *
	 * The filter is applied at projection time so layout, rendering, and IPC transfer all see a
	 * reduced Work set. `promotedBranches` is deliberately unaffected by the filter: promotion
	 * status must stay visible regardless of the tree conditions.
	 *
	 * Explicitly promoted Branch heads are returned beside the Work graph so consumers do not
	 * have to reinterpret a Revision or Branch as a Work node.
	 */
	async listGlobalLineage(
		filter: GlobalLineageFilter,
	): Promise<GlobalLineageProjection> {
		const [works, items, links, revisions, promotedBranches] = await Promise.all([
			this.store.listWorks(),
			this.store.listItems(),
			this.store.listLinks(),
			this.store.listRevisions(),
			this.listGlobalLineageBranches(),
		]);
		const activeWorkIds = new Set(works.map((work) => work.id));
		const representativeByWork = new Map<string, OutlineItem>();
		for (
			const item of [...items].sort((left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
			)
		) {
			if (activeWorkIds.has(item.workId) && !representativeByWork.has(item.workId)) {
				representativeByWork.set(item.workId, {
					...item,
					parentId: null,
					collapsed: false,
				});
			}
		}

		const candidateLinks = links.filter((link) =>
			link.status !== "retracted" &&
			activeWorkIds.has(link.from.workId) &&
			activeWorkIds.has(link.to.workId)
		);
		const filtered = applyGlobalLineageFilter(
			filter,
			[...representativeByWork.values()],
			candidateLinks,
		);
		const snapshot: OutlineSnapshot = {
			items: filtered.items,
			links: filtered.links,
			knots: [],
			stashItemIds: [],
		};
		const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
		return {
			snapshot,
			promotedBranches: promotedBranches
				.map((branch) => {
					const headRevision = branch.headRevisionId
						? revisionById.get(branch.headRevisionId) ?? null
						: null;
					if (headRevision && headRevision.workId !== branch.workId) {
						throw new Error(`Branch head Revision belongs to another Work: ${branch.id}`);
					}
					return { branch, headRevision };
				})
				.sort((left, right) =>
					(left.branch.promotedAt ?? "").localeCompare(right.branch.promotedAt ?? "") ||
					left.branch.id.localeCompare(right.branch.id)
				),
			totalWorkCount: representativeByWork.size,
			filteredWorkCount: filtered.items.length,
		};
	}

	/**
	 * Projects only the version lineage of the selected Work. Semantic links and other Works
	 * are intentionally absent; merge ancestry is expressed solely by Revision parents.
	 */
	async listWorkLineage(workId: string): Promise<WorkLineageProjection> {
		const [works, branches, revisions] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(workId),
			this.store.listRevisions(workId),
		]);
		const work = works.find((candidate) => candidate.id === workId);
		if (!work) throw new Error(`Work not found: ${workId}`);
		this.#requireUniqueMain(branches, workId);
		return {
			work,
			branches: branches.sort((left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
			),
			revisions: revisions.sort((left, right) =>
				left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
			),
		};
	}

	/**
	 * Advances the unique main Branch to an already-confirmed source head.
	 *
	 * A dirty source Working Copy is rejected instead of being implicitly converted
	 * to a Revision. The source Branch and Working Copy are never updated.
	 */
	async makeMain(sourceBranchId: string): Promise<SelectedBranch> {
		const [branches, workingCopies, revisions] = await Promise.all([
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
		]);
		const source = this.#requireBranch(branches, sourceBranchId);
		const main = this.#requireUniqueMain(branches, source.workId);
		if (source.archivedAt) {
			throw new Error(`Archived Branch cannot become main: ${sourceBranchId}`);
		}

		const sourceWorkingCopy = this.#requireWorkingCopy(workingCopies, source);
		const head = this.#requireHeadRevision(revisions, source);
		if (sourceWorkingCopy.text !== head.text) {
			throw new Error(`Source Branch has uncommitted Working Copy changes: ${sourceBranchId}`);
		}

		const mainWorkingCopy = this.#requireWorkingCopy(workingCopies, main);
		if (source.id === main.id) return { branch: main, workingCopy: mainWorkingCopy };

		const timestamp = this.#now();
		const advancedMain = { ...main, headRevisionId: head.id };
		const syncedWorkingCopy = { ...mainWorkingCopy, text: head.text, updatedAt: timestamp };
		await this.store.updateBranch(advancedMain);
		try {
			await this.store.updateBranchWorkingCopy(main.id, head.text, timestamp);
		} catch (error) {
			try {
				await this.store.updateBranch(main);
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					`Failed to synchronize and restore main Branch: ${main.id}`,
				);
			}
			throw error;
		}
		return { branch: advancedMain, workingCopy: syncedWorkingCopy };
	}

	/**
	 * Promotes a confirmed Branch draft into a distinct Work.
	 *
	 * The new Work deliberately has no Revision history: its provenance is expressed
	 * only by the asserted `FROM` link from the new Work to the source Work.
	 */
	async detachAsIndependentWork(
		sourceBranchId: string,
		input: DetachAsIndependentWorkInput,
	): Promise<DetachAsIndependentWorkResult> {
		const [works, branches, workingCopies, revisions, occurrences, links] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
			this.store.listOccurrences(),
			this.store.listLinks(),
		]);
		const source = this.#requireBranch(branches, sourceBranchId);
		if (source.archivedAt) {
			throw new Error(`Archived Branch cannot be made independent: ${sourceBranchId}`);
		}
		if (!works.some((work) => work.id === source.workId)) {
			throw new Error(`Work not found for Branch: ${sourceBranchId}`);
		}
		const sourceWorkingCopy = this.#requireWorkingCopy(workingCopies, source);
		const sourceHead = this.#requireHeadRevision(revisions, source);
		if (sourceWorkingCopy.text !== sourceHead.text) {
			throw new Error(`Source Branch has uncommitted Working Copy changes: ${sourceBranchId}`);
		}

		const timestamp = this.#now();
		const [workId, branchId, occurrenceId, linkId] = [
			this.#createId(),
			this.#createId(),
			this.#createId(),
			this.#createId(),
		];
		this.#requireFreshIds(
			[workId, branchId, occurrenceId, linkId],
			works,
			branches,
			workingCopies,
			revisions,
			occurrences,
			links,
		);

		const bundle: DetachedWorkBundle = {
			work: { id: workId, createdAt: timestamp, updatedAt: timestamp },
			branch: {
				id: branchId,
				workId,
				name: "main",
				headRevisionId: null,
				createdAt: timestamp,
			},
			workingCopy: {
				branchId,
				workId,
				text: sourceHead.text,
				updatedAt: timestamp,
			},
			occurrence: {
				id: occurrenceId,
				workId,
				parentOccurrenceId: input.parentOccurrenceId,
				orderKey: input.orderKey,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId },
			},
		};
		const link: OutlineLink = {
			id: linkId,
			fromId: bundle.work.id,
			toId: source.workId,
			from: { scope: "work", workId: bundle.work.id },
			to: { scope: "work", workId: source.workId },
			type: "FROM",
			status: "asserted",
			origin: "human",
			createdAt: timestamp,
		};

		await this.store.createWorkBundle(
			bundle.work,
			bundle.branch,
			bundle.workingCopy,
			bundle.occurrence,
		);
		await this.store.createLink(link);
		return { bundle, link };
	}

	#requireBranch(branches: readonly Branch[], branchId: string): Branch {
		const branch = branches.find((candidate) => candidate.id === branchId);
		if (!branch) throw new Error(`Branch not found: ${branchId}`);
		return branch;
	}

	#requireUniqueMain(branches: readonly Branch[], workId: string): Branch {
		const mains = branches.filter((branch) => branch.workId === workId && branch.name === "main");
		if (mains.length !== 1) {
			throw new Error(`Work must have exactly one main Branch: ${workId}`);
		}
		return mains[0];
	}

	#requireWorkingCopy(
		workingCopies: readonly WorkingCopy[],
		branch: Branch,
	): WorkingCopy {
		const workingCopy = workingCopies.find((candidate) => candidate.branchId === branch.id);
		if (!workingCopy || workingCopy.workId !== branch.workId) {
			throw new Error(`Working Copy not found for Branch: ${branch.id}`);
		}
		return workingCopy;
	}

	#requireHeadRevision(revisions: readonly Revision[], branch: Branch): Revision {
		const revision = branch.headRevisionId
			? revisions.find((candidate) => candidate.id === branch.headRevisionId)
			: undefined;
		if (!revision || revision.workId !== branch.workId) {
			throw new Error(`Confirmed head Revision not found for Branch: ${branch.id}`);
		}
		return revision;
	}

	#requireFreshIds(
		ids: readonly string[],
		works: readonly Work[],
		branches: readonly Branch[],
		workingCopies: readonly WorkingCopy[],
		revisions: readonly Revision[],
		occurrences: readonly Occurrence[],
		links: readonly OutlineLink[],
	): void {
		const existing = new Set([
			...works.map((work) => work.id),
			...branches.map((branch) => branch.id),
			...workingCopies.map((workingCopy) => workingCopy.branchId),
			...revisions.map((revision) => revision.id),
			...occurrences.map((occurrence) => occurrence.id),
			...links.map((link) => link.id),
		]);
		if (new Set(ids).size !== ids.length || ids.some((id) => existing.has(id))) {
			throw new Error("Generated identifier already exists");
		}
	}
}
