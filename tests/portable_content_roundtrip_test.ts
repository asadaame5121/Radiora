import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { JsonBackupService } from "../src/services/json_backup.ts";
import { renderOutlineSnapshotMarkdown } from "../src/services/markdown_export.ts";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import { parseOpml, renderOutlineSnapshotOpml } from "../src/services/opml.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";

interface PortableContentFixture {
	rootText: string;
	childText: string;
	expectedMarkdown: string;
}

const fixture = JSON.parse(
	await Deno.readTextFile(
		new URL("./fixtures/portable-content-roundtrip.json", import.meta.url),
	),
) as PortableContentFixture;

const utf8RoundTrip = (source: string): string =>
	new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(source));

Deno.test("Japanese Markdown and internal references survive JSON, Markdown, and OPML round-trips", async () => {
	const sourceStore = new MemoryGraphStore();
	const sourceOperations = new OccurrenceOperations(sourceStore);
	const root = await sourceOperations.createItem({
		text: fixture.rootText,
		parentId: null,
	});
	await sourceOperations.createItem({
		text: fixture.childText,
		parentId: root.id,
	});

	const json = await new JsonBackupService(sourceStore).export(
		new Date("2026-07-30T12:00:00.000Z"),
	);
	const restoredStore = new MemoryGraphStore();
	await new JsonBackupService(restoredStore).restore(utf8RoundTrip(json));
	const restoredSnapshot = await new OccurrenceOperations(restoredStore).listOutline();

	assertEquals(
		restoredSnapshot.items.map((item) => item.text),
		[fixture.rootText, fixture.childText],
	);

	const markdown = utf8RoundTrip(renderOutlineSnapshotMarkdown(restoredSnapshot));
	assertEquals(markdown, fixture.expectedMarkdown);
	assertStringIncludes(
		markdown,
		"radiora://work/22222222-2222-4222-8222-222222222222",
	);

	const opml = utf8RoundTrip(renderOutlineSnapshotOpml(restoredSnapshot));
	assertEquals(parseOpml(opml), [
		{
			text: fixture.rootText,
			children: [{ text: fixture.childText, children: [] }],
		},
	]);
	assertStringIncludes(opml, 'encoding="UTF-8"');
});
