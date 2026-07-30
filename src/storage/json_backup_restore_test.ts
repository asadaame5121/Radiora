import { assertEquals } from "jsr:@std/assert@1";
import { OccurrenceOperations } from "../services/occurrence_operations.ts";
import { JsonGraphStore } from "./json_store.ts";

Deno.test("JsonGraphStore atomically restores graph state and persists it", async () => {
	const directory = await Deno.makeTempDir();
	const sourcePath = `${directory}\\source.json`;
	const targetPath = `${directory}\\target.json`;
	try {
		const source = new JsonGraphStore(sourcePath);
		await source.initialize();
		await new OccurrenceOperations(source).createItem({
			text: "復元本文\n日本語",
			parentId: null,
		});
		const expected = await source.exportGraphState();
		await source.close();

		const target = new JsonGraphStore(targetPath);
		await target.initialize();
		await new OccurrenceOperations(target).createItem({ text: "置換前", parentId: null });
		await target.restoreGraphState(expected);
		assertEquals(await target.exportGraphState(), expected);
		await target.close();

		const reopened = new JsonGraphStore(targetPath);
		await reopened.initialize();
		assertEquals(await reopened.exportGraphState(), expected);
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
