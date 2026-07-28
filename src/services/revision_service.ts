import type { Revision } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";

export interface RevisionServiceOptions {
	/** Supplies the timestamp so callers can make checkpoint creation deterministic. */
	now?: () => string;
	/** Supplies an identifier so callers can make checkpoint creation deterministic. */
	createId?: () => string;
}

/**
 * Explicit, append-only creation of a Revision from a Branch's current Working Copy.
 *
 * Saving a Working Copy, creating a Recovery Snapshot, and restoring a Snapshot must
 * not call this service. The only persistence mutation here is GraphStore.createRevision,
 * whose contract creates the immutable Revision and advances the Branch head atomically.
 */
export class RevisionService {
	readonly #now: () => string;
	readonly #createId: () => string;

	constructor(
		private readonly store: GraphStore,
		options: RevisionServiceOptions = {},
	) {
		this.#now = options.now ?? (() => new Date().toISOString());
		this.#createId = options.createId ?? (() => crypto.randomUUID());
	}

	async createCheckpoint(branchId: string): Promise<Revision> {
		const [branches, workingCopies] = await Promise.all([
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const branch = branches.find((candidate) => candidate.id === branchId);
		if (!branch) throw new Error(`Branch not found: ${branchId}`);

		const workingCopy = workingCopies.find((candidate) => candidate.branchId === branchId);
		if (!workingCopy || workingCopy.workId !== branch.workId) {
			throw new Error(`Working Copy not found for Branch: ${branchId}`);
		}

		const revision: Revision = {
			id: this.#createId(),
			workId: branch.workId,
			text: workingCopy.text,
			parentRevisionIds: branch.headRevisionId ? [branch.headRevisionId] : [],
			kind: "checkpoint",
			createdAt: this.#now(),
		};
		await this.store.createRevision(revision, branch.id);
		return revision;
	}
}
