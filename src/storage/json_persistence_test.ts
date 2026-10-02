import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import { JsonPersistence } from "./json_persistence.ts";
import { MemoryGraphStore } from "./memory_store.ts";

function persistence(path: string, store: MemoryGraphStore): JsonPersistence {
	return new JsonPersistence(path, {
		capture: () => store.state.capture(),
		rollback: (state) => store.state.rollback(state),
		exportGraphState: () => store.exportGraphState(),
		restoreGraphState: (state) => store.restoreGraphState(state),
	});
}

Deno.test("JSON persistence returns a mutation result after saving the updated graph", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new MemoryGraphStore();
		const result = { id: "result" };
		const saved = await persistence(path, store).mutate(async () => {
			await store.upsertAlias({
				id: "alias",
				canonical: "word",
				variants: [],
				createdAt: "2026-10-01",
				updatedAt: "2026-10-01",
			});
			return result;
		});
		assertStrictEquals(saved, result);
		assertEquals(JSON.parse(await Deno.readTextFile(path)).data, await store.exportGraphState());
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

for (const synchronous of [false, true]) {
	for (const rollback of [false, true]) {
		Deno.test(`JSON persistence preserves mutation errors without saving: sync=${synchronous}, rollback=${rollback}`, async () => {
			const directory = await Deno.makeTempDir();
			const path = `${directory}/graph.json`;
			try {
				const store = new MemoryGraphStore();
				const policy = persistence(path, store);
				await policy.persist();
				const before = await store.exportGraphState();
				const disk = await Deno.readTextFile(path);
				const error = new Error("mutation failed");
				const operation = () => {
					store.state.emergenceFeedback.changed = "pin";
					if (synchronous) throw error;
					return Promise.reject(error);
				};
				const thrown = await assertRejects(() =>
					rollback ? policy.mutateWithRollback(operation) : policy.mutate(operation)
				);
				assertStrictEquals(thrown, error);
				assertEquals(await Deno.readTextFile(path), disk);
				assertEquals(
					await store.exportGraphState(),
					rollback ? before : {
						...before,
						emergenceFeedback: { changed: "pin" },
					},
				);
			} finally {
				await Deno.remove(directory, { recursive: true });
			}
		});
	}
}
