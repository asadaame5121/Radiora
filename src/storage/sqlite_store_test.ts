import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { assertGraphStoreContract } from "../../tests/support/graph_store_contract.ts";
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
