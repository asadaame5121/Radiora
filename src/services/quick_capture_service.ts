import type { Branch, UnplacedWork, Work, WorkingCopy } from "../domain/models.ts";
import type { GraphStore } from "../storage/graph_store.ts";

export class QuickCaptureService {
	constructor(
		private readonly store: GraphStore,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {}

	async capture(text: string): Promise<UnplacedWork> {
		if (!text.trim()) throw new Error("Quick Capture text must not be blank");
		const timestamp = this.now();
		const work: Work = { id: this.createId(), createdAt: timestamp, updatedAt: timestamp };
		const branch: Branch = {
			id: this.createId(),
			workId: work.id,
			name: "main",
			headRevisionId: null,
			createdAt: timestamp,
		};
		const copy: WorkingCopy = {
			branchId: branch.id,
			workId: work.id,
			text,
			updatedAt: timestamp,
		};
		await this.store.createUnplacedWork(work, branch, copy);
		return this.project(work, branch, copy);
	}

	async list(): Promise<UnplacedWork[]> {
		const [works, occurrences, branches, copies] = await Promise.all([
			this.store.listWorks(),
			this.store.listOccurrences(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const placed = new Set(occurrences.map((occurrence) => occurrence.workId));
		return works
			.filter((work) => !placed.has(work.id))
			.map((work) => {
				const mains = branches.filter((branch) =>
					branch.workId === work.id && branch.name === "main" && !branch.archivedAt
				);
				if (mains.length !== 1) {
					throw new Error(`Expected one active main Branch for Work: ${work.id}`);
				}
				const main = mains[0];
				const copy = copies.find((candidate) => candidate.branchId === main.id);
				if (!copy || copy.workId !== work.id) {
					throw new Error(`Working Copy not found for Branch: ${main.id}`);
				}
				return this.project(work, main, copy);
			})
			.sort((left, right) =>
				right.createdAt.localeCompare(left.createdAt) || left.workId.localeCompare(right.workId)
			);
	}

	async updateText(workId: string, text: string): Promise<void> {
		if (!workId) throw new Error("Work ID is required");
		if (!text.trim()) throw new Error("Quick Capture text must not be blank");
		const unplaced = (await this.list()).find((candidate) => candidate.workId === workId);
		if (!unplaced) throw new Error(`Unplaced Work not found: ${workId}`);
		await this.store.updateBranchWorkingCopy(unplaced.branchId, text, this.now());
	}

	private project(work: Work, branch: Branch, copy: WorkingCopy): UnplacedWork {
		return {
			workId: work.id,
			branchId: branch.id,
			text: copy.text,
			createdAt: work.createdAt,
			updatedAt: copy.updatedAt,
		};
	}
}
