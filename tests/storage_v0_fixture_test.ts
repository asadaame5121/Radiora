import { assert, assertEquals } from "jsr:@std/assert@1";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const ORPHAN_ID = "33333333-3333-4333-8333-333333333333";
const CYCLE_A_ID = "44444444-4444-4444-8444-444444444444";
const CYCLE_B_ID = "55555555-5555-4555-8555-555555555555";
const MISSING_PARENT_ID = "99999999-9999-4999-8999-999999999999";

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
	assert(
		compact.includes(
			`outline_item:\`${MISSING_PARENT_ID}\`->evolved_from->outline_item:\`${ORPHAN_ID}\``,
		),
	);
	assert(
		compact.includes(
			`outline_item:\`${CYCLE_A_ID}\`->evolved_from->outline_item:\`${CYCLE_B_ID}\``,
		),
	);
	assert(
		compact.includes(
			`outline_item:\`${CYCLE_B_ID}\`->evolved_from->outline_item:\`${CYCLE_A_ID}\``,
		),
	);
	assert(!compact.includes(`CREATEoutline_item:\`${MISSING_PARENT_ID}\``));
	assert(!fixture.includes("CREATE schema_metadata:radiora"));
});

Deno.test("storage and JSON version 0 fixtures represent the same core graph", async () => {
	const backup = JSON.parse(
		await Deno.readTextFile(new URL("./fixtures/backup-v0.json", import.meta.url)),
	) as {
		items: Array<{ id: string; parentId: string | null; text: string }>;
		links: Array<{ fromId: string; toId: string; type: string; createdAt: string }>;
	};

	assertEquals(backup.items.map((item) => item.id), [
		PARENT_ID,
		CHILD_ID,
		ORPHAN_ID,
		CYCLE_A_ID,
		CYCLE_B_ID,
	]);
	assertEquals(backup.items[1].parentId, PARENT_ID);
	assertEquals(backup.items[2].parentId, MISSING_PARENT_ID);
	assertEquals(backup.items[3].parentId, CYCLE_B_ID);
	assertEquals(backup.items[4].parentId, CYCLE_A_ID);
	assertEquals(backup.items.some((item) => item.id === MISSING_PARENT_ID), false);
	assertEquals(backup.links[0], {
		fromId: PARENT_ID,
		toId: CHILD_ID,
		type: "LIKE",
		createdAt: "2026-07-05T00:00:00.000Z",
	});
	assert(backup.items[0].text.includes("radiora://item/"));
});
