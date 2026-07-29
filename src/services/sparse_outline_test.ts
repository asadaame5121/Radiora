import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OutlineService } from "./outline_service.ts";
import { buildSparseOutline } from "./sparse_outline.ts";
import type {
	OutlineItem,
	OutlineLink,
	SearchResult,
	TransientProjectionNode,
} from "../domain/models.ts";

Deno.test("sparse outline: single match with ancestors", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: root.id });
	const grandchild = await service.createItem({ text: "Grandchild", parentId: child.id });

	const results = await service.searchItems("grandchild");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	assertEquals(nodes.length, 3);
	const rootNode = nodes.find((n) => n.occurrenceId === root.id);
	const childNode = nodes.find((n) => n.occurrenceId === child.id);
	const grandchildNode = nodes.find((n) => n.occurrenceId === grandchild.id);

	assertEquals(rootNode?.parentNodeIndex, undefined);
	assertEquals(childNode?.parentNodeIndex, rootNode !== undefined ? nodes.indexOf(rootNode) : -1);
	assertEquals(
		grandchildNode?.parentNodeIndex,
		childNode !== undefined ? nodes.indexOf(childNode) : -1,
	);

	assertEquals(grandchildNode?.sourceType, "search");
	assertEquals(grandchildNode?.reasons !== undefined, true);
	assertEquals(grandchildNode!.reasons!.length > 0, true);
});

Deno.test("sparse outline: multiple matches share common ancestor", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child1 = await service.createItem({ text: "Alpha", parentId: root.id });
	const child2 = await service.createItem({ text: "Beta", parentId: root.id });

	const results = await service.searchItems({ query: "alpha beta", limit: 10 });
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	const rootNodes = nodes.filter((n) => n.occurrenceId === root.id);
	assertEquals(rootNodes.length, 1);

	const rootNode = rootNodes[0];
	assertEquals(rootNode.parentNodeIndex, undefined);

	for (const child of [child1, child2]) {
		const childNode = nodes.find((n) => n.occurrenceId === child.id);
		assertEquals(childNode?.parentNodeIndex, nodes.indexOf(rootNode));
	}
});

Deno.test("sparse outline: direct link targets appear as children of matched node", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const a = await service.createItem({ text: "Source", parentId: null });
	const b = await service.createItem({ text: "Linked", parentId: null });

	await service.createLink({ fromId: a.id, toId: b.id, type: "RELATED" });

	const results = await service.searchItems("source");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	const aNode = nodes.find((n) => n.occurrenceId === a.id)!;
	const bNode = nodes.find((n) => n.occurrenceId === b.id)!;
	assertNotEquals(aNode, undefined);
	assertNotEquals(bNode, undefined);
	assertEquals(bNode.parentNodeIndex, nodes.indexOf(aNode));
});

Deno.test("sparse outline: reasons are preserved for matched nodes", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const item = await service.createItem({ text: "UniqueTarget", parentId: null });

	const results = await service.searchItems("uniquetarget");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	const matched = nodes.find((n) => n.occurrenceId === item.id)!;
	assertEquals(matched.reasons !== undefined, true);
	assertEquals(matched.reasons!.length > 0, true);
	assertEquals(matched.score !== undefined, true);
	assertEquals(matched.sourceType, "search");
});

Deno.test("sparse outline: ancestors do not carry reasons", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: root.id });

	const results = await service.searchItems("child");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	const rootNode = nodes.find((n) => n.occurrenceId === root.id)!;
	assertEquals(rootNode.reasons, undefined);
	assertEquals(rootNode.score, undefined);
});

Deno.test("sparse outline: no persistence", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	await service.createItem({ text: "Root", parentId: null });
	await service.createItem({ text: "Child", parentId: null });

	const occBefore = (await store.listOccurrences()).length;
	const worksBefore = (await store.listWorks()).length;

	const results = await service.searchItems("root child");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	assertEquals(nodes.length > 0, true);
	assertEquals((await store.listOccurrences()).length, occBefore);
	assertEquals((await store.listWorks()).length, worksBefore);
});

Deno.test("sparse outline: empty results produce empty nodes", () => {
	const nodes = buildSparseOutline([], [], []);
	assertEquals(nodes.length, 0);
});

Deno.test("sparse outline: unplaced-like matched item has no parentNodeIndex", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });

	const results = await service.searchItems("root");
	const items = await store.listItems();
	const links = await store.listLinks();
	const nodes = buildSparseOutline(results, items, links);

	const rootNode = nodes.find((n) => n.occurrenceId === root.id)!;
	assertEquals(rootNode.parentNodeIndex, undefined);
});

Deno.test("sparse outline: missing ancestor ids are skipped gracefully", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const item = await service.createItem({ text: "Item", parentId: null });

	const items = await store.listItems();
	const links = await store.listLinks();

	const fakeResult: SearchResult = {
		item,
		ancestorIds: ["nonexistent-id"],
		score: 1,
		reasons: [{ kind: "title", label: "test", score: 1 }],
	};

	const nodes = buildSparseOutline([fakeResult], items, links);
	assertEquals(nodes.length, 1);
	assertEquals(nodes[0].occurrenceId, item.id);
});

Deno.test("sparse outline: cyclic parent chain does not overflow", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const itemA = await service.createItem({ text: "A", parentId: null });
	const itemB = await service.createItem({ text: "B", parentId: itemA.id });
	const items = await store.listItems();

	const circularAncestor = { ...itemA, parentId: itemB.id };
	const circularItems = items.map((item) => item.id === itemA.id ? circularAncestor : item);

	const result: SearchResult = {
		item: itemB,
		ancestorIds: [itemA.id],
		score: 0.9,
		reasons: [{ kind: "title", label: "test", score: 1 }],
	};

	const links = await store.listLinks();
	const nodes = buildSparseOutline([result], circularItems, links);
	assertEquals(nodes.length >= 2, true);
});
