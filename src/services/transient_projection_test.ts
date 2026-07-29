import { assertEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DateProjectionService } from "./date_projection.ts";
import { OutlineService } from "./outline_service.ts";
import { TransientProjectionService } from "./transient_projection.ts";
import type { SearchResult } from "../domain/models.ts";

const START = "2026-07-29T00:00:00.000Z";
const END = "2026-07-30T00:00:00.000Z";

Deno.test("transient projection does not create persistent Occurrence", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: root.id });
	const occurrencesBefore = (await store.listOccurrences()).length;
	const worksBefore = (await store.listWorks()).length;

	const results = await service.searchItems("root");
	const transient = new TransientProjectionService();
	const nodes = transient.buildSearchProjection(results);

	assertEquals(nodes.length > 0, true);
	assertEquals(nodes[0].workId, root.workId);
	assertEquals(nodes[0].occurrenceId, root.id);
	assertEquals(nodes[0].text, root.text);
	assertEquals(nodes[0].sourceType, "search");
	assertEquals((await store.listOccurrences()).length, occurrencesBefore);
	assertEquals((await store.listWorks()).length, worksBefore);
});

Deno.test("search projection preserves ancestorIds as breadcrumb", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: root.id });

	const results = await service.searchItems("child");
	const transient = new TransientProjectionService();
	const nodes = transient.buildSearchProjection(results);

	assertEquals(nodes[0].breadcrumb, [root.id]);
});

Deno.test("search projection preserves reasons and score", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	await service.createItem({ text: "Target", parentId: null });

	const results = await service.searchItems("target");
	const transient = new TransientProjectionService();
	const nodes = transient.buildSearchProjection(results);

	const node = nodes[0];
	assertEquals(node.score !== undefined, true);
	assertEquals(node.reasons !== undefined, true);
	assertEquals(node.reasons!.length > 0, true);
});

Deno.test("date projection nodes preserve workId and occurrenceId references", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", START, START);
	const dateService = new DateProjectionService(store);
	const occurrencesBefore = (await store.listOccurrences()).length;

	const nodes = await dateService.projectNodes({ startInclusive: START, endExclusive: END });

	assertEquals(nodes.length > 0, true);
	assertEquals(nodes[0].workId, "work-a");
	assertEquals(nodes[0].occurrenceId, "work-a-occurrence");
	assertEquals(nodes[0].text, "work-a");
	assertEquals(nodes[0].sourceType, "today");
	assertEquals((await store.listOccurrences()).length, occurrencesBefore);
});

Deno.test("date projection nodes do not create persistent Occurrence even on empty range", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", START, START);
	const dateService = new DateProjectionService(store);
	const occurrencesBefore = (await store.listOccurrences()).length;

	const nodes = await dateService.projectNodes({
		startInclusive: "2020-01-01T00:00:00.000Z",
		endExclusive: "2020-01-02T00:00:00.000Z",
	});

	assertEquals(nodes.length, 0);
	assertEquals((await store.listOccurrences()).length, occurrencesBefore);
});

Deno.test("existing DateProjectionService.project API is unchanged", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "work-a", START, START);
	const dateService = new DateProjectionService(store);

	const projection = await dateService.project({ startInclusive: START, endExclusive: END });

	assertEquals(projection.range.startInclusive, START);
	assertEquals(projection.range.endExclusive, END);
	assertEquals(projection.created.length, 1);
	assertEquals(projection.created[0].work.id, "work-a");
	assertEquals(projection.created[0].representative?.id, "work-a-occurrence");
});

Deno.test("buildQueryProjection converts rule query rows to transient nodes", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const item = await service.createItem({ text: "QueryTarget", parentId: null });
	const items = await store.listItems();
	const itemsById = new Map(items.map((item) => [item.id, item]));

	const transient = new TransientProjectionService();
	const nodes = transient.buildQueryProjection([[item.id, "extra"]], itemsById);

	assertEquals(nodes.length, 1);
	assertEquals(nodes[0].workId, item.workId);
	assertEquals(nodes[0].occurrenceId, item.id);
	assertEquals(nodes[0].text, item.text);
	assertEquals(nodes[0].sourceType, "query");
});

Deno.test("buildQueryProjection skips rows without a matching item", async () => {
	const store = new MemoryGraphStore();
	const items = await store.listItems();
	const itemsById = new Map(items.map((item) => [item.id, item]));

	const transient = new TransientProjectionService();
	const nodes = transient.buildQueryProjection([["nonexistent"]], itemsById);

	assertEquals(nodes.length, 0);
});

async function addWork(
	store: MemoryGraphStore,
	id: string,
	createdAt: string,
	updatedAt: string,
): Promise<void> {
	await store.createWorkBundle(
		{ id, createdAt, updatedAt },
		{ id: `${id}-branch`, workId: id, name: "main", headRevisionId: null, createdAt },
		{ branchId: `${id}-branch`, workId: id, text: id, updatedAt },
		{
			id: `${id}-occurrence`,
			workId: id,
			parentOccurrenceId: null,
			orderKey: 1,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: `${id}-branch` },
		},
	);
}
