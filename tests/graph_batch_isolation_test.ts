import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert@1";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { JsonGraphStore } from "../src/storage/json_store.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { MemoryStateContainer } from "../src/storage/memory_state_container.ts";
import { NodeSqliteDatabaseAdapter } from "../src/storage/sqlite_records.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import { graphStateHash, importGraphStateToTurso } from "../src/storage/turso_migration.ts";

const factories = {
	memory: (_path: string) => new MemoryGraphStore(),
	json: (path: string) => new JsonGraphStore(path),
	sqlite: (path: string) => new SqliteGraphStore(path),
};

for (const [name, createStore] of Object.entries(factories)) {
	Deno.test(`${name} batches serialize unrelated callers and retain successful writes after rollback`, async () => {
		const dir = await Deno.makeTempDir();
		const path = `${dir}/graph`;
		const store = createStore(path);
		await store.initialize();
		try {
			const ops = new OccurrenceOperations(store);
			const item = await ops.createItem({ text: "before", parentId: null });
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const failure = new Error("batch A failed");
			const first = store.batch(async () => {
				await ops.updateItemText(item.id, "rolled back");
				entered.resolve();
				await release.promise;
				throw failure;
			});
			const rejected = assertRejects(() => first);
			await entered.promise;
			let secondEntered = false;
			const second = store.batch(async () => {
				secondEntered = true;
				assertEquals((await store.getItem(item.id))?.text, "before");
				// Nested calls share this invocation and do not deadlock.
				return await store.batch(async () => {
					await ops.updateItemText(item.id, "committed");
					return "result";
				});
			});
			await Promise.resolve();
			const enteredWhileFirstPending = secondEntered;
			release.resolve();
			assertStrictEquals(await rejected, failure);
			assertEquals(await second, "result");
			assertEquals(enteredWhileFirstPending, false);
			assertEquals((await store.getItem(item.id))?.text, "committed");
			if (name !== "memory") {
				await store.close();
				const reopened = createStore(path);
				await reopened.initialize();
				try {
					assertEquals((await reopened.getItem(item.id))?.text, "committed");
				} finally {
					await reopened.close();
				}
			}
		} finally {
			await store.close();
			await Deno.remove(dir, { recursive: true });
		}
	});

	Deno.test(`${name} failed batches leave memory and durable state unchanged`, async () => {
		const dir = await Deno.makeTempDir();
		const path = `${dir}/graph`;
		const store = createStore(path);
		await store.initialize();
		try {
			const ops = new OccurrenceOperations(store);
			const root = await ops.createItem({ text: "Root", parentId: null });
			const child = await ops.createItem({ text: "Child", parentId: root.id });
			const before = await store.exportGraphState();
			await assertRejects(() =>
				store.batch(async () => {
					await ops.moveItem({ id: root.id, parentId: child.id });
					await ops.updateItemText(child.id, "partial write");
					throw new Error("later operation failed");
				}),
			);
			assertEquals(await store.exportGraphState(), before);
			if (name !== "memory") {
				await store.close();
				const reopened = createStore(path);
				await reopened.initialize();
				try {
					assertEquals(await reopened.exportGraphState(), before);
				} finally {
					await reopened.close();
				}
			}
		} finally {
			await store.close();
			await Deno.remove(dir, { recursive: true });
		}
	});

	Deno.test(`${name} restore rebuilds missing knots and removes stale knots`, async () => {
		const dir = await Deno.makeTempDir();
		const store = createStore(`${dir}/graph`);
		await store.initialize();
		try {
			const ops = new OccurrenceOperations(store);
			const root = await ops.createItem({ text: "Root", parentId: null });
			const child = await ops.createItem({ text: "Child", parentId: root.id });
			const cycle = await store.exportGraphState();
			cycle.occurrences[0].parentOccurrenceId = child.id;
			cycle.knots = [];
			await store.restoreGraphState(cycle);
			const outline = await ops.listOutline();
			assertEquals(outline.knots.length, 1);
			assertEquals(new Set(outline.stashItemIds), new Set([root.id, child.id]));
			const acyclic = await store.exportGraphState();
			acyclic.occurrences[0].parentOccurrenceId = null;
			await store.restoreGraphState(acyclic);
			assertEquals((await ops.listOutline()).knots, []);
		} finally {
			await store.close();
			await Deno.remove(dir, { recursive: true });
		}
	});
}

Deno.test("migration verifies a snapshot with rebuilt derived knots", async () => {
	const dir = await Deno.makeTempDir();
	try {
		const source = new MemoryGraphStore();
		const ops = new OccurrenceOperations(source);
		const root = await ops.createItem({ text: "Root", parentId: null });
		const child = await ops.createItem({ text: "Child", parentId: root.id });
		const snapshot = await source.exportGraphState();
		snapshot.occurrences[0].parentOccurrenceId = child.id;
		snapshot.knots = [];
		await source.restoreGraphState(snapshot);
		const expected = await source.exportGraphState();
		const path = `${dir}/graph.db`;
		const result = await importGraphStateToTurso(snapshot, path);
		assertEquals(result.snapshotHash, await graphStateHash(expected));
		const reopened = new SqliteGraphStore(path);
		await reopened.initialize();
		try {
			assertEquals(await reopened.exportGraphState(), expected);
		} finally {
			await reopened.close();
		}
	} finally {
		await Deno.remove(dir, { recursive: true });
	}
});

for (const name of ["memory", "json", "sqlite"] as const) {
	Deno.test(`${name} initialization rebuilds knots from stored cycles before the first read`, async () => {
		const dir = await Deno.makeTempDir();
		const path = `${dir}/graph`;
		const seed = factories[name](path);
		await seed.initialize();
		const ops = new OccurrenceOperations(seed);
		const root = await ops.createItem({ text: "Root", parentId: null });
		const child = await ops.createItem({ text: "Child", parentId: root.id });
		await ops.moveItem({ id: root.id, parentId: child.id });
		const snapshot = await seed.exportGraphState();
		await seed.close();
		snapshot.knots = [];
		let store: MemoryGraphStore;
		if (name === "memory") {
			const state = new MemoryStateContainer();
			state.restoreGraphState(snapshot);
			store = new MemoryGraphStore(state);
		} else if (name === "json") {
			await Deno.writeTextFile(
				path,
				JSON.stringify({
					format: "radiora-backup",
					schemaVersion: 8,
					exportedAt: new Date().toISOString(),
					appVersion: "0.1.0",
					source: { storageSchemaVersion: 8 },
					data: snapshot,
				}),
			);
			store = factories.json(path);
		} else {
			const db = await NodeSqliteDatabaseAdapter.open(path);
			try {
				db.exec("DELETE FROM knot");
			} finally {
				db.close();
			}
			store = factories.sqlite(path);
		}
		try {
			await store.initialize();
			const outline = await new OccurrenceOperations(store).listOutline();
			assertEquals(outline.knots.length, 1);
			assertEquals(new Set(outline.stashItemIds), new Set([root.id, child.id]));
		} finally {
			await store.close();
			await Deno.remove(dir, { recursive: true });
		}
	});
}

Deno.test("JSON batch commit failure preserves the old file and rolls back before cleanup", async () => {
	const dir = await Deno.makeTempDir();
	const path = `${dir}/graph.json`;
	const failure = new Error("rename failed");
	let stateAtCleanup: GraphStateSnapshot | undefined;
	const store = new JsonGraphStore(path, {
		writeTextFile: (target, data) => Deno.writeTextFile(target, data),
		rename: () => Promise.reject(failure),
		remove: async (target) => {
			stateAtCleanup = await store.exportGraphState();
			await Deno.remove(target);
		},
	});
	try {
		await store.initialize();
		const ops = new OccurrenceOperations(store);
		const item = await ops.createItem({ text: "before", parentId: null });
		const before = await store.exportGraphState();
		const disk = await Deno.readTextFile(path);
		assertStrictEquals(
			await assertRejects(() => store.batch(() => ops.updateItemText(item.id, "after"))),
			failure,
		);
		assertEquals(await store.exportGraphState(), before);
		assertEquals(stateAtCleanup, before);
		assertEquals(await Deno.readTextFile(path), disk);
		assertEquals(
			Array.from(Deno.readDirSync(dir), (entry) => entry.name),
			["graph.json"],
		);
	} finally {
		await store.close();
		await Deno.remove(dir, { recursive: true });
	}
});

Deno.test("SQLite batch commit failure rolls back its transaction and memory", async () => {
	const dir = await Deno.makeTempDir();
	const path = `${dir}/graph.db`;
	let failCommit = false;
	const failure = new Error("commit failed");
	const store = new SqliteGraphStore(path, {
		connector: async (target) => {
			const db = await NodeSqliteDatabaseAdapter.open(target);
			return {
				exec: (sql) => db.exec(sql),
				get: (sql, ...args) => db.get(sql, ...args),
				all: (sql, ...args) => db.all(sql, ...args),
				close: () => db.close(),
				transaction: (operation) =>
					db.transaction((txn) => {
						const result = operation(txn);
						if (failCommit) throw failure;
						return result;
					}),
			};
		},
	});
	try {
		await store.initialize();
		const ops = new OccurrenceOperations(store);
		const item = await ops.createItem({ text: "before", parentId: null });
		const before = await store.exportGraphState();
		failCommit = true;
		assertStrictEquals(
			await assertRejects(() => store.batch(() => ops.updateItemText(item.id, "after"))),
			failure,
		);
		assertEquals(await store.exportGraphState(), before);
		await store.close();
		const reopened = new SqliteGraphStore(path);
		await reopened.initialize();
		try {
			assertEquals(await reopened.exportGraphState(), before);
		} finally {
			await reopened.close();
		}
	} finally {
		await store.close();
		await Deno.remove(dir, { recursive: true });
	}
});
