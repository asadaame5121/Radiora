import { assertEquals } from "jsr:@std/assert@1";
import { JsonGraphStore, migrateBackupV0 } from "./json_store.ts";

Deno.test("persists and reloads graph data", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	const timestamp = "2026-01-01T00:00:00.000Z";
	try {
		const first = new JsonGraphStore(path);
		await first.initialize();
		await first.createWorkBundle(
			{ id: "one", createdAt: timestamp, updatedAt: timestamp },
			{ id: "main", workId: "one", name: "main", headRevisionId: null, createdAt: timestamp },
			{ branchId: "main", workId: "one", text: "persistent", updatedAt: timestamp },
			{
				id: "occurrence-one",
				workId: "one",
				parentOccurrenceId: null,
				orderKey: 1,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: "main" },
			},
		);

		const second = new JsonGraphStore(path);
		await second.initialize();
		assertEquals((await second.listItems())[0].text, "persistent");
		assertEquals((await second.listItems())[0].workId, "one");
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("persists retracted semantic links as history", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	const timestamp = "2026-01-01T00:00:00.000Z";
	try {
		const first = new JsonGraphStore(path);
		await first.initialize();
		for (const id of ["one", "two"]) {
			await first.createWorkBundle(
				{ id, createdAt: timestamp, updatedAt: timestamp },
				{ id: `${id}-main`, workId: id, name: "main", headRevisionId: null, createdAt: timestamp },
				{ branchId: `${id}-main`, workId: id, text: id, updatedAt: timestamp },
				{
					id: `${id}-occurrence`,
					workId: id,
					parentOccurrenceId: null,
					orderKey: 1,
					collapsed: false,
					revisionSelector: { mode: "branch", branchId: `${id}-main` },
				},
			);
		}
		await first.createLink({
			id: "related-one-two",
			fromId: "one",
			toId: "two",
			from: { scope: "work", workId: "one" },
			to: { scope: "work", workId: "two" },
			type: "RELATED",
			status: "asserted",
			origin: "human",
			createdAt: timestamp,
		});
		await first.deleteLink("one", "two", "RELATED");

		const second = new JsonGraphStore(path);
		await second.initialize();
		assertEquals((await second.listLinks())[0].status, "retracted");
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("loads the complete version 0 JSON fixture without data loss", async () => {
	const fixture = new URL("../../tests/fixtures/backup-v0.json", import.meta.url);
	const directory = await Deno.makeTempDir();
	const path = `${directory}/backup-v0.json`;
	try {
		await Deno.copyFile(fixture, path);
		const store = new JsonGraphStore(path);
		await store.initialize();

		const items = await store.listItems();
		assertEquals(items.length, 5);
		assertEquals(
			items[0].text,
			"原稿\n\n日本語・**Markdown**・radiora://item/22222222-2222-4222-8222-222222222222",
		);
		assertEquals(items[1].parentId, items[0].id);
		assertEquals(items[1].collapsed, true);
		assertEquals(items[2].parentId, "99999999-9999-4999-8999-999999999999");
		assertEquals(items[3].parentId, items[4].id);
		assertEquals(items[4].parentId, items[3].id);
		assertEquals((await store.listLinks()).length, 1);
		assertEquals((await store.listAliases())[0].variants, ["来歴", "genealogy"]);
		assertEquals(await store.getEmergenceFeedback("suggestion-1"), "pin");
		assertEquals((await store.listSavedRuleQueries())[0].name, "LIKEリンク");
		const migrated = JSON.parse(await Deno.readTextFile(path));
		assertEquals(migrated.schemaVersion, 1);
		assertEquals(migrated.data.works.length, 5);
		assertEquals(migrated.data.occurrences[1].parentOccurrenceId, items[0].id);
		assertEquals(
			migrated.data.occurrences[2].parentOccurrenceId,
			"99999999-9999-4999-8999-999999999999",
		);
		assertEquals(migrated.data.occurrences[3].parentOccurrenceId, items[4].id);
		assertEquals(migrated.data.occurrences[4].parentOccurrenceId, items[3].id);
		assertEquals(migrated.data.links[0].status, "asserted");
		assertEquals(migrated.data.links.some((link: { type: string }) => link.type === "FROM"), false);
		const protectedInput = JSON.parse(await Deno.readTextFile(`${path}.v0.bak`));
		assertEquals(protectedInput.items.length, 5);
		assertEquals(protectedInput.schemaVersion, undefined);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("version 0 IN links migrate to system relations, not semantic links", () => {
	const migrated = migrateBackupV0({
		items: [
			{
				id: "one",
				text: "one",
				parentId: null,
				orderKey: 1,
				collapsed: false,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "two",
				text: "two",
				parentId: "one",
				orderKey: 2,
				collapsed: false,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		],
		links: [{
			fromId: "one",
			toId: "two",
			type: "IN",
			createdAt: "2026-01-01T00:00:00.000Z",
		}],
		knots: [],
	});

	assertEquals(migrated.links, []);
	assertEquals(migrated.systemRelations[0].type, "IN");
	assertEquals(migrated.occurrences[1].parentOccurrenceId, "one");
});

Deno.test("version 1 reload preserves trash state and content-free purge manifests", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	const timestamp = "2026-01-01T00:00:00.000Z";
	try {
		const first = new JsonGraphStore(path);
		await first.initialize();
		await first.createWorkBundle(
			{ id: "purged-work", createdAt: timestamp, updatedAt: timestamp },
			{
				id: "purged-main",
				workId: "purged-work",
				name: "main",
				headRevisionId: null,
				createdAt: timestamp,
			},
			{
				branchId: "purged-main",
				workId: "purged-work",
				text: "manifestに残してはいけない",
				updatedAt: timestamp,
			},
			{
				id: "purged-occurrence",
				workId: "purged-work",
				parentOccurrenceId: null,
				orderKey: 1,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: "purged-main" },
			},
		);
		await first.trashWork("purged-work", timestamp);
		const manifest = await first.purgeWork("purged-work");

		const second = new JsonGraphStore(path);
		await second.initialize();
		const [reloaded] = await second.listPurgeManifests();

		assertEquals(reloaded, manifest);
		assertEquals((await second.listWorks(true)).length, 0);
		assertEquals(JSON.stringify(reloaded).includes("manifestに残してはいけない"), false);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
