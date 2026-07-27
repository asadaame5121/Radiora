import { assert, assertEquals } from "jsr:@std/assert@1";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";

Deno.test("storage version 0 fixture fixes FROM direction and stays unversioned", async () => {
	const fixture = await Deno.readTextFile(
		new URL("./fixtures/storage-v0.surql", import.meta.url),
	);
	const compact = fixture.replaceAll(/\s+/g, "");

	assert(
		compact.includes(
			`outline_item:\`${PARENT_ID}\`->evolved_from->outline_item:\`${CHILD_ID}\``,
		),
	);
	assert(!fixture.includes("CREATE schema_metadata:radiora"));
});

Deno.test("storage and JSON version 0 fixtures represent the same core graph", async () => {
	const backup = JSON.parse(
		await Deno.readTextFile(new URL("./fixtures/backup-v0.json", import.meta.url)),
	) as {
		items: Array<{ id: string; parentId: string | null; text: string }>;
		links: Array<{ fromId: string; toId: string; type: string; createdAt: string }>;
	};

	assertEquals(backup.items.map((item) => item.id), [PARENT_ID, CHILD_ID]);
	assertEquals(backup.items[1].parentId, PARENT_ID);
	assertEquals(backup.links[0], {
		fromId: PARENT_ID,
		toId: CHILD_ID,
		type: "LIKE",
		createdAt: "2026-07-05T00:00:00.000Z",
	});
	assert(backup.items[0].text.includes("radiora://item/"));
});
