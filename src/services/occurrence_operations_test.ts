// biome-ignore-all lint/style/noMagicNumbers: Body and history sizes define independent test axes.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { StubService } from "./stub_service.ts";
import { createPerformanceFixture } from "../../scripts/performance_fixture.ts";

for (const level of ["root", "child"]) {
	Deno.test(`occurrence operations inserts between existing ${level} siblings`, async () => {
		const store = new MemoryGraphStore();
		const operations = new OccurrenceOperations(store);
		const parentId = level === "root"
			? null
			: (await operations.createItem({ text: "parent", parentId: null })).id;
		const siblings: string[] = [];
		for (const text of ["A", "B", "C", "D"]) {
			const created = await operations.createItem({
				text,
				parentId,
				afterId: siblings.at(-1),
			});
			siblings.push(created.id);
		}

		const created = await operations.createItem({ text: "new", parentId, afterId: siblings[1] });
		const persisted = (await store.listItems()).filter((item) => item.parentId === parentId)
			.sort((left, right) => left.orderKey - right.orderKey);

		assertEquals(created.parentId, parentId);
		assertEquals(persisted.map((item) => item.id), [
			siblings[0],
			siblings[1],
			created.id,
			siblings[2],
			siblings[3],
		]);
	});
}

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

Deno.test("occurrence operations switches one placement between a fixed Revision and the current main Branch", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const source = await operations.createItem({ text: "current", parentId: null });
	const branchId = source.revisionSelector.mode === "branch"
		? source.revisionSelector.branchId
		: "";
	await store.createRevision({
		id: "older-revision",
		workId: source.workId,
		text: "older",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-08-12T00:00:00.000Z",
	}, branchId);

	await operations.setOccurrenceRevision(source.id, "older-revision");
	let selected = (await operations.listOutline()).items.find((item) => item.id === source.id);
	assertEquals(selected?.revisionSelector, { mode: "pinned", revisionId: "older-revision" });
	assertEquals(selected?.text, "older");

	await operations.setOccurrenceRevision(source.id, null);
	selected = (await operations.listOutline()).items.find((item) => item.id === source.id);
	assertEquals(selected?.revisionSelector, { mode: "branch", branchId });
	assertEquals(selected?.text, "current");
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

Deno.test("occurrence operations listOutline efficiently handles deep tree performance fixture", async () => {
	const store = new MemoryGraphStore();
	const topicCount = 1_000;
	const fixtureSeed = 42;
	const maxElapsedMs = 1_000;
	const { state } = createPerformanceFixture({
		profile: "deep-tree",
		topicCount,
		seed: fixtureSeed,
	});
	await store.restoreGraphState(state);
	const operations = new OccurrenceOperations(store);

	const startTime = performance.now();
	const snapshot = await operations.listOutline();
	const elapsed = performance.now() - startTime;

	assertEquals(snapshot.items.length, topicCount);
	assertEquals(snapshot.knots.length, 0);
	assertEquals(elapsed < maxElapsedMs, true);
});

Deno.test("occurrence operations uses single item read and avoids listItems for point updates", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	const created = await operations.createItem({ text: "initial text", parentId: null });

	// Spy: listItems を呼んだら例外を投げる
	store.listItems = () => {
		throw new Error("listItems must not be called during point updates");
	};

	// 1. 本文更新 (updateItemText)
	await operations.updateItemText(created.id, "updated text");
	// 2. 折りたたみ (setCollapsed)
	await operations.setCollapsed(created.id, true);
	// 3. contextualHeading (setContextualHeading)
	await operations.setContextualHeading(created.id, "heading");

	// スパイを解除して結果確認
	delete (store as unknown as Record<string, unknown>).listItems;
	const item = await store.getItem(created.id);
	assertEquals(item?.text, "updated text");
	assertEquals(item?.collapsed, true);
	assertEquals(item?.contextualHeading, "heading");
});

Deno.test("point updates with large irrelevant works do not touch other working copies", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	for (let i = 0; i < 20; i++) {
		await operations.createItem({ text: "x".repeat(2048), parentId: null });
	}
	const target = await operations.createItem({ text: "target initial", parentId: null });

	// listItems呼び出しを遮断
	store.listItems = () => {
		throw new Error("listItems must not be called");
	};

	await operations.updateItemText(target.id, "target updated");
	await operations.setCollapsed(target.id, true);

	delete (store as unknown as Record<string, unknown>).listItems;
	const targetItem = await store.getItem(target.id);
	assertEquals(targetItem?.text, "target updated");
	assertEquals(targetItem?.collapsed, true);
});

Deno.test("discardEmptyItems removes only empty leaf items atomically", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);

	// 1. empty leaf (削除対象)
	const emptyLeaf1 = await operations.createItem({ text: "   ", parentId: null });
	const emptyLeaf2 = await operations.createItem({ text: "", parentId: null });
	// 2. non-empty leaf (非空: 削除されない)
	const nonEmptyLeaf = await operations.createItem({ text: "not empty", parentId: null });
	// 3. empty parent with children (子あり: 削除されない)
	const emptyParent = await operations.createItem({ text: "", parentId: null });
	const childOfParent = await operations.createItem({ text: "child", parentId: emptyParent.id });
	// 4. missing ID (存在しないID)
	const missingId = "non-existent-id";

	// 重複IDも含めて渡す
	const inputIds = [
		emptyLeaf1.id,
		emptyLeaf1.id,
		emptyLeaf2.id,
		nonEmptyLeaf.id,
		emptyParent.id,
		missingId,
	];

	const result = await operations.discardEmptyItems(inputIds);

	// handledIds は重複排除された全入力ID
	assertEquals(
		result.handledIds.sort(),
		[
			emptyLeaf1.id,
			emptyLeaf2.id,
			nonEmptyLeaf.id,
			emptyParent.id,
			missingId,
		].sort(),
	);

	// deletedIds は空かつ子なしの leaf のみ
	assertEquals(result.deletedIds.sort(), [emptyLeaf1.id, emptyLeaf2.id].sort());

	// 実際にストアから削除されたことを確認
	assertEquals(await store.getItem(emptyLeaf1.id), null);
	assertEquals(await store.getItem(emptyLeaf2.id), null);
	assertEquals((await store.getItem(nonEmptyLeaf.id))?.text, "not empty");
	assertEquals((await store.getItem(emptyParent.id)) !== null, true);
	assertEquals((await store.getItem(childOfParent.id)) !== null, true);

	// emptyLeaf1, emptyLeaf2 の work は blank unplaced work として trash に移動していること
	const trash = await operations.listTrash();
	const trashedWorkIds = trash.map((t) => t.work.id);
	assertEquals(trashedWorkIds.includes(emptyLeaf1.workId), true);
	assertEquals(trashedWorkIds.includes(emptyLeaf2.workId), true);
	assertEquals(trashedWorkIds.includes(emptyParent.workId), false);
});
