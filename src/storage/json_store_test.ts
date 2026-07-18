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
