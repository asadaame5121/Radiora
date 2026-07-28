import { assertEquals } from "jsr:@std/assert@1";
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
