import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
	createCountingSqliteConnector,
	createPerformanceCounters,
	instrumentStore,
	type PerformanceCounterSnapshot,
} from "./performance_counters.ts";
import { SqliteGraphStore } from "../../src/storage/sqlite_store.ts";

Deno.test("PerformanceCounters tracks all metric keys and calculates delta accurately", () => {
	const counters = createPerformanceCounters();
	const initial = counters.snapshot();

	assertEquals(initial, {
		rpc: 0,
		transaction: 0,
		sql: 0,
		capture: 0,
		fullTextParse: 0,
		buildVisibleRows: 0,
		worldLayout: 0,
		lineage: 0,
		scc: 0,
		lane: 0,
		pairCompare: 0,
	});

	counters.recordRpc();
	counters.recordTransaction();
	counters.recordSql("SELECT 1");
	counters.recordCapture();
	counters.recordFullTextParse();
	counters.recordBuildVisibleRows();
	counters.recordWorldLayout();
	counters.recordLineage();
	counters.recordScc();
	counters.recordLane();
	counters.recordPairCompare();

	const current = counters.snapshot();
	assertEquals(current, {
		rpc: 1,
		transaction: 1,
		sql: 1,
		capture: 1,
		fullTextParse: 1,
		buildVisibleRows: 1,
		worldLayout: 1,
		lineage: 1,
		scc: 1,
		lane: 1,
		pairCompare: 1,
	});

	const delta = counters.delta(initial);
	assertEquals(delta, current);

	counters.reset();
	assertEquals(counters.snapshot(), initial);
});

Deno.test("createCountingSqliteConnector counts transactions, runs and queries without changing behavior", async () => {
	const counters = createPerformanceCounters();
	const connector = createCountingSqliteConnector(counters);
	const db = await connector(":memory:");

	try {
		db.exec("CREATE TABLE test (id INT, name TEXT);");
		assertEquals(counters.snapshot().sql, 1);
		assertEquals(counters.snapshot().transaction, 0);

		db.transaction((txn) => {
			txn.run("INSERT INTO test VALUES (?, ?);", 1, "alice");
			txn.run("INSERT INTO test VALUES (?, ?);", 2, "bob");
		});

		assertEquals(counters.snapshot().transaction, 1);
		assertEquals(counters.snapshot().sql, 3); // 1 CREATE + 2 INSERT

		const all = db.all("SELECT * FROM test ORDER BY id;") as Array<{ id: number; name: string }>;
		assertEquals(all.length, 2);
		assertEquals(counters.snapshot().sql, 4);

		const single = db.get("SELECT name FROM test WHERE id = ?;", 1) as { name: string };
		assertEquals(single.name, "alice");
		assertEquals(counters.snapshot().sql, 5);

		// Transaction failure preserves original error and counts failed transaction
		assertThrows(
			() => {
				db.transaction((txn) => {
					txn.run("INSERT INTO test VALUES (?, ?);", 3, "charlie");
					throw new Error("simulated failure");
				});
			},
			Error,
			"simulated failure",
		);
		assertEquals(counters.snapshot().transaction, 2);
		assertEquals(counters.snapshot().sql, 6);
	} finally {
		db.close();
	}
});

Deno.test("instrumentStore instruments SqliteGraphStore capture, transaction, and sql counts", async () => {
	const counters = createPerformanceCounters();
	const connector = createCountingSqliteConnector(counters);
	const store = new SqliteGraphStore(":memory:", { connector });
	instrumentStore(store, counters);

	try {
		await store.initialize();
		counters.reset();

		const before = counters.snapshot();
		assertEquals(before.capture, 0);
		assertEquals(before.transaction, 0);
		assertEquals(before.sql, 0);

		// Positive control: createWorkBundle executes transactions and SQL statements
		const now = new Date().toISOString();
		await store.createWorkBundle(
			{ id: "work-1", createdAt: now, updatedAt: now },
			{ id: "branch-1", workId: "work-1", name: "main", headRevisionId: null, createdAt: now },
			{ branchId: "branch-1", workId: "work-1", text: "# Hello", updatedAt: now },
			{
				id: "occ-1",
				workId: "work-1",
				parentOccurrenceId: null,
				orderKey: 1024,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: "branch-1" },
			},
		);

		const delta1 = counters.delta(before);
		// createWorkBundle is a full mutation, capturing before & after snapshots
		assertEquals(delta1.transaction > 0, true);
		assertEquals(delta1.sql > 0, true);
		assertEquals(delta1.capture, 2);

		// Targeted mutation (updateWorkingCopy) should bypass full capture (capture = 0)
		const beforeTargeted = counters.snapshot();
		await store.updateWorkingCopy("work-1", "# Updated text", now);
		const deltaTargeted = counters.delta(beforeTargeted);
		assertEquals(deltaTargeted.transaction > 0, true);
		assertEquals(deltaTargeted.sql > 0, true);
		assertEquals(deltaTargeted.capture, 0);

		// ExportGraphState triggers explicit capture count
		const snapshotBefore = counters.snapshot();
		const exported = await store.exportGraphState();
		assertEquals(exported.works.length, 1);

		const delta2 = counters.delta(snapshotBefore);
		assertEquals(delta2.capture, 1);
	} finally {
		await store.close();
	}
});
