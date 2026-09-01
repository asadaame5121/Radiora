import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { assertGraphStoreContract } from "../../tests/support/graph_store_contract.ts";
import { BUILT_IN_RELATION_TYPES, type RelationTypeDefinition } from "../domain/relation_type.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import { calculateSqliteDiff, NodeSqliteDatabaseAdapter, recordId } from "./sqlite_records.ts";
import { SqliteGraphStore } from "./sqlite_store.ts";

function temporaryPath(): string {
	return `${Deno.makeTempDirSync({ prefix: "radiora-sqlite-" })}\\radiora.db`;
}

Deno.test("SqliteGraphStore persists the shared GraphStore contract across reopen", async () => {
	const path = temporaryPath();
	const store = new SqliteGraphStore(path);
	await store.initialize();
	await assertGraphStoreContract(store);
	const state = await store.exportGraphState();
	const jsonRoundTrip = JSON.parse(JSON.stringify(state));
	await store.close();

	const reopened = new SqliteGraphStore(path);
	await reopened.initialize();
	assertEquals(await reopened.exportGraphState(), jsonRoundTrip);
	await reopened.close();
});

Deno.test("SqliteGraphStore rolls back an invalid restore without changing stored data", async () => {
	const path = temporaryPath();
	const store = new SqliteGraphStore(path);
	await store.initialize();
	const before = await store.exportGraphState();
	await assertRejects(
		() => store.restoreGraphState({ ...before, works: [{ id: "invalid" }] } as never),
	);
	assertEquals(await store.exportGraphState(), before);
	await store.close();
});

Deno.test("SqliteGraphStore rejects mutations before initialization", async () => {
	const store = new SqliteGraphStore(temporaryPath());
	await assertRejects(
		() => store.clearResumePosition(),
		Error,
		"SqliteGraphStore is not initialized",
	);
});

Deno.test("SQLite records map custom relation type definitions by name to relation_type_definition table", async () => {
	const customDef: RelationTypeDefinition = {
		name: "CUSTOM_RELATION",
		direction: "directed",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	};
	assertEquals(recordId("relation_type_definition", customDef), "CUSTOM_RELATION");

	const legacyState = await new MemoryGraphStore().exportGraphState();
	const nextState: GraphStateSnapshot = {
		...legacyState,
		relationTypeDefinitions: [...BUILT_IN_RELATION_TYPES, customDef],
	};

	const diff = calculateSqliteDiff(legacyState, nextState);
	const relationDiffs = diff.upserts.filter((u) => u.table === "relation_type_definition");
	assertEquals(relationDiffs.length, 1);
	assertEquals(relationDiffs.some((u) => u.id === "CUSTOM_RELATION"), true);
});

Deno.test("SqliteGraphStore persists custom relation type definitions across reopen", async () => {
	const directory = await Deno.makeTempDir({ prefix: "radiora-sqlite-" });
	const path = `${directory}/radiora.db`;
	try {
		const store = new SqliteGraphStore(path);
		await store.initialize();

		const customDef: RelationTypeDefinition = {
			name: "CUSTOM_RELATION",
			direction: "directed",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		};
		await store.createRelationTypeDefinition(customDef);

		const list = await store.listRelationTypeDefinitions();
		assertEquals(list, [...BUILT_IN_RELATION_TYPES, customDef]);
		await store.close();

		const reopened = new SqliteGraphStore(path);
		await reopened.initialize();
		const reopenedList = await reopened.listRelationTypeDefinitions();
		assertEquals(reopenedList, [...BUILT_IN_RELATION_TYPES, customDef]);
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("SqliteGraphStore preserves built-ins and custom relation type when mutating a legacy database missing relation_type_definition rows", async () => {
	const directory = await Deno.makeTempDir({ prefix: "radiora-sqlite-" });
	const path = `${directory}/radiora.db`;
	try {
		const store = new SqliteGraphStore(path);
		await store.initialize();
		await store.close();

		const adapter = await NodeSqliteDatabaseAdapter.open(path);
		adapter.exec("DELETE FROM relation_type_definition");
		adapter.close();

		const legacyStore = new SqliteGraphStore(path);
		await legacyStore.initialize();

		const customDef: RelationTypeDefinition = {
			name: "CUSTOM_RELATION",
			direction: "directed",
			builtIn: false,
			createdAt: "2026-09-01T00:00:00.000Z",
		};
		await legacyStore.createRelationTypeDefinition(customDef);

		const list = await legacyStore.listRelationTypeDefinitions();
		assertEquals(list, [...BUILT_IN_RELATION_TYPES, customDef]);
		await legacyStore.close();

		const reopened = new SqliteGraphStore(path);
		await reopened.initialize();
		const reopenedList = await reopened.listRelationTypeDefinitions();
		assertEquals(reopenedList, [...BUILT_IN_RELATION_TYPES, customDef]);
		await reopened.close();
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
