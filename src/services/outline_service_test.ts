import { assert, assertEquals } from "jsr:@std/assert@1";
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

Deno.test("title suggestions are normalized strict prefixes", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const prefix = await service.createItem({ text: "ＢＭ25入門\n本文に検索を書く", parentId: null });
	await service.createItem({ text: "検索から始まる", parentId: null });
	await service.createItem({ text: "本文だけ\nBM25", parentId: null });
	const results = await service.suggestItems("bm", 8);
	assertEquals(results.map((result) => result.item.id), [prefix.id]);
});

Deno.test("manual aliases expand lexical search with an explanation", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const item = await service.createItem({ text: "全文検索の設計", parentId: null });
	await service.saveSearchAlias({ canonical: "全文検索", variants: ["fts"] });
	const results = await service.searchItems({ query: "FTS" });
	assertEquals(results[0].item.id, item.id);
	assert(results[0].reasons.some((reason) => reason.kind === "alias"));
});

Deno.test("emergence finds an unlinked item through two shared neighbors", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const context = await service.createItem({ text: "Context", parentId: null });
	const target = await service.createItem({ text: "Target", parentId: null });
	const first = await service.createItem({ text: "First bridge", parentId: null });
	const second = await service.createItem({ text: "Second bridge", parentId: null });
	for (
		const [fromId, toId] of [
			[context.id, first.id],
			[target.id, first.id],
			[context.id, second.id],
			[target.id, second.id],
		]
	) {
		await service.createLink({ fromId, toId, type: "LIKE" });
	}
	const suggestions = await service.listEmergenceSuggestions(context.id);
	assert(
		suggestions.some((suggestion) =>
			suggestion.kind === "latent-relation" && suggestion.targetItemId === target.id
		),
	);
});

Deno.test("Datalog query supports recursive derived relations", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const root = await service.createItem({ text: "Root", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: root.id });
	const grandchild = await service.createItem({ text: "Grandchild", parentId: child.id });
	const result = await service.runRuleQuery(`
		descendant(X, Y) :- parent(X, Y).
		descendant(X, Y) :- parent(X, Z), descendant(Z, Y).
		?- descendant(X, Y).
	`);
	assert(result.rows.some(([from, to]) => from === root.id && to === grandchild.id));
});
