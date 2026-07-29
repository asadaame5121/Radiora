import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DefaultSnapshotPolicy } from "./snapshot_policy.ts";
import { RevisionService } from "./revision_service.ts";
import { WorkingCopyAutosaveCoordinator } from "./working_copy_autosave.ts";

const TIMESTAMP = "2026-07-28T12:00:00.000Z";

async function createStore(): Promise<MemoryGraphStore> {
	const store = new MemoryGraphStore();
	await store.createWorkBundle(
		{ id: "work", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
		{ id: "branch", workId: "work", name: "main", headRevisionId: null, createdAt: TIMESTAMP },
		{ branchId: "branch", workId: "work", text: "first", updatedAt: TIMESTAMP },
		{
			id: "occurrence",
			workId: "work",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "branch" },
		},
	);
	return store;
}

Deno.test("explicit checkpoint copies the selected Branch Working Copy immutably and chains its head", async () => {
	const store = await createStore();
	const ids = ["revision-1", "revision-2"];
	const service = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => ids.shift()!,
	});

	const first = await service.createCheckpoint("branch");
	await store.updateBranchWorkingCopy("branch", "second", "2026-07-28T12:01:00.000Z");
	const second = await service.createCheckpoint("branch");

	assertEquals(first, {
		id: "revision-1",
		workId: "work",
		text: "first",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: TIMESTAMP,
	});
	assertEquals(second.parentRevisionIds, ["revision-1"]);
	assertEquals(second.text, "second");
	assertEquals(await store.listRevisions("work"), [first, second]);
	assertEquals((await store.listBranches("work"))[0].headRevisionId, "revision-2");
});

Deno.test("manual merge preserves the hand-edited Working Copy and ordered parents without combining parent text", async () => {
	const store = await createStore();
	const checkpointService = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => "main-head",
	});
	const mainHead = await checkpointService.createCheckpoint("branch");
	await store.createBranch(
		{ id: "other", workId: "work", name: "other", headRevisionId: null, createdAt: TIMESTAMP },
		{ branchId: "other", workId: "work", text: "other parent text", updatedAt: TIMESTAMP },
	);
	const otherParent: import("../domain/models.ts").Revision = {
		id: "other-parent",
		workId: "work",
		text: "other parent text",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: TIMESTAMP,
	};
	await store.createRevision(otherParent, "other");
	await store.updateBranchWorkingCopy(
		"branch",
		"hand-edited merge text",
		"2026-07-28T12:01:00.000Z",
	);

	const service = new RevisionService(store, {
		now: () => "2026-07-28T12:02:00.000Z",
		createId: () => "manual-merge",
	});
	const merge = await service.createManualMerge(
		"branch",
		[otherParent.id, mainHead.id],
		"resolved manually",
	);

	assertEquals(merge, {
		id: "manual-merge",
		workId: "work",
		text: "hand-edited merge text",
		parentRevisionIds: ["other-parent", "main-head"],
		kind: "merge",
		createdAt: "2026-07-28T12:02:00.000Z",
		message: "resolved manually",
	});
	assertEquals(await store.listRevisions("work"), [mainHead, otherParent, merge]);
	assertEquals(
		(await store.listBranches("work")).find((branch) => branch.id === "branch")?.headRevisionId,
		"manual-merge",
	);
	assertEquals(mainHead.text, "first");
	assertEquals(otherParent.text, "other parent text");
});

Deno.test("manual merge rejects invalid parents before writing", async (t) => {
	const cases = [
		{ name: "one parent", parentIds: ["main-head"] },
		{ name: "duplicate parents", parentIds: ["main-head", "main-head"] },
		{ name: "missing parent", parentIds: ["main-head", "missing"] },
		{ name: "head omitted", parentIds: ["other-parent", "missing"] },
	];
	for (const testCase of cases) {
		await t.step(testCase.name, async () => {
			const store = await createStore();
			const checkpointService = new RevisionService(store, {
				now: () => TIMESTAMP,
				createId: () => "main-head",
			});
			await checkpointService.createCheckpoint("branch");
			const before = {
				branches: await store.listBranches("work"),
				workingCopies: await store.listWorkingCopies("work"),
				revisions: await store.listRevisions("work"),
			};
			const service = new RevisionService(store, {
				now: () => {
					throw new Error("invalid merge must not request a timestamp");
				},
				createId: () => {
					throw new Error("invalid merge must not request an id");
				},
			});

			await assertRejects(() => service.createManualMerge("branch", testCase.parentIds));
			assertEquals(await store.listBranches("work"), before.branches);
			assertEquals(await store.listWorkingCopies("work"), before.workingCopies);
			assertEquals(await store.listRevisions("work"), before.revisions);
		});
	}
});

Deno.test("manual merge rejects a parent from another Work before writing", async () => {
	const store = await createStore();
	const checkpointService = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => "main-head",
	});
	await checkpointService.createCheckpoint("branch");
	await store.createWorkBundle(
		{ id: "other-work", createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
		{
			id: "other-branch",
			workId: "other-work",
			name: "main",
			headRevisionId: null,
			createdAt: TIMESTAMP,
		},
		{ branchId: "other-branch", workId: "other-work", text: "other", updatedAt: TIMESTAMP },
		{
			id: "other-occurrence",
			workId: "other-work",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "other-branch" },
		},
	);
	await store.createRevision({
		id: "other-parent",
		workId: "other-work",
		text: "other",
		parentRevisionIds: [],
		kind: "checkpoint",
		createdAt: TIMESTAMP,
	}, "other-branch");
	const before = await store.listRevisions();

	await assertRejects(
		() => new RevisionService(store).createManualMerge("branch", ["main-head", "other-parent"]),
		Error,
		"Parent Revision does not belong to Branch Work: other-parent",
	);
	assertEquals(await store.listRevisions(), before);
	assertEquals((await store.listBranches("work"))[0].headRevisionId, "main-head");
});

Deno.test("ordinary saves, autosave, snapshot policy, and snapshot restore do not create Revisions", async () => {
	const store = await createStore();
	await store.updateBranchWorkingCopy("branch", "ordinary save", "2026-07-28T12:01:00.000Z");

	const autosave = new WorkingCopyAutosaveCoordinator({
		save: (branchId, text) =>
			store.updateBranchWorkingCopy(branchId, text, "2026-07-28T12:02:00.000Z"),
	});
	autosave.queue("work", "branch", "autosaved");
	await autosave.flush();

	const workingCopy = (await store.listWorkingCopies("work"))[0];
	assertEquals(
		new DefaultSnapshotPolicy().shouldCreate({
			workingCopy,
			snapshots: [],
			now: "2026-07-28T12:03:00.000Z",
			contentHash: "hash",
		}),
		{ create: true },
	);
	await store.createRecoverySnapshot({
		id: "snapshot",
		workId: "work",
		branchId: "branch",
		text: "restored text",
		contentHash: "hash",
		createdAt: "2026-07-28T12:03:00.000Z",
		sourceRevisionId: null,
	});
	await store.applyRecoverySnapshot("snapshot", "2026-07-28T12:04:00.000Z");

	assertEquals(await store.listRevisions("work"), []);
	assertEquals((await store.listBranches("work"))[0].headRevisionId, null);
});

Deno.test("cancelling rewrite creates neither Revision nor Branch nor Working Copy", async () => {
	const store = await createStore();
	const service = new RevisionService(store, {
		now: () => {
			throw new Error("cancel must not request a timestamp");
		},
		createId: () => {
			throw new Error("cancel must not request an id");
		},
	});
	const before = {
		branches: await store.listBranches("work"),
		workingCopies: await store.listWorkingCopies("work"),
		revisions: await store.listRevisions("work"),
	};

	assertEquals(
		await service.rewriteAsNewBranch("branch", "rewrite", "cancelled"),
		{ status: "cancelled" },
	);
	assertEquals(await store.listBranches("work"), before.branches);
	assertEquals(await store.listWorkingCopies("work"), before.workingCopies);
	assertEquals(await store.listRevisions("work"), before.revisions);
});

Deno.test("confirmed rewrite checkpoints an uncommitted Working Copy and branches from it", async () => {
	const store = await createStore();
	const ids = ["revision", "rewrite-branch"];
	const service = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => ids.shift()!,
	});

	const result = await service.rewriteAsNewBranch("branch", "  second draft  ", "confirmed");

	assertEquals(result, {
		status: "created",
		branch: {
			id: "rewrite-branch",
			workId: "work",
			name: "second draft",
			headRevisionId: "revision",
			createdAt: TIMESTAMP,
		},
		workingCopy: {
			branchId: "rewrite-branch",
			workId: "work",
			text: "first",
			updatedAt: TIMESTAMP,
		},
		baseRevision: {
			id: "revision",
			workId: "work",
			text: "first",
			parentRevisionIds: [],
			kind: "checkpoint",
			createdAt: TIMESTAMP,
		},
		checkpointCreated: true,
	});
	assertEquals(
		(await store.listBranches("work")).find((branch) => branch.id === "branch")?.headRevisionId,
		"revision",
	);
	assertEquals(
		(await store.listWorkingCopies("work")).find((copy) => copy.branchId === "branch")?.text,
		"first",
	);
});

Deno.test("confirmed rewrite reuses an identical head Revision without creating a duplicate", async () => {
	const store = await createStore();
	const service = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => "revision",
	});
	const head = await service.createCheckpoint("branch");
	const rewriteService = new RevisionService(store, {
		now: () => "2026-07-28T12:05:00.000Z",
		createId: () => "rewrite-branch",
	});

	const result = await rewriteService.rewriteAsNewBranch("branch", "rewrite", "confirmed");

	assertEquals(result.status, "created");
	if (result.status !== "created") throw new Error("expected rewrite Branch creation");
	assertEquals(result.checkpointCreated, false);
	assertEquals(result.baseRevision, head);
	assertEquals(await store.listRevisions("work"), [head]);
	assertEquals(result.branch.headRevisionId, head.id);
	assertEquals(result.workingCopy.text, head.text);
	assertEquals(
		(await store.listBranches("work")).find((branch) => branch.id === "branch")?.headRevisionId,
		head.id,
	);
	assertEquals(
		(await store.listWorkingCopies("work")).find((copy) => copy.branchId === "branch")?.text,
		head.text,
	);
});

Deno.test("rewrite rejects a blank Branch name before any persistent write", async () => {
	const store = await createStore();
	const service = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => "unused",
	});

	await assertRejects(
		() => service.rewriteAsNewBranch("branch", " \t ", "confirmed"),
		Error,
		"Branch name must not be empty",
	);
	assertEquals(await store.listRevisions("work"), []);
	assertEquals((await store.listBranches("work")).length, 1);
	assertEquals((await store.listWorkingCopies("work")).length, 1);
});

Deno.test("rewrite rejects a colliding Branch id before checkpoint creation", async () => {
	const store = await createStore();
	const service = new RevisionService(store, {
		now: () => TIMESTAMP,
		createId: () => "branch",
	});

	await assertRejects(
		() => service.rewriteAsNewBranch("branch", "rewrite", "confirmed"),
		Error,
		"Branch already exists: branch",
	);
	assertEquals(await store.listRevisions("work"), []);
	assertEquals((await store.listBranches("work")).length, 1);
	assertEquals((await store.listWorkingCopies("work")).length, 1);
});
