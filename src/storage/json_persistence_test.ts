import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import { JsonPersistence } from "./json_persistence.ts";
import { MemoryGraphStore } from "./memory_store.ts";

const MUTATION_QUEUE_WAIT_MS = 30;

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

Deno.test("JSON persistence supports nested mutations without deadlock and executes persist only once", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new MemoryGraphStore();
		const policy = persistence(path, store);

		await policy.mutate(async () => {
			await store.upsertAlias({
				id: "alias-1",
				canonical: "one",
				variants: [],
				createdAt: "2026-10-01",
				updatedAt: "2026-10-01",
			});
			// nested mutate
			await policy.mutate(async () => {
				await store.upsertAlias({
					id: "alias-2",
					canonical: "two",
					variants: [],
					createdAt: "2026-10-01",
					updatedAt: "2026-10-01",
				});
			});
		});

		const diskData = JSON.parse(await Deno.readTextFile(path)).data;
		assertEquals(diskData.aliases.length, 2);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JSON persistence serializes concurrent mutations in queue order", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new MemoryGraphStore();
		const policy = persistence(path, store);

		const executionOrder: number[] = [];

		const p1 = policy.mutate(async () => {
			await new Promise((resolve) => setTimeout(resolve, MUTATION_QUEUE_WAIT_MS));
			executionOrder.push(1);
			await store.upsertAlias({
				id: "alias-1",
				canonical: "first",
				variants: [],
				createdAt: "2026-10-01",
				updatedAt: "2026-10-01",
			});
		});

		const p2 = policy.mutate(async () => {
			executionOrder.push(2);
			await store.upsertAlias({
				id: "alias-2",
				canonical: "second",
				variants: [],
				createdAt: "2026-10-01",
				updatedAt: "2026-10-01",
			});
		});

		await Promise.all([p1, p2]);
		assertEquals(executionOrder, [1, 2]);

		const diskData = JSON.parse(await Deno.readTextFile(path)).data;
		assertEquals(diskData.aliases.length, 2);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("JSON persistence rejects nested restoreGraphState inside active mutation", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/graph.json`;
	try {
		const store = new MemoryGraphStore();
		const policy = persistence(path, store);

		await policy.mutate(async () => {
			await assertRejects(
				() => policy.restoreGraphState(store.state.exportGraphState()),
				Error,
				"Cannot restoreGraphState from inside an active persistence operation",
			);
		});
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
