import type { Branch, StubCreationKind, Work, WorkingCopy } from "../domain/models.ts";
import type { OutlineStorePort, WorkStorePort } from "../storage/graph_store.ts";
import {
	type InternalReferenceBacklink,
	InternalReferenceService,
} from "./internal_reference_service.ts";

export interface StubListEntry {
	workId: string;
	branchId: string;
	text: string;
	hasText: boolean;
	createdAt: string;
	createdVia: StubCreationKind;
	context?: string;
	backlinks: InternalReferenceBacklink[];
}

export interface CreatedStub {
	workId: string;
	branchId: string;
	createdAt: string;
	createdVia: StubCreationKind;
	context?: string;
}

/**
 * Stub は本文をこれから書くために明示作成された未配置 Work である。
 * 作成は利用者の明示操作だけから行われ、解除は本文が非空の場合に限る。
 */
export class StubService {
	constructor(
		private readonly store: OutlineStorePort & WorkStorePort,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {}

	async listStubs(): Promise<StubListEntry[]> {
		const [works, branches, copies] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const references = new InternalReferenceService(this.store);
		const entries: StubListEntry[] = [];
		for (const work of works) {
			if (!work.stub) continue;
			const main = branches.find((branch) =>
				branch.workId === work.id && branch.name === "main" && !branch.archivedAt
			);
			if (!main) throw new Error(`Main Branch not found for Stub Work: ${work.id}`);
			const copy = copies.find((candidate) => candidate.branchId === main.id);
			if (!copy) throw new Error(`Working Copy not found for Stub Work: ${work.id}`);
			entries.push({
				workId: work.id,
				branchId: main.id,
				text: copy.text,
				hasText: Boolean(copy.text.trim()),
				createdAt: work.stub.createdAt,
				createdVia: work.stub.createdVia,
				...(work.stub.context ? { context: work.stub.context } : {}),
				backlinks: await references.listBacklinks("work", work.id),
			});
		}
		return entries.sort((left, right) =>
			right.createdAt.localeCompare(left.createdAt) || left.workId.localeCompare(right.workId)
		);
	}

	async createStub(createdVia: StubCreationKind, context?: string): Promise<CreatedStub> {
		const timestamp = this.now();
		const trimmedContext = context?.trim();
		const work: Work = {
			id: this.createId(),
			createdAt: timestamp,
			updatedAt: timestamp,
			stub: {
				createdAt: timestamp,
				createdVia,
				...(trimmedContext ? { context: trimmedContext } : {}),
			},
		};
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
			text: "",
			updatedAt: timestamp,
		};
		await this.store.createUnplacedWork(work, branch, copy);
		return {
			workId: work.id,
			branchId: branch.id,
			createdAt: timestamp,
			createdVia,
			...(trimmedContext ? { context: trimmedContext } : {}),
		};
	}

	async resolveStub(workId: string): Promise<void> {
		const [works, branches, copies] = await Promise.all([
			this.store.listWorks(),
			this.store.listBranches(),
			this.store.listWorkingCopies(),
		]);
		const work = works.find((candidate) => candidate.id === workId);
		if (!work?.stub) throw new Error(`Stub Work not found: ${workId}`);
		const main = branches.find((branch) =>
			branch.workId === workId && branch.name === "main" && !branch.archivedAt
		);
		const copy = main && copies.find((candidate) => candidate.branchId === main.id);
		if (!copy?.text.trim()) {
			throw new Error("Stub resolution requires a non-empty Working Copy");
		}
		await this.store.resolveWorkStub(workId, this.now());
	}
}
