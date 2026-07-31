import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { OccurrenceOperations } from "./occurrence_operations.ts";
import { OpmlService } from "./opml_service.ts";

Deno.test("OPML service atomically imports hierarchy after existing roots and exports it", async () => {
	const store = new MemoryGraphStore();
	const operations = new OccurrenceOperations(store);
	await operations.createItem({ text: "既存", parentId: null });
	const service = new OpmlService(store);
	const source = [
		'<?xml version="1.0"?>',
		'<opml version="2.0"><body>',
		'<outline text="親" _note="日本語&#10;複数行">',
		'<outline text="子A"/><outline text="子B"/>',
		"</outline>",
		"</body></opml>",
	].join("");

	assertEquals(await service.import(source), { importedCount: 3 });
	const snapshot = await operations.listOutline();
	const ordered = [...snapshot.items].sort((left, right) => left.orderKey - right.orderKey);
	assertEquals(ordered.filter((item) => item.parentId === null).map((item) => item.text), [
		"既存",
		"親\n日本語\n複数行",
	]);
	const parent = snapshot.items.find((item) => item.text.startsWith("親"))!;
	assertEquals(
		ordered.filter((item) => item.parentId === parent.id).map((item) => item.text),
		["子A", "子B"],
	);
	assertEquals((await service.export()).includes("<opml"), true);
});

Deno.test("OPML service rejects invalid or empty input without writes", async () => {
	const store = new MemoryGraphStore();
	const service = new OpmlService(store);
	await assertRejects(() => service.import("<opml><body/></opml>"), Error, "項目がありません");
	await assertRejects(() => service.import("<broken>"), Error);
	assertEquals(await store.listItems(), []);
});
