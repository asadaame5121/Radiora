import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";

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
