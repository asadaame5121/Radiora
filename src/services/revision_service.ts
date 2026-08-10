import type { Branch, Revision, WorkingCopy } from "../domain/models.ts";
import type { WorkStorePort } from "../storage/graph_store.ts";

export interface RevisionServiceOptions {
	/** Supplies the timestamp so callers can make checkpoint creation deterministic. */
	now?: () => string;
	/** Supplies an identifier so callers can make checkpoint creation deterministic. */
	createId?: () => string;
}

export type RewriteConfirmation = "confirmed" | "cancelled";

export type RewriteAsNewBranchResult =
	| { status: "cancelled" }
	| {
		status: "created";
		branch: Branch;
		workingCopy: WorkingCopy;
		baseRevision: Revision;
		checkpointCreated: boolean;
	};

/**
 * Explicit, append-only creation of a Revision from a Branch's current Working Copy.
 *
 * Saving a Working Copy, creating a Recovery Snapshot, and restoring a Snapshot must
 * not call this service. The only persistence mutation here is WorkStorePort.createRevision,
 * whose contract creates the immutable Revision and advances the Branch head atomically.
 */
export class RevisionService {
	readonly #now: () => string;
	readonly #createId: () => string;

	constructor(
		private readonly store: WorkStorePort,
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

	/**
	 * Explicitly records a hand-authored merge revision from the selected Branch's
	 * current Working Copy. Parent texts are deliberately never read or combined:
	 * the caller has already resolved the desired text in the Working Copy.
	 */
	async createManualMerge(
		branchId: string,
		parentRevisionIds: string[],
		message?: string,
	): Promise<Revision> {
		if (parentRevisionIds.length < 2) {
			throw new Error("Manual merge requires at least two parents");
		}
		if (new Set(parentRevisionIds).size !== parentRevisionIds.length) {
			throw new Error("Manual merge parents must be unique");
		}

		const [branches, workingCopies, revisions] = await Promise.all([
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
		]);
		const branch = branches.find((candidate) => candidate.id === branchId);
		if (!branch) throw new Error(`Branch not found: ${branchId}`);
		const workingCopy = workingCopies.find((candidate) => candidate.branchId === branchId);
		if (!workingCopy || workingCopy.workId !== branch.workId) {
			throw new Error(`Working Copy not found for Branch: ${branchId}`);
		}
		if (!branch.headRevisionId || !parentRevisionIds.includes(branch.headRevisionId)) {
			throw new Error(`Manual merge parents must include Branch head: ${branchId}`);
		}

		const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
		for (const parentId of parentRevisionIds) {
			const parent = revisionsById.get(parentId);
			if (!parent) throw new Error(`Parent Revision not found: ${parentId}`);
			if (parent.workId !== branch.workId) {
				throw new Error(`Parent Revision does not belong to Branch Work: ${parentId}`);
			}
		}

		const revision: Revision = {
			id: this.#createId(),
			workId: branch.workId,
			text: workingCopy.text,
			parentRevisionIds: [...parentRevisionIds],
			kind: "merge",
			createdAt: this.#now(),
			...(message === undefined ? {} : { message }),
		};
		await this.store.createRevision(revision, branch.id);
		return revision;
	}

	/**
	 * Starts a rewrite on a new Branch only after explicit user confirmation.
	 *
	 * If the source Working Copy is already identical to its head Revision, that
	 * Revision is reused as the branch point. Otherwise the current Working Copy is
	 * explicitly checkpointed first. Cancellation performs no persistent writes.
	 */
	async rewriteAsNewBranch(
		sourceBranchId: string,
		newBranchName: string,
		confirmation: RewriteConfirmation,
	): Promise<RewriteAsNewBranchResult> {
		if (confirmation === "cancelled") return { status: "cancelled" };
		if (confirmation !== "confirmed") throw new Error("Explicit confirmation is required");
		const name = newBranchName.trim();
		if (!name) throw new Error("Branch name must not be empty");

		const [branches, workingCopies, revisions] = await Promise.all([
			this.store.listBranches(),
			this.store.listWorkingCopies(),
			this.store.listRevisions(),
		]);
		const sourceBranch = branches.find((candidate) => candidate.id === sourceBranchId);
		if (!sourceBranch) throw new Error(`Branch not found: ${sourceBranchId}`);

		const sourceWorkingCopy = workingCopies.find((candidate) =>
			candidate.branchId === sourceBranchId
		);
		if (!sourceWorkingCopy || sourceWorkingCopy.workId !== sourceBranch.workId) {
			throw new Error(`Working Copy not found for Branch: ${sourceBranchId}`);
		}

		const headRevision = sourceBranch.headRevisionId
			? revisions.find((candidate) => candidate.id === sourceBranch.headRevisionId)
			: undefined;
		if (
			sourceBranch.headRevisionId &&
			(!headRevision || headRevision.workId !== sourceBranch.workId)
		) {
			throw new Error(`Head Revision not found for Branch: ${sourceBranchId}`);
		}

		const timestamp = this.#now();
		const checkpointCreated = !headRevision || headRevision.text !== sourceWorkingCopy.text;
		const baseRevision: Revision = checkpointCreated
			? {
				id: this.#createId(),
				workId: sourceBranch.workId,
				text: sourceWorkingCopy.text,
				parentRevisionIds: headRevision ? [headRevision.id] : [],
				kind: "checkpoint",
				createdAt: timestamp,
			}
			: headRevision;
		const branch: Branch = {
			id: this.#createId(),
			workId: sourceBranch.workId,
			name,
			headRevisionId: baseRevision.id,
			createdAt: timestamp,
		};
		const workingCopy: WorkingCopy = {
			branchId: branch.id,
			workId: branch.workId,
			text: baseRevision.text,
			updatedAt: timestamp,
		};
		if (
			branches.some((candidate) => candidate.id === branch.id) ||
			workingCopies.some((candidate) => candidate.branchId === branch.id)
		) {
			throw new Error(`Branch already exists: ${branch.id}`);
		}

		if (checkpointCreated) {
			await this.store.createRevision(baseRevision, sourceBranch.id);
		}
		await this.store.createBranch(branch, workingCopy);

		return {
			status: "created",
			branch,
			workingCopy,
			baseRevision,
			checkpointCreated,
		};
	}
}
