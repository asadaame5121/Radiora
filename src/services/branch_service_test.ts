import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, WorkingCopy } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { BranchService } from "./branch_service.ts";

const CREATED_AT = "2026-07-28T09:00:00.000Z";
const MUTATED_AT = "2026-07-28T12:00:00.000Z";

async function createStore(): Promise<MemoryGraphStore> {
	const store = new MemoryGraphStore();
	await store.createWorkBundle(
		{ id: "work", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "main",
			workId: "work",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{ branchId: "main", workId: "work", text: "main draft", updatedAt: CREATED_AT },
		{
			id: "occurrence",
			workId: "work",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "main" },
		},
	);
	await store.createRevision(
		{
			id: "main-head",
			workId: "work",
			text: "main draft",
			parentRevisionIds: [],
			kind: "edition",
			createdAt: CREATED_AT,
		},
		"main",
	);
	await store.createBranch(
		{
			id: "source",
			workId: "work",
			name: "rewrite",
			headRevisionId: "main-head",
			createdAt: CREATED_AT,
		},
		{
			branchId: "source",
			workId: "work",
			text: "confirmed source",
			updatedAt: CREATED_AT,
		},
	);
	await store.createRevision(
		{
			id: "source-head",
			workId: "work",
			text: "confirmed source",
			parentRevisionIds: ["main-head"],
			kind: "edition",
			createdAt: CREATED_AT,
		},
		"source",
	);
	return store;
}

function service(store: MemoryGraphStore): BranchService {
	return new BranchService(store, { now: () => MUTATED_AT });
}

Deno.test("global lineage lists only explicitly promoted, active Branches", async () => {
	const store = await createStore();
	const branches = service(store);

	assertEquals(await branches.listGlobalLineageBranches(), []);
	assertEquals((await branches.promoteBranch("source")).promotedAt, MUTATED_AT);
	assertEquals(
		(await branches.listGlobalLineageBranches()).map((branch) => branch.id),
		["source"],
	);
	await branches.archiveBranch("source");
	assertEquals(await branches.listGlobalLineageBranches(), []);
});

Deno.test("unpromoting a Branch removes it from global lineage", async () => {
	const store = await createStore();
	const branches = service(store);
	await branches.promoteBranch("source");

	const unpromoted = await branches.unpromoteBranch("source");

	assertEquals(unpromoted.promotedAt, undefined);
	assertEquals(await branches.listGlobalLineageBranches(), []);
});

Deno.test("switching Branches is read-only and archived Branches cannot be selected", async () => {
	const store = await createStore();
	const branches = service(store);
	const before = {
		branches: await store.listBranches("work"),
		workingCopies: await store.listWorkingCopies("work"),
		revisions: await store.listRevisions("work"),
	};

	assertEquals(await branches.switchBranch("source"), {
		branch: before.branches.find((branch) => branch.id === "source"),
		workingCopy: before.workingCopies.find((copy) => copy.branchId === "source"),
	});
	assertEquals(await store.listBranches("work"), before.branches);
	assertEquals(await store.listWorkingCopies("work"), before.workingCopies);
	assertEquals(await store.listRevisions("work"), before.revisions);

	await branches.archiveBranch("source");
	await assertRejects(
		() => branches.switchBranch("source"),
		Error,
		"Archived Branch cannot be selected",
	);
});

Deno.test("main Branch cannot be archived", async () => {
	const store = await createStore();

	await assertRejects(
		() => service(store).archiveBranch("main"),
		Error,
		"Main Branch cannot be archived",
	);
});

Deno.test("making a dirty source main rejects without creating or adopting a Revision", async () => {
	const store = await createStore();
	await store.updateBranchWorkingCopy("source", "uncommitted source", MUTATED_AT);
	const before = {
		branches: await store.listBranches("work"),
		workingCopies: await store.listWorkingCopies("work"),
		revisions: await store.listRevisions("work"),
	};

	await assertRejects(
		() => service(store).makeMain("source"),
		Error,
		"Source Branch has uncommitted Working Copy changes",
	);
	assertEquals(await store.listBranches("work"), before.branches);
	assertEquals(await store.listWorkingCopies("work"), before.workingCopies);
	assertEquals(await store.listRevisions("work"), before.revisions);
});

Deno.test("making a confirmed source main advances only main and synchronizes its Working Copy", async () => {
	const store = await createStore();
	const sourceBefore = {
		branch: (await store.listBranches("work")).find((branch) => branch.id === "source"),
		workingCopy: (await store.listWorkingCopies("work")).find((copy) => copy.branchId === "source"),
	};

	assertEquals(await service(store).makeMain("source"), {
		branch: {
			id: "main",
			workId: "work",
			name: "main",
			headRevisionId: "source-head",
			createdAt: CREATED_AT,
		},
		workingCopy: {
			branchId: "main",
			workId: "work",
			text: "confirmed source",
			updatedAt: MUTATED_AT,
		},
	});
	assertEquals(
		(await store.listBranches("work")).find((branch) => branch.id === "source"),
		sourceBefore.branch,
	);
	assertEquals(
		(await store.listWorkingCopies("work")).find((copy) => copy.branchId === "source"),
		sourceBefore.workingCopy,
	);
	assertEquals(
		(await store.listRevisions("work")).map((revision) => revision.id),
		["main-head", "source-head"],
	);
});

Deno.test("Branch operations reject a Work without exactly one main Branch", async () => {
	const store = await createStore();
	await store.createBranch(
		{
			id: "other-main",
			workId: "work",
			name: "main",
			headRevisionId: "source-head",
			createdAt: CREATED_AT,
		},
		{
			branchId: "other-main",
			workId: "work",
			text: "confirmed source",
			updatedAt: CREATED_AT,
		},
	);

	await assertRejects(
		() => service(store).promoteBranch("source"),
		Error,
		"Work must have exactly one main Branch",
	);
	await assertRejects(
		() => service(store).listGlobalLineageBranches(),
		Error,
		"Work must have exactly one main Branch",
	);
});

class FailingMainWorkingCopyStore extends MemoryGraphStore {
	override updateBranchWorkingCopy(
		branchId: string,
		_text: string,
		_updatedAt: string,
	): Promise<void> {
		if (branchId === "main") return Promise.reject(new Error("simulated Working Copy failure"));
		return Promise.resolve();
	}

	seed(branches: Branch[], workingCopies: WorkingCopy[]): void {
		this.branches = structuredClone(branches);
		this.workingCopies = structuredClone(workingCopies);
	}
}

Deno.test("failed main Working Copy synchronization restores the previous main head", async () => {
	const sourceStore = await createStore();
	const store = new FailingMainWorkingCopyStore();
	store.seed(
		await sourceStore.listBranches("work"),
		await sourceStore.listWorkingCopies("work"),
	);
	const [mainRevision, sourceRevision] = await sourceStore.listRevisions("work");
	await store.createRevision(mainRevision, "main");
	await store.createRevision(sourceRevision, "source");
	const before = await store.listBranches("work");

	await assertRejects(
		() => service(store).makeMain("source"),
		Error,
		"simulated Working Copy failure",
	);
	assertEquals(await store.listBranches("work"), before);
});
