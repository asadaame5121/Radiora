import { assertEquals } from "jsr:@std/assert@1";
import { OutlineService } from "./outline_service.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";

Deno.test("creates ordered siblings and moves an item under a parent", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const first = await service.createItem({ text: "first", parentId: null });
	const second = await service.createItem({ text: "second", parentId: null, afterId: first.id });
	await service.moveItem({ id: second.id, parentId: first.id });
	const items = (await service.listOutline()).items;
	assertEquals(items.find((item) => item.id === second.id)?.parentId, first.id);
});

Deno.test("deleting a parent promotes children in relative order", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const parent = await service.createItem({ text: "parent", parentId: null });
	const a = await service.createItem({ text: "a", parentId: parent.id });
	const b = await service.createItem({ text: "b", parentId: parent.id, afterId: a.id });
	await service.deleteItem(parent.id);
	const roots = (await service.listOutline()).items.filter((item) => item.parentId === null)
		.sort((x, y) => x.orderKey - y.orderKey);
	assertEquals(roots.map((item) => item.id), [a.id, b.id]);
});

Deno.test("cycles are projected into stash knots", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const a = await service.createItem({ text: "a", parentId: null });
	const b = await service.createItem({ text: "b", parentId: a.id });
	await service.moveItem({ id: a.id, parentId: b.id });
	const snapshot = await service.listOutline();
	assertEquals(new Set(snapshot.stashItemIds), new Set([a.id, b.id]));
	assertEquals(snapshot.knots.length, 1);
});

Deno.test("search ignores case and returns ancestors", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Deno Desktop", parentId: root.id });
	const results = await service.searchItems("desktop");
	assertEquals(results[0].item.id, child.id);
	assertEquals(results[0].ancestorIds, [root.id]);
});
