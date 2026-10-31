import { assertEquals } from "jsr:@std/assert";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import { JsonGraphStore } from "../src/storage/json_store.ts";
import { MemoryGraphStore } from "../src/storage/memory_store.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import {
	createCountingSqliteConnector,
	PerformanceCounters,
} from "./support/performance_counters.ts";

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

Deno.test("A08 - OccurrenceOperations.listOutline is read-only (zero transactions on SQLite)", async () => {
	const counters = new PerformanceCounters();
	const connector = createCountingSqliteConnector(counters);
	const dbDir = await Deno.makeTempDir();
	const dbPath = `${dbDir}/test-list-outline.db`;

	const store = new SqliteGraphStore(dbPath, { connector });
	await store.initialize();
	try {
		const ops = new OccurrenceOperations(store);
		// Create two items
		const root = await ops.createItem({ text: "Root", parentId: null });
		await ops.createItem({ text: "Child", parentId: root.id });

		// Reset counters before read
		counters.reset();

		// Read outline
		const outline = await ops.listOutline();
		assertEquals(outline.items.length, 2);
		assertEquals(outline.knots.length, 0);

		// Must not initiate any write transactions or execute any Knot modifications
		assertEquals(
			counters.snapshot().transaction,
			0,
			"listOutline must not start write transactions",
		);
		const knotInserts = counters
			.getSqlLog()
			.filter(
				(stmt) =>
					stmt.toUpperCase().includes("INTO KNOT") ||
					stmt.toUpperCase().includes("DELETE FROM KNOT"),
			);
		assertEquals(knotInserts.length, 0, "listOutline must not modify knots in database");
	} finally {
		await store.close();
		await safeRemoveDir(dbDir);
	}
});

Deno.test("A08 - Promotion of 100 children triggers only 1 Knot reconciliation in batch", async () => {
	class CountingSqliteGraphStore extends SqliteGraphStore {
		reconcileCount = 0;
		override reconcileOutlineKnots(): void {
			this.reconcileCount++;
			super.reconcileOutlineKnots();
		}
	}

	const counters = new PerformanceCounters();
	const connector = createCountingSqliteConnector(counters);
	const dbDir = await Deno.makeTempDir();
	const dbPath = `${dbDir}/test-100-promotion.db`;

	const store = new CountingSqliteGraphStore(dbPath, { connector });
	await store.initialize();
	try {
		const ops = new OccurrenceOperations(store);
		// Create parent item
		const parent = await ops.createItem({ text: "Parent", parentId: null });

		// Create 100 children in a batch
		await store.batch(async () => {
			for (let i = 0; i < 100; i++) {
				await ops.createItem({ text: `Child ${i}`, parentId: parent.id });
			}
		});

		store.reconcileCount = 0;
		counters.reset();

		// Deleting parent promotes all 100 children to root inside batch
		await ops.deleteItem(parent.id);

		// Reconcile must be called at most once during the commit of this batch
		assertEquals(
			store.reconcileCount,
			1,
			"Promoting 100 children in batch must reconcile knots only once",
		);
		assertEquals(counters.snapshot().transaction, 1);
	} finally {
		await store.close();
		await safeRemoveDir(dbDir);
	}
});

Deno.test("A08 - Single collapse update triggers zero Knot reconciliations", async () => {
	class CountingSqliteGraphStore extends SqliteGraphStore {
		reconcileCount = 0;
		override reconcileOutlineKnots(): void {
			this.reconcileCount++;
			super.reconcileOutlineKnots();
		}
	}

	const counters = new PerformanceCounters();
	const connector = createCountingSqliteConnector(counters);
	const dbDir = await Deno.makeTempDir();
	const dbPath = `${dbDir}/test-collapse-reconcile.db`;

	const store = new CountingSqliteGraphStore(dbPath, { connector });
	await store.initialize();
	try {
		const ops = new OccurrenceOperations(store);
		const item = await ops.createItem({ text: "Item", parentId: null });

		store.reconcileCount = 0;
		await ops.setCollapsed(item.id, true);

		assertEquals(
			store.reconcileCount,
			0,
			"Single collapse update must trigger 0 Knot reconciliations",
		);
	} finally {
		await store.close();
		await safeRemoveDir(dbDir);
	}
});

Deno.test("A08 - Memory, Json, and Sqlite produce identical knots across topologies", async () => {
	const tempDir = await Deno.makeTempDir();
	const jsonPath = `${tempDir}/test.json`;
	const sqlitePath = `${tempDir}/test.db`;

	const memoryStore = new MemoryGraphStore();
	const jsonStore = new JsonGraphStore(jsonPath);
	const sqliteStore = new SqliteGraphStore(sqlitePath);

	await memoryStore.initialize();
	await jsonStore.initialize();
	await sqliteStore.initialize();

	try {
		const memOps = new OccurrenceOperations(memoryStore);
		const jsonOps = new OccurrenceOperations(jsonStore);
		const sqliteOps = new OccurrenceOperations(sqliteStore);

		// Create cycle: itemA -> itemB -> itemA
		const [mA, jA, sA] = await Promise.all([
			memOps.createItem({ text: "A", parentId: null }),
			jsonOps.createItem({ text: "A", parentId: null }),
			sqliteOps.createItem({ text: "A", parentId: null }),
		]);
		const [mB, jB, sB] = await Promise.all([
			memOps.createItem({ text: "B", parentId: mA.id }),
			jsonOps.createItem({ text: "B", parentId: jA.id }),
			sqliteOps.createItem({ text: "B", parentId: sA.id }),
		]);

		// Update A parent to B to create cycle
		await Promise.all([
			memOps.moveItem({ id: mA.id, parentId: mB.id }),
			jsonOps.moveItem({ id: jA.id, parentId: jB.id }),
			sqliteOps.moveItem({ id: sA.id, parentId: sB.id }),
		]);

		const [mKnots, jKnots, sKnots] = await Promise.all([
			memoryStore.listKnots(),
			jsonStore.listKnots(),
			sqliteStore.listKnots(),
		]);

		assertEquals(mKnots.length, 1);
		assertEquals(jKnots.length, 1);
		assertEquals(sKnots.length, 1);
		assertEquals(mKnots[0].cycleIds.length, 2);
		assertEquals(jKnots[0].cycleIds.length, 2);
		assertEquals(sKnots[0].cycleIds.length, 2);
	} finally {
		await memoryStore.close();
		await jsonStore.close();
		await sqliteStore.close();
		await safeRemoveDir(tempDir);
	}
});
