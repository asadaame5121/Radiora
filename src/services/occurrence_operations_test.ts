import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { StubService } from "./stub_service.ts";

Deno.test("occurrence operations creates ordered siblings and preserves child order when deleting a parent", async () => {
	const operations = new OccurrenceOperations(new MemoryGraphStore());
	const first = await operations.createItem({ text: "first", parentId: null });
	const parent = await operations.createItem({ text: "parent", parentId: null, afterId: first.id });
	const a = await operations.createItem({ text: "a", parentId: parent.id });
	const b = await operations.createItem({ text: "b", parentId: parent.id, afterId: a.id });

	await operations.deleteItem(parent.id);

	const roots = (await operations.listOutline()).items.filter((item) => item.parentId === null)
		.sort((left, right) => left.orderKey - right.orderKey);
	assertEquals(roots.map((item) => item.id), [first.id, a.id, b.id]);
});

Deno.test("occurrence operations includes implicit FROM links in listOutline", async () => {
	const operations = new OccurrenceOperations(new MemoryGraphStore());
	const parent = await operations.createItem({ text: "parent work", parentId: null });
	const child = await operations.createItem({ text: "child work", parentId: parent.id });

	const snapshot = await operations.listOutline();
	assertEquals(snapshot.links.length, 1);
	assertEquals(snapshot.links[0].from.workId, parent.workId);
	assertEquals(snapshot.links[0].to.workId, child.workId);
	assertEquals(snapshot.links[0].type, "FROM");
});

Deno.test("occurrence operations reconciles knots after a move and listOutline persists its projection", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const a = await operations.createItem({ text: "a", parentId: null });
	const b = await operations.createItem({ text: "b", parentId: a.id });

	await operations.moveItem({ id: a.id, parentId: b.id });
	assertEquals((await store.listKnots()).length, 1);
	const snapshot = await operations.listOutline();
	assertEquals(snapshot.stashItemIds.sort(), [a.id, b.id].sort());
	assertEquals((await store.listKnots()).map((knot) => knot.cycleIds), [snapshot.stashItemIds]);
});

Deno.test("occurrence operations marks a recursive placement as a reference stub without changing its Work", async () => {
	const operations = new OccurrenceOperations(new MemoryGraphStore());
	const ancestor = await operations.createItem({ text: "ancestor", parentId: null });
	const descendant = await operations.createItem({ text: "descendant", parentId: ancestor.id });
	const recursive = await operations.createOccurrence({
		workId: ancestor.workId,
		parentId: descendant.id,
	});

	const item = (await operations.listOutline()).items.find((candidate) =>
		candidate.id === recursive.id
	);
	assertEquals(item?.referenceStub, true);
	assertEquals(item?.workId, ancestor.workId);
});

Deno.test("occurrence operations places an unplaced Work using its active main Branch", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const source = await operations.createItem({ text: "source", parentId: null });
	await store.deleteOccurrence(source.id);

	const placement = await operations.createOccurrence({ workId: source.workId, parentId: null });

	assertEquals(placement.workId, source.workId);
	assertEquals(placement.text, "source");
});

Deno.test("occurrence operations places a specifically selected editable Branch", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const source = await operations.createItem({ text: "main text", parentId: null });
	const createdAt = "2026-08-10T00:00:00.000Z";
	await store.createBranch(
		{
			id: "alternate",
			workId: source.workId,
			name: "別稿",
			headRevisionId: null,
			createdAt,
		},
		{
			branchId: "alternate",
			workId: source.workId,
			text: "alternate text",
			updatedAt: createdAt,
		},
	);

	const placement = await operations.createOccurrence({
		workId: source.workId,
		branchId: "alternate",
		parentId: null,
		afterId: source.id,
		contextualHeading: "別稿",
	});

	assertEquals(placement.text, "alternate text");
	assertEquals(placement.revisionSelector, { mode: "branch", branchId: "alternate" });
	assertEquals(placement.contextualHeading, "別稿");
	await operations.updateItemText(placement.id, "edited alternate");
	assertEquals(
		(await store.listWorkingCopies(source.workId)).find((copy) => copy.branchId === "alternate")
			?.text,
		"edited alternate",
	);
});

Deno.test("occurrence operations rejects a Branch from another Work", async () => {
	const operations = new OccurrenceOperations(new MemoryGraphStore());
	const source = await operations.createItem({ text: "source", parentId: null });
	const other = await operations.createItem({ text: "other", parentId: null });
	const otherBranchId = other.revisionSelector.mode === "branch"
		? other.revisionSelector.branchId
		: "";

	await assertRejects(
		() =>
			operations.createOccurrence({
				workId: source.workId,
				branchId: otherBranchId,
				parentId: null,
			}),
		Error,
		"Active Branch not found for Work",
	);
});

Deno.test("occurrence operations rejects an archived Branch", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const source = await operations.createItem({ text: "source", parentId: null });
	const branch = {
		id: "archived",
		workId: source.workId,
		name: "archived",
		headRevisionId: null,
		createdAt: "2026-08-12T00:00:00.000Z",
	};
	await store.createBranch(branch, {
		branchId: branch.id,
		workId: source.workId,
		text: "old draft",
		updatedAt: branch.createdAt,
	});
	await store.updateBranch({ ...branch, archivedAt: "2026-08-12T01:00:00.000Z" });

	await assertRejects(
		() =>
			operations.createOccurrence({
				workId: source.workId,
				branchId: branch.id,
				parentId: null,
			}),
		Error,
		"Active Branch not found for Work",
	);
});

Deno.test("occurrence operations trashes a blank Work when its last placement is removed", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const item = await operations.createItem({ text: "", parentId: null });

	await operations.deleteItem(item.id);

	assertEquals(await store.listWorks(), []);
	assertEquals(
		(await store.listWorks(true)).find((work) => work.id === item.workId)?.deletedAt !== undefined,
		true,
	);
});

Deno.test("occurrence operations keeps an explicit blank Stub after its last placement is removed", async () => {
	const store = new MemoryGraphStore();
	let id = 0;
	const stub = await new StubService(
		store,
		() => "2026-07-30T00:00:00.000Z",
		() => `stub-${++id}`,
	).createStub("stub-list");
	const operations = new OccurrenceOperations(store);
	const placement = await operations.createOccurrence({ workId: stub.workId, parentId: null });

	await operations.deleteItem(placement.id);

	assertEquals(
		(await store.listWorks()).find((work) => work.id === stub.workId)?.stub?.createdVia,
		"stub-list",
	);
});

Deno.test("occurrence operations edits the selected Branch and rejects pinned Revisions", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const source = await operations.createItem({ text: "main text", parentId: null });
	const createdAt = "2026-07-30T12:00:00.000Z";
	await store.createBranch(
		{
			id: "alternate",
			workId: source.workId,
			name: "alternate",
			headRevisionId: null,
			createdAt,
		},
		{
			branchId: "alternate",
			workId: source.workId,
			text: "alternate text",
			updatedAt: createdAt,
		},
	);
	await store.createOccurrence({
		id: "alternate-occurrence",
		workId: source.workId,
		parentOccurrenceId: null,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "alternate" },
	});

	await operations.updateItemText("alternate-occurrence", "edited alternate");
	assertEquals(
		(await store.listWorkingCopies(source.workId)).map((copy) => [copy.branchId, copy.text]),
		[
			[
				source.revisionSelector.mode === "branch" ? source.revisionSelector.branchId : "",
				"main text",
			],
			["alternate", "edited alternate"],
		],
	);

	await store.createRevision({
		id: "fixed-revision",
		workId: source.workId,
		text: "fixed",
		parentRevisionIds: [],
		kind: "edition",
		createdAt,
	}, "alternate");
	await store.updateOccurrence({
		id: "alternate-occurrence",
		workId: source.workId,
		parentOccurrenceId: null,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "pinned", revisionId: "fixed-revision" },
	});
	await assertRejects(
		() => operations.updateItemText("alternate-occurrence", "forbidden"),
		Error,
		"Pinned Revision Occurrence is read-only",
	);
});

Deno.test("occurrence operations maintains trash guards and counts", async () => {
	const operations = new OccurrenceOperations(new MemoryGraphStore());
	const item = await operations.createItem({ text: "trash", parentId: null });

	await assertRejects(() => operations.purgeWork(item.workId), Error, "must be in trash");
	await operations.trashWork(item.id);
	assertEquals(
		(await operations.listTrash()).map((entry) => [entry.work.id, entry.occurrenceCount]),
		[
			[item.workId, 1],
		],
	);
	await operations.restoreWork(item.workId);
	assertEquals(await operations.listTrash(), []);
});
