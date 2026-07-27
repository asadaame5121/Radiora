import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem } from "../domain/models.ts";
import { JsonGraphStore } from "./json_store.ts";

Deno.test("persists and reloads graph data", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	const item: OutlineItem = {
		id: "one",
		text: "persistent",
		parentId: null,
		orderKey: 1,
		collapsed: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
	try {
		const first = new JsonGraphStore(path);
		await first.initialize();
		await first.createItem(item);

		const second = new JsonGraphStore(path);
		await second.initialize();
		assertEquals(await second.listItems(), [item]);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("loads the complete version 0 JSON fixture without data loss", async () => {
	const fixture = new URL("../../tests/fixtures/backup-v0.json", import.meta.url);
	const store = new JsonGraphStore(fixture);

	await store.initialize();

	const items = await store.listItems();
	assertEquals(items.length, 2);
	assertEquals(
		items[0].text,
		"原稿\n\n日本語・**Markdown**・radiora://item/22222222-2222-4222-8222-222222222222",
	);
	assertEquals(items[1].parentId, items[0].id);
	assertEquals(items[1].collapsed, true);
	assertEquals((await store.listLinks()).length, 1);
	assertEquals((await store.listAliases())[0].variants, ["来歴", "genealogy"]);
	assertEquals(await store.getEmergenceFeedback("suggestion-1"), "pin");
	assertEquals((await store.listSavedRuleQueries())[0].name, "LIKEリンク");
});
