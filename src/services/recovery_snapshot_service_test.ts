import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { RecoverySnapshot } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { diffText } from "./revision_diff.ts";
import { RecoverySnapshotService } from "./recovery_snapshot_service.ts";

const FIRST = "2026-07-28T00:00:00.000Z";
const NOW = "2026-07-28T01:00:00.000Z";

async function fixture() {
	const store = new MemoryGraphStore();
	await store.createWorkBundle(
		{ id: "work", createdAt: FIRST, updatedAt: FIRST },
		{ id: "branch", workId: "work", name: "main", headRevisionId: null, createdAt: FIRST },
		{ branchId: "branch", workId: "work", text: "current\nbody", updatedAt: FIRST },
		{
			id: "occurrence",
			workId: "work",
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: "branch" },
		},
	);
	const snapshot: RecoverySnapshot = {
		id: "target",
		workId: "work",
		branchId: "branch",
		text: "older\nbody",
		contentHash: "sha256:older",
		createdAt: FIRST,
		sourceRevisionId: null,
	};
	await store.createRecoverySnapshot(snapshot);
	return { store, snapshot };
}

Deno.test("Snapshot preview uses the common text diff without writes", async () => {
	const { store, snapshot } = await fixture();
	const service = new RecoverySnapshotService(store);
	const before = await store.listRecoverySnapshots();
	const preview = await service.preview(snapshot.id, "work", "branch");
	assertEquals(preview.diff, diffText("current\nbody", "older\nbody"));
	assertEquals(await store.listRecoverySnapshots(), before);
});

Deno.test("confirmed restore saves current WC before apply and leaves history and head unchanged", async () => {
	const { store } = await fixture();
	const service = new RecoverySnapshotService(store, {
		now: () => NOW,
		createId: () => "before-restore",
	});
	const restored = await service.restore("target", "work", "branch", "confirmed");
	assertEquals(restored?.id, "before-restore");
	assertEquals(
		(await store.listRecoverySnapshots("work", "branch")).map((snapshot) => snapshot.id),
		["target", "before-restore"],
	);
	assertEquals((await store.listRecoverySnapshots()).at(-1)?.text, "current\nbody");
	assertEquals((await store.listWorkingCopies("work"))[0].text, "older\nbody");
	assertEquals((await store.listBranches("work"))[0].headRevisionId, null);
	assertEquals(await store.listRevisions("work"), []);
});

Deno.test("Snapshot promotion uses source Revision, protects source, and retains WC text", async () => {
	const { store, snapshot } = await fixture();
	await store.createRevision({
		id: "source",
		workId: "work",
		text: "source",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: FIRST,
	}, "branch");
	await store.createRecoverySnapshot({
		...snapshot,
		id: "with-source",
		sourceRevisionId: "source",
	});
	const service = new RecoverySnapshotService(store, {
		now: () => NOW,
		createId: () => "promoted",
	});
	const revision = await service.promote(
		"with-source",
		"work",
		"branch",
		"confirmed",
		"稿",
	);
	assertEquals(revision?.parentRevisionIds, ["source"]);
	assertEquals(revision?.text, snapshot.text);
	assertEquals((await store.listBranches("work"))[0].headRevisionId, "promoted");
	assertEquals((await store.listWorkingCopies("work"))[0].text, "current\nbody");
	assertEquals(
		(await store.listRecoverySnapshots()).find((entry) => entry.id === "with-source")?.protection,
		{ reason: "revision-source", protectedAt: NOW },
	);
});

Deno.test("cancelled and mismatched Snapshot operations perform no writes", async () => {
	const { store } = await fixture();
	const service = new RecoverySnapshotService(store, {
		now: () => NOW,
		createId: () => "must-not-be-created",
	});
	const before = {
		snapshots: await store.listRecoverySnapshots(),
		copies: await store.listWorkingCopies(),
		branches: await store.listBranches(),
		revisions: await store.listRevisions(),
	};
	assertEquals(await service.restore("target", "work", "branch", "cancelled"), null);
	await assertRejects(
		() => service.restore("target", "other-work", "branch", "confirmed"),
		Error,
		"scope",
	);
	await assertRejects(
		() => service.promote("target", "work", "other-branch", "confirmed"),
		Error,
		"scope",
	);
	assertEquals(await store.listRecoverySnapshots(), before.snapshots);
	assertEquals(await store.listWorkingCopies(), before.copies);
	assertEquals(await store.listBranches(), before.branches);
	assertEquals(await store.listRevisions(), before.revisions);
});
