import { JsonGraphStore } from "../src/storage/json_store.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { assertGraphStoreContract } from "./support/graph_store_contract.ts";

Deno.test("MemoryGraphStore satisfies the shared domain contract", async () => {
	const store = new MemoryGraphStore();
	await store.initialize();
	try {
		await assertGraphStoreContract(store);
	} finally {
		await store.close();
	}
});

Deno.test("JsonGraphStore satisfies the shared domain contract", async () => {
	const directory = await Deno.makeTempDir();
	const store = new JsonGraphStore(`${directory}\\contract.json`);
	await store.initialize();
	try {
		await assertGraphStoreContract(store);
	} finally {
		await store.close();
		await Deno.remove(directory, { recursive: true });
	}
});
