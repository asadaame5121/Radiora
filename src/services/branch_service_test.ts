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

function service(store: MemoryGraphStore, ids?: string[]): BranchService {
	let index = 0;
	return new BranchService(store, {
		now: () => MUTATED_AT,
		createId: () => ids?.[index++] ?? `generated-${index++}`,
	});
}

async function graphState(store: MemoryGraphStore) {
	return {
		works: await store.listWorks(true),
		branches: await store.listBranches(),
		workingCopies: await store.listWorkingCopies(),
		revisions: await store.listRevisions(),
		occurrences: await store.listOccurrences(true),
		links: await store.listLinks(),
	};
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

Deno.test("global lineage projects one node per Work and only promoted confirmed heads", async () => {
	const store = await createStore();
	await store.createOccurrence({
		id: "mirror",
		workId: "work",
		parentOccurrenceId: "occurrence",
		orderKey: 2,
		collapsed: true,
		revisionSelector: { mode: "branch", branchId: "main" },
	});
	await store.createWorkBundle(
		{ id: "other-work", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "other-main",
			workId: "other-work",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "other-main",
			workId: "other-work",
			text: "other",
			updatedAt: CREATED_AT,
		},
		{
			id: "other-occurrence",
			workId: "other-work",
			parentOccurrenceId: null,
			orderKey: 3,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "other-main" },
		},
	);
	await store.createLink({
		id: "meaning",
		fromId: "work",
		toId: "other-work",
		from: { scope: "work", workId: "work" },
		to: { scope: "work", workId: "other-work" },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: CREATED_AT,
	});
	const branches = service(store);
	await branches.promoteBranch("source");

	const projection = await branches.listGlobalLineage({
		includeIsolated: true,
		linkTypes: ["FROM"],
		includeWorkIds: [],
	});

	assertEquals(projection.snapshot.items.map((item) => item.workId), ["work", "other-work"]);
	assertEquals(projection.snapshot.items.every((item) => item.parentId === null), true);
	assertEquals(projection.snapshot.links.map((link) => link.id), ["meaning"]);
	assertEquals(
		projection.promotedBranches.map((entry) => ({
			branchId: entry.branch.id,
			revisionId: entry.headRevision?.id,
		})),
		[{ branchId: "source", revisionId: "source-head" }],
	);
	assertEquals(
		projection.promotedBranches.some((entry) => entry.headRevision?.id === "main-head"),
		false,
	);
});

Deno.test("global lineage filter removes isolated Works and keeps promoted Branches", async () => {
	const store = await createStore();
	await store.createWorkBundle(
		{ id: "other-work", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "other-main",
			workId: "other-work",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "other-main",
			workId: "other-work",
			text: "other",
			updatedAt: CREATED_AT,
		},
		{
			id: "other-occurrence",
			workId: "other-work",
			parentOccurrenceId: null,
			orderKey: 3,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "other-main" },
		},
	);
	await store.createLink({
		id: "meaning",
		fromId: "work",
		toId: "other-work",
		from: { scope: "work", workId: "work" },
		to: { scope: "work", workId: "other-work" },
		type: "RELATED",
		status: "asserted",
		origin: "human",
		createdAt: CREATED_AT,
	});
	const branches = service(store);
	await branches.promoteBranch("source");

	const filtered = await branches.listGlobalLineage({
		includeIsolated: false,
		linkTypes: ["FROM"],
		includeWorkIds: [],
	});
	assertEquals(filtered.totalWorkCount, 2);
	assertEquals(filtered.filteredWorkCount, 0);
	assertEquals(filtered.snapshot.items, []);
	assertEquals(filtered.snapshot.links, []);
	assertEquals(
		filtered.promotedBranches.map((entry) => entry.branch.id),
		["source"],
	);

	const withSelected = await branches.listGlobalLineage({
		includeIsolated: false,
		linkTypes: ["FROM"],
		includeWorkIds: ["work"],
	});
	assertEquals(withSelected.filteredWorkCount, 1);
	assertEquals(
		withSelected.snapshot.items.map((entry) => entry.workId),
		["work"],
	);
	assertEquals(withSelected.snapshot.links, []);
});

Deno.test("Work lineage contains only its Branches and Revision ancestry", async () => {
	const store = await createStore();
	await store.createWorkBundle(
		{ id: "other-work", createdAt: CREATED_AT, updatedAt: CREATED_AT },
		{
			id: "other-main",
			workId: "other-work",
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		},
		{
			branchId: "other-main",
			workId: "other-work",
			text: "other",
			updatedAt: CREATED_AT,
		},
		{
			id: "other-occurrence",
			workId: "other-work",
			parentOccurrenceId: null,
			orderKey: 3,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "other-main" },
		},
	);
	const projection = await service(store).listWorkLineage("work");

	assertEquals(projection.work.id, "work");
	assertEquals(projection.branches.map((branch) => branch.id), ["main", "source"]);
	assertEquals(projection.revisions.map((revision) => revision.id), ["main-head", "source-head"]);
	assertEquals(
		projection.revisions.every((revision) =>
			revision.workId === "work" &&
			revision.parentRevisionIds.every((parentId) =>
				projection.revisions.some((candidate) => candidate.id === parentId)
			)
		),
		true,
	);
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

Deno.test("making a confirmed Branch independent creates a new Work and canonical FROM link", async () => {
	const store = await createStore();
	const before = await graphState(store);

	const result = await service(store, ["new-work", "new-main", "new-occurrence", "from-link"])
		.detachAsIndependentWork("source", { parentOccurrenceId: "occurrence", orderKey: 2048 });

	assertEquals(result.bundle, {
		work: { id: "new-work", createdAt: MUTATED_AT, updatedAt: MUTATED_AT },
		branch: {
			id: "new-main",
			workId: "new-work",
			name: "main",
			headRevisionId: null,
			createdAt: MUTATED_AT,
		},
		workingCopy: {
			branchId: "new-main",
			workId: "new-work",
			text: "confirmed source",
			updatedAt: MUTATED_AT,
		},
		occurrence: {
			id: "new-occurrence",
			workId: "new-work",
			parentOccurrenceId: "occurrence",
			orderKey: 2048,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "new-main" },
		},
	});
	assertEquals(result.link, {
		id: "from-link",
		fromId: "new-work",
		toId: "work",
		from: { scope: "work", workId: "new-work" },
		to: { scope: "work", workId: "work" },
		type: "FROM",
		status: "asserted",
		origin: "human",
		createdAt: MUTATED_AT,
	});
	assertEquals(await store.listRevisions("new-work"), []);
	assertEquals(
		(await store.listBranches("work")).find((branch) => branch.id === "source"),
		before.branches.find((branch) => branch.id === "source"),
	);
	assertEquals(
		(await store.listWorkingCopies("work")).find((copy) => copy.branchId === "source"),
		before.workingCopies.find((copy) => copy.branchId === "source"),
	);
	assertEquals(await store.listRevisions("work"), before.revisions);
});

for (
	const scenario of [
		{
			name: "dirty source",
			prepare: (store: MemoryGraphStore) =>
				store.updateBranchWorkingCopy("source", "uncommitted source", MUTATED_AT),
			message: "Source Branch has uncommitted Working Copy changes",
		},
		{
			name: "archived source",
			prepare: (store: MemoryGraphStore) => service(store).archiveBranch("source"),
			message: "Archived Branch cannot be made independent",
		},
		{
			name: "source without a head",
			prepare: async (store: MemoryGraphStore) => {
				const source = (await store.listBranches("work")).find((branch) => branch.id === "source");
				if (!source) throw new Error("test source missing");
				await store.updateBranch({ ...source, headRevisionId: null });
			},
			message: "Confirmed head Revision not found",
		},
	]
) {
	Deno.test(`making ${scenario.name} independent rejects without writes`, async () => {
		const store = await createStore();
		await scenario.prepare(store);
		const before = await graphState(store);

		await assertRejects(
			() =>
				service(store).detachAsIndependentWork("source", {
					parentOccurrenceId: "occurrence",
					orderKey: 2048,
				}),
			Error,
			scenario.message,
		);
		assertEquals(await graphState(store), before);
	});
}

Deno.test("making a Branch independent rejects generated ID collisions before writing", async () => {
	const store = await createStore();
	const before = await graphState(store);

	await assertRejects(
		() =>
			service(store, ["work", "new-main", "new-occurrence", "from-link"])
				.detachAsIndependentWork("source", { parentOccurrenceId: null, orderKey: 1 }),
		Error,
		"Generated identifier already exists",
	);
	assertEquals(await graphState(store), before);
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
