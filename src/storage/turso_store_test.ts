import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { assertGraphStoreContract } from "../../tests/support/graph_store_contract.ts";
import { TursoGraphStore } from "./turso_store.ts";

function temporaryPath(): string {
	return `${Deno.makeTempDirSync({ prefix: "radiora-turso-" })}\\radiora.db`;
}

Deno.test("TursoGraphStore persists the shared GraphStore contract across reopen", async () => {
	const path = temporaryPath();
	const store = new TursoGraphStore(path);
	await store.initialize();
	await assertGraphStoreContract(store);
	const state = await store.exportGraphState();
	const jsonRoundTrip = JSON.parse(JSON.stringify(state));
	await store.close();

	const reopened = new TursoGraphStore(path);
	await reopened.initialize();
	assertEquals(await reopened.exportGraphState(), jsonRoundTrip);
	await reopened.close();
});

Deno.test("TursoGraphStore rolls back an invalid restore without changing stored data", async () => {
	const path = temporaryPath();
	const store = new TursoGraphStore(path);
	await store.initialize();
	const before = await store.exportGraphState();
	await assertRejects(
		() => store.restoreGraphState({ ...before, works: [{ id: "invalid" }] } as never),
	);
	assertEquals(await store.exportGraphState(), before);
	await store.close();
});

Deno.test("TursoGraphStore rejects mutations before initialization", async () => {
	const store = new TursoGraphStore(temporaryPath());
	await assertRejects(
		() => store.clearResumePosition(),
		Error,
		"TursoGraphStore is not initialized",
	);
});
