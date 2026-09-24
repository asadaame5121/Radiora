import { JsonGraphStore } from "../src/storage/json_store.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import { assertGraphStoreContract } from "./support/graph_store_contract.ts";

async function safeRemoveDir(dir: string): Promise<void> {
	for (let i = 0; i < 40; i++) {
		try {
			await Deno.remove(dir, { recursive: true });
			return;
		} catch (error) {
			if (i === 39) throw error;
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
	}
}

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
		await safeRemoveDir(directory);
	}
});

Deno.test("SqliteGraphStore satisfies the shared domain contract", async () => {
	const directory = await Deno.makeTempDir();
	const store = new SqliteGraphStore(`${directory}\\contract.db`);
	await store.initialize();
	try {
		await assertGraphStoreContract(store);
	} finally {
		await store.close();
		await safeRemoveDir(directory);
	}
});
