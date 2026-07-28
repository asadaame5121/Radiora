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

Deno.test("orphaned Occurrences are isolated in Stash without being deleted", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const orphan = await service.createItem({ text: "orphan", parentId: "missing-occurrence" });

	const snapshot = await service.listOutline();

	assertEquals(snapshot.items.some((item) => item.id === orphan.id), true);
	assertEquals(snapshot.stashItemIds, [orphan.id]);
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

Deno.test("Datalog semantic links resolve Work endpoints to visible Occurrences", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const source = await service.createItem({ text: "Source", parentId: null });
	const target = await service.createItem({ text: "Target", parentId: null });
	await service.createLink({ fromId: source.id, toId: target.id, type: "SUPPORT" });

	const result = await service.runRuleQuery(`?- link("SUPPORT", X, Y).`);

	assert(result.rows.some(([from, to]) => from === source.id && to === target.id));
});

Deno.test("symmetric links are normalized, deduplicated, and retracted without losing history", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const first = await service.createItem({ text: "First", parentId: null });
	const second = await service.createItem({ text: "Second", parentId: null });

	await service.createLink({ fromId: second.id, toId: first.id, type: "RELATED" });
	await service.createLink({ fromId: first.id, toId: second.id, type: "RELATED" });
	const [original] = await store.listLinks();
	assertEquals((await store.listLinks()).length, 1);
	assertEquals(original.fromId.localeCompare(original.toId) < 0, true);

	await service.deleteLink(second.id, first.id, "RELATED");
	assertEquals((await store.listLinks())[0].status, "retracted");
	assertEquals((await service.listOutline()).links, []);
	assertEquals((await service.runRuleQuery(`?- link("RELATED", X, Y).`)).rows, []);

	await service.createLink({ fromId: first.id, toId: second.id, type: "RELATED" });
	const history = await store.listLinks();
	assertEquals(history.length, 2);
	assertEquals(history.filter((link) => link.status === "retracted").map((link) => link.id), [
		original.id,
	]);
	assertEquals((await service.listOutline()).links.map((link) => link.status), ["asserted"]);
});

Deno.test("one Work can appear in multiple independent Occurrences with shared text", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const first = await service.createItem({ text: "共有本文", parentId: null });
	const second = await service.createOccurrence({
		workId: first.workId,
		parentId: null,
		contextualHeading: "別の文脈",
	});

	await service.updateItemText(second.id, "どちらからでも更新");
	const items = (await service.listOutline()).items.filter((item) => item.workId === first.workId);

	assertEquals(items.length, 2);
	assertEquals(items.map((item) => item.text), ["どちらからでも更新", "どちらからでも更新"]);
	assertEquals(items.find((item) => item.id === second.id)?.contextualHeading, "別の文脈");
});

Deno.test("contextual heading stays local to its placement", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const source = await service.createItem({ text: "共有本文\n本文", parentId: null });
	const mirror = await service.createOccurrence({
		workId: source.workId,
		parentId: null,
		contextualHeading: "別の文脈",
	});
	const alias = await service.saveSearchAlias({ canonical: "共有本文", variants: ["共通原稿"] });
	const before = (await service.listOutline()).items.find((item) => item.id === mirror.id);

	await service.setContextualHeading(mirror.id, "更新した文脈");

	const items = (await service.listOutline()).items.filter((item) => item.workId === source.workId);
	const updated = items.find((item) => item.id === mirror.id);
	assertEquals(items.map((item) => item.text), ["共有本文\n本文", "共有本文\n本文"]);
	assertEquals(updated?.contextualHeading, "更新した文脈");
	assertEquals(updated?.revisionSelector, before?.revisionSelector);
	assertEquals(await service.listSearchAliases(), [alias]);
});

Deno.test("moving an Occurrence never changes semantic FROM", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const oldWork = await service.createItem({ text: "Old", parentId: null });
	const newWork = await service.createItem({ text: "New", parentId: null });
	const placement = await service.createItem({ text: "Placement", parentId: null });
	await service.createLink({ fromId: newWork.id, toId: oldWork.id, type: "FROM" });

	await service.moveItem({ id: newWork.id, parentId: placement.id });

	const [link] = await store.listLinks();
	assertEquals(link.fromId, newWork.workId);
	assertEquals(link.toId, oldWork.workId);
	assertEquals(link.type, "FROM");
});

Deno.test("removing an Occurrence leaves its Work and other Occurrences intact", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const first = await service.createItem({ text: "実身", parentId: null });
	const second = await service.createOccurrence({ workId: first.workId, parentId: null });

	await service.deleteItem(first.id);

	assertEquals((await store.listWorks()).length, 1);
	assertEquals((await service.listOutline()).items.map((item) => item.id), [second.id]);
});

Deno.test("trash and restore preserve Occurrences and semantic links", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const source = await service.createItem({ text: "Source", parentId: null });
	const target = await service.createItem({ text: "Target", parentId: null });
	const mirror = await service.createOccurrence({ workId: source.workId, parentId: target.id });
	await service.createLink({ fromId: source.id, toId: target.id, type: "SUPPORT" });

	await service.trashWork(source.id);
	assertEquals(
		(await service.listOutline()).items.some((item) => item.workId === source.workId),
		false,
	);
	assertEquals((await service.listTrash())[0].occurrenceCount, 2);
	assertEquals((await service.listTrash())[0].linkCount, 1);

	await service.restoreWork(source.workId);
	const restored = await service.listOutline();
	assertEquals(restored.items.filter((item) => item.workId === source.workId).length, 2);
	assertEquals(restored.items.find((item) => item.id === mirror.id)?.parentId, target.id);
	assertEquals(restored.links[0].type, "SUPPORT");
});

Deno.test("complete purge removes content and leaves an ID-only impact manifest", async () => {
	const store = new MemoryGraphStore();
	const service = new OutlineService(store);
	const source = await service.createItem({ text: "消去される本文", parentId: null });
	const target = await service.createItem({ text: "残る本文", parentId: null });
	await service.createOccurrence({ workId: source.workId, parentId: target.id });
	await service.createLink({ fromId: source.id, toId: target.id, type: "CITE" });
	await service.trashWork(source.id);

	const manifest = await service.purgeWork(source.workId);

	assertEquals(manifest.workId, source.workId);
	assertEquals(manifest.occurrenceIds.length, 2);
	assertEquals(manifest.linkIds.length, 1);
	assertEquals("text" in manifest, false);
	assertEquals((await store.listWorks(true)).some((work) => work.id === source.workId), false);
	assertEquals((await store.listPurgeManifests())[0], manifest);
});

Deno.test("each Occurrence owns an independent child structure", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const parent = await service.createItem({ text: "Parent", parentId: null });
	const mirror = await service.createOccurrence({ workId: parent.workId, parentId: null });
	const child = await service.createItem({ text: "Child", parentId: parent.id });

	await service.moveItem({ id: child.id, parentId: mirror.id });
	const items = (await service.listOutline()).items;

	assertEquals(items.filter((item) => item.parentId === parent.id).length, 0);
	assertEquals(items.filter((item) => item.parentId === mirror.id).map((item) => item.id), [
		child.id,
	]);
});

Deno.test("placing a Work below its descendant projects the recursive placement as a reference stub", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const ancestor = await service.createItem({ text: "Ancestor", parentId: null });
	const descendant = await service.createItem({ text: "Descendant", parentId: ancestor.id });
	const recursive = await service.createOccurrence({
		workId: ancestor.workId,
		parentId: descendant.id,
	});
	const childOfRecursive = await service.createItem({
		text: "Hidden child",
		parentId: recursive.id,
	});

	const snapshot = await service.listOutline();
	assertEquals(snapshot.items.find((item) => item.id === ancestor.id)?.referenceStub, undefined);
	assertEquals(snapshot.items.find((item) => item.id === recursive.id)?.referenceStub, true);
	assertEquals(
		snapshot.items.find((item) => item.id === childOfRecursive.id)?.referenceStub,
		undefined,
	);
	assertEquals(snapshot.stashItemIds, []);
});

Deno.test("restoring a Work whose parent was purged places its Occurrence at root", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const parent = await service.createItem({ text: "Parent", parentId: null });
	const child = await service.createItem({ text: "Child", parentId: parent.id });

	await service.trashWork(child.id);
	await service.trashWork(parent.id);
	await service.purgeWork(parent.workId);
	await service.restoreWork(child.workId);

	const restored = (await service.listOutline()).items.find((item) => item.id === child.id);
	assertEquals(restored?.parentId, null);
	assertEquals((await service.listOutline()).stashItemIds, []);
});

Deno.test("repairing a cycle removes the stale knot and stash projection", async () => {
	const service = new OutlineService(new MemoryGraphStore());
	const a = await service.createItem({ text: "a", parentId: null });
	const b = await service.createItem({ text: "b", parentId: a.id });
	await service.moveItem({ id: a.id, parentId: b.id });
	assertEquals((await service.listOutline()).knots.length, 1);

	await service.moveItem({ id: a.id, parentId: null });
	const repaired = await service.listOutline();

	assertEquals(repaired.knots, []);
	assertEquals(repaired.stashItemIds, []);
	assertEquals(repaired.items.find((item) => item.id === b.id)?.parentId, a.id);
});
