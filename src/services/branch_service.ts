import type { Branch, Revision, WorkingCopy } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";

export interface BranchServiceOptions {
	/** Supplies lifecycle timestamps so callers and tests can make mutations deterministic. */
	now?: () => string;
}

export interface SelectedBranch {
	branch: Branch;
	workingCopy: WorkingCopy;
}

/**
 * Manages explicit Branch lifecycle operations without implicitly creating Revisions.
 */
export class BranchService {
	readonly #now: () => string;

	constructor(
		private readonly store: GraphStore,
		options: BranchServiceOptions = {},
	) {
		this.#now = options.now ?? (() => new Date().toISOString());
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
}
