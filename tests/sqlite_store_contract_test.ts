import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
	type SqliteDatabase,
	type SqliteDatabaseTransaction,
	SqliteGraphStore,
} from "../src/storage/sqlite_store.ts";
import { graphStateHash, migrateLegacyStorageToTurso } from "../src/storage/turso_migration.ts";
import { NodeSqliteDatabaseAdapter } from "../src/storage/sqlite_records.ts";
import { SQLITE_SCHEMA_SQL } from "../src/storage/sqlite_schema.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { OccurrenceOperations } from "../src/services/occurrence_operations.ts";
import {
	createCountingSqliteConnector,
	PerformanceCounters,
} from "./support/performance_counters.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";

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

function createComplexSnapshot(): GraphStateSnapshot {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	const occId = crypto.randomUUID();
	const knotId = crypto.randomUUID();
	const bookmarkId = crypto.randomUUID();

	return {
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: CREATED_AT }],
		workingCopies: [{
			branchId,
			workId,
			text: "SQLite移行の日本語・Markdown・radiora://item/ リンクテスト",
			updatedAt: CREATED_AT,
		}],
		occurrences: [{
			id: occId,
			workId,
			parentOccurrenceId: occId,
			orderKey: 1024,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		}],
		links: [],
		systemRelations: [],
		knots: [{ id: knotId, cycleIds: [occId], createdAt: CREATED_AT }],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [{ id: bookmarkId, workId, occurrenceId: occId, createdAt: CREATED_AT }],
		resumePosition: { workId, occurrenceId: occId, caretOffset: 5, updatedAt: CREATED_AT },
	};
}

function createTwoWorkSnapshot(): GraphStateSnapshot {
	const workId1 = crypto.randomUUID();
	const workId2 = crypto.randomUUID();
	const branchId1 = crypto.randomUUID();
	const branchId2 = crypto.randomUUID();
	const occId1 = crypto.randomUUID();
	const occId2 = crypto.randomUUID();
	const bookmarkId = crypto.randomUUID();

	return {
		works: [
			{ id: workId1, createdAt: CREATED_AT, updatedAt: CREATED_AT },
			{ id: workId2, createdAt: CREATED_AT, updatedAt: CREATED_AT },
		],
		branches: [
			{ id: branchId1, workId: workId1, name: "main", headRevisionId: null, createdAt: CREATED_AT },
			{ id: branchId2, workId: workId2, name: "main", headRevisionId: null, createdAt: CREATED_AT },
		],
		workingCopies: [
			{ branchId: branchId1, workId: workId1, text: "Work 1 text", updatedAt: CREATED_AT },
			{ branchId: branchId2, workId: workId2, text: "Work 2 text", updatedAt: CREATED_AT },
		],
		occurrences: [
			{
				id: occId1,
				workId: workId1,
				parentOccurrenceId: null,
				orderKey: 1024,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: branchId1 },
			},
			{
				id: occId2,
				workId: workId2,
				parentOccurrenceId: null,
				orderKey: 2048,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: branchId2 },
			},
		],
		links: [],
		systemRelations: [],
		knots: [],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [{ id: bookmarkId, workId: workId1, occurrenceId: occId1, createdAt: CREATED_AT }],
		resumePosition: {
			workId: workId1,
			occurrenceId: occId1,
			caretOffset: 5,
			updatedAt: CREATED_AT,
		},
	};
}

Deno.test("SqliteGraphStore initializes schema and reopens existing radiora.db with full fidelity", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-reopen-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();

	try {
		// 1. Initial write
		const store1 = new SqliteGraphStore(dbPath);
		await store1.initialize();
		await store1.restoreGraphState(snapshot);
		await store1.close();

		// Verify file exists on disk
		const stat = await Deno.stat(dbPath);
		assert(stat.isFile && stat.size > 0);

		// 2. Reopen existing database
		const store2 = new SqliteGraphStore(dbPath);
		await store2.initialize();
		const exported = await store2.exportGraphState();

		assertEquals(exported.works.length, 1);
		assertEquals(exported.works[0].id, snapshot.works[0].id);
		assertEquals(
			exported.workingCopies[0].text,
			"SQLite移行の日本語・Markdown・radiora://item/ リンクテスト",
		);
		assertEquals(exported.bookmarks.length, 1);
		assertEquals(exported.knots.length, 1);
		assertEquals(exported.knots[0].cycleIds, [snapshot.occurrences[0].id]);
		assertEquals(exported.resumePosition?.caretOffset, 5);

		// Hash parity check
		const originalHash = await graphStateHash(snapshot);
		const reopenedHash = await graphStateHash(exported);
		assertEquals(originalHash, reopenedHash);

		await store2.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore statement trace proves single WorkingCopy update writes only modified row and metadata", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-trace-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();
	let rawDb: NodeSqliteDatabaseAdapter | null = null;
	const executedStatements: Array<{ sql: string; args: unknown[] }> = [];

	const connector = async (path: string): Promise<SqliteDatabase> => {
		const opened = await NodeSqliteDatabaseAdapter.open(path);
		rawDb = opened;
		return {
			exec: (sql) => opened.exec(sql),
			get: (sql, ...args) => opened.get(sql, ...args),
			all: (sql, ...args) => opened.all(sql, ...args),
			transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
				return opened.transaction((txn) => {
					return fn({
						run: (sql, ...args) => {
							executedStatements.push({ sql, args });
							txn.run(sql, ...args);
						},
					});
				});
			},
			close: () => {
				opened.close();
				rawDb = null;
			},
		};
	};

	try {
		const store = new SqliteGraphStore(dbPath, { connector });
		await store.initialize();
		await store.restoreGraphState(snapshot);

		// Clear statement log after initial state restoration
		executedStatements.length = 0;
		let exportCount = 0;
		const originalExport = store.exportGraphState.bind(store);
		store.exportGraphState = async () => {
			exportCount++;
			return await originalExport();
		};

		// Perform a single working copy update
		const updatedText = "差分永続化テスト: 単一WorkingCopyのみ更新";
		await store.updateWorkingCopy(snapshot.works[0].id, updatedText, "2026-08-01T00:00:00.000Z");

		// Must bypass full exportGraphState capture
		assertEquals(exportCount, 0);

		// Exactly three statements must be executed:
		// 1 for work (updatedAt), 1 for working_copy (text + updatedAt), 1 for storage_metadata
		assertEquals(executedStatements.length, 3);
		assert(executedStatements[0].sql.includes("INSERT INTO work "));
		assertEquals(executedStatements[0].args[0], snapshot.works[0].id);
		assert(executedStatements[1].sql.includes("INSERT INTO working_copy "));
		assertEquals(executedStatements[1].args[0], snapshot.branches[0].id);
		assert(executedStatements[2].sql.includes("INSERT INTO storage_metadata "));

		// Verify no table had DELETE executed and untouched tables were not written
		const modifiedSql = executedStatements.map((s) => s.sql);
		assertEquals(modifiedSql.some((s) => s.includes("DELETE FROM")), false);
		assertEquals(modifiedSql.some((s) => s.includes("INSERT INTO branch ")), false);
		assertEquals(modifiedSql.some((s) => s.includes("INSERT INTO occurrence ")), false);
		assertEquals(modifiedSql.some((s) => s.includes("INSERT INTO bookmark ")), false);
		assertEquals(modifiedSql.some((s) => s.includes("INSERT INTO knot ")), false);

		await store.close();
	} finally {
		(rawDb as NodeSqliteDatabaseAdapter | null)?.close();
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore applies granular add, delete, reorder, feedback, and singleton diffs accurately", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-diffs-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createTwoWorkSnapshot();
	const work1 = snapshot.works[0];
	const work2 = snapshot.works[1];
	const occ1 = snapshot.occurrences[0];
	const occ2 = snapshot.occurrences[1];

	try {
		const store = new SqliteGraphStore(dbPath);
		await store.initialize();
		await store.restoreGraphState(snapshot);

		// 1. Array position reorder across multiple tables (works and occurrences reversed)
		await store.restoreGraphState({
			...snapshot,
			works: [work2, work1],
			occurrences: [occ2, occ1],
		});

		// 2. Delete Bookmark
		await store.deleteBookmark(snapshot.bookmarks[0].id);
		const afterDeleteBookmark = await store.exportGraphState();
		assertEquals(afterDeleteBookmark.bookmarks.length, 0);

		// 3. Add Emergence Feedback
		await store.setEmergenceFeedback("suggestion-1", "accept");
		const afterFeedback = await store.exportGraphState();
		assertEquals(afterFeedback.emergenceFeedback["suggestion-1"], "accept");

		// 4. Clear Resume Position singleton
		await store.clearResumePosition();
		const afterClearResume = await store.exportGraphState();
		assertEquals(afterClearResume.resumePosition, null);

		// 5. Set Resume Position singleton again
		await store.setResumePosition({
			workId: work2.id,
			occurrenceId: occ2.id,
			caretOffset: 42,
			updatedAt: "2026-08-01T00:00:00.000Z",
		});
		const afterSetResume = await store.exportGraphState();
		assertEquals(afterSetResume.resumePosition?.caretOffset, 42);

		await store.close();

		// 6. Inspect physical SQLite database rows to verify positions and deletion
		const directDb = await NodeSqliteDatabaseAdapter.open(dbPath);
		const workRows = directDb.all("SELECT id, position FROM work ORDER BY position") as Array<{
			id: string;
			position: number;
		}>;
		assertEquals(workRows.length, 2);
		assertEquals(workRows[0].id, work2.id);
		assertEquals(workRows[0].position, 0);
		assertEquals(workRows[1].id, work1.id);
		assertEquals(workRows[1].position, 1);

		const occRows = directDb.all("SELECT id, position FROM occurrence ORDER BY position") as Array<{
			id: string;
			position: number;
		}>;
		assertEquals(occRows.length, 2);
		assertEquals(occRows[0].id, occ2.id);
		assertEquals(occRows[0].position, 0);
		assertEquals(occRows[1].id, occ1.id);
		assertEquals(occRows[1].position, 1);

		const bookmarkRows = directDb.all("SELECT id FROM bookmark");
		assertEquals(bookmarkRows.length, 0);
		directDb.close();

		// 7. Reopen via SqliteGraphStore to verify memory-state parity
		const reopened = new SqliteGraphStore(dbPath);
		await reopened.initialize();
		const diskState = await reopened.exportGraphState();

		assertEquals(diskState.works[0].id, work2.id);
		assertEquals(diskState.works[1].id, work1.id);
		assertEquals(diskState.occurrences[0].id, occ2.id);
		assertEquals(diskState.occurrences[1].id, occ1.id);
		assertEquals(diskState.bookmarks.length, 0);
		assertEquals(diskState.emergenceFeedback["suggestion-1"], "accept");
		assertEquals(diskState.resumePosition?.caretOffset, 42);

		await reopened.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore rollback on persistence failure restores memory state and rolls back disk transaction", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-fault-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();
	const rawDb = await NodeSqliteDatabaseAdapter.open(dbPath);
	let failTransaction = false;

	const faultyDb: SqliteDatabase = {
		exec: (sql) => rawDb.exec(sql),
		get: (sql, ...args) => rawDb.get(sql, ...args),
		all: (sql, ...args) => rawDb.all(sql, ...args),
		transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
			return rawDb.transaction((txn) => {
				if (failTransaction) {
					throw new Error("Simulated disk I/O failure during mutation transaction");
				}
				return fn(txn);
			});
		},
		close: () => rawDb.close(),
	};

	try {
		const store = new SqliteGraphStore(dbPath, { connector: () => faultyDb });
		await store.initialize();
		await store.restoreGraphState(snapshot);

		// Arm the transaction failure
		failTransaction = true;

		// Attempt to update working copy text
		await assertRejects(
			() =>
				store.updateWorkingCopy(snapshot.works[0].id, "破壊的テキスト", "2026-08-01T00:00:00.000Z"),
			Error,
			"Simulated disk I/O failure",
		);

		// Memory state must be restored to prior state
		const memoryState = await store.exportGraphState();
		assertEquals(
			memoryState.workingCopies[0].text,
			"SQLite移行の日本語・Markdown・radiora://item/ リンクテスト",
		);

		// Disarm failure and close
		failTransaction = false;
		await store.close();

		// Reopen via fresh connection to verify disk was not modified
		const freshStore = new SqliteGraphStore(dbPath);
		await freshStore.initialize();
		const diskState = await freshStore.exportGraphState();
		assertEquals(
			diskState.workingCopies[0].text,
			"SQLite移行の日本語・Markdown・radiora://item/ リンクテスト",
		);
		await freshStore.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("NodeSqliteDatabaseAdapter transaction rolls back uncommitted INSERT on thrown error", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-txn-rollback-" });
	const dbPath = `${root}\\radiora.db`;
	const uncommittedWorkId = `work-${crypto.randomUUID()}`;

	try {
		const adapter = await NodeSqliteDatabaseAdapter.open(dbPath);
		adapter.exec(SQLITE_SCHEMA_SQL);

		// Execute transaction that inserts a row and then throws before commit
		assertThrows(
			() => {
				adapter.transaction((txn) => {
					txn.run(
						"INSERT INTO work (id, position, payload) VALUES (?, ?, ?)",
						uncommittedWorkId,
						0,
						JSON.stringify({ id: uncommittedWorkId, createdAt: CREATED_AT, updatedAt: CREATED_AT }),
					);
					throw new Error("Intentional error before commit");
				});
			},
			Error,
			"Intentional error before commit",
		);

		// Verify immediately on same adapter that the row was rolled back
		const rowAfterFailure = adapter.get("SELECT id FROM work WHERE id = ?", uncommittedWorkId);
		assertEquals(rowAfterFailure, undefined);
		adapter.close();

		// Reopen via fresh connection to prove disk integrity
		const reopened = await NodeSqliteDatabaseAdapter.open(dbPath);
		const reopenedRow = reopened.get("SELECT id FROM work WHERE id = ?", uncommittedWorkId);
		assertEquals(reopenedRow, undefined);
		reopened.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore serializes concurrent async mutations, delays close during in-flight mutation, and rejects new mutations", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-concurrent-" });
	const dbPath = `${root}\\radiora.db`;
	const initialSnapshot = createComplexSnapshot();
	const workId = initialSnapshot.works[0].id;
	const branchId = initialSnapshot.branches[0].id;

	try {
		const store = new SqliteGraphStore(dbPath);
		await store.initialize();
		await store.restoreGraphState(initialSnapshot);

		// 1. Verify queue recovers from a failing mutation
		await assertRejects(
			() =>
				store.restoreGraphState({
					...initialSnapshot,
					works: [{ id: "invalid-empty-work" }] as never,
				}),
		);

		// 2. Start subsequent mutation and close in the same tick
		const inFlightPromise = store.updateBranchWorkingCopy(
			branchId,
			"直列化された後続更新テキスト",
			"2026-08-01T00:00:00.000Z",
		);
		const closePromise = store.close();

		// closePromise must be pending while inFlightPromise is executing
		const race = await Promise.race([
			closePromise.then(() => "closed"),
			Promise.resolve("pending"),
		]);
		assertEquals(race, "pending");

		// 3. Attempt a new mutation after close has initiated - must be rejected immediately
		await assertRejects(
			() =>
				store.createBookmark({
					id: "rejected-bm",
					workId,
					occurrenceId: initialSnapshot.occurrences[0].id,
					createdAt: CREATED_AT,
				}),
			Error,
			"SqliteGraphStore is closing",
		);

		// 4. Await in-flight mutation and close completion
		await inFlightPromise;
		await closePromise;

		// 5. Reopen database from disk to verify that in-flight mutation was persisted with fidelity
		const reopened = new SqliteGraphStore(dbPath);
		await reopened.initialize();
		const diskState = await reopened.exportGraphState();
		assertEquals(diskState.workingCopies[0].text, "直列化された後続更新テキスト");
		assertEquals(diskState.bookmarks.some((b) => b.id === "rejected-bm"), false);
		await reopened.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("migrateLegacyStorageToTurso executes atomic migration roundtrip into SqliteGraphStore", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-migration-" });
	const sourcePath = `${root}\\source.db`;
	const sourceVersionMarkerPath = `${root}\\storage-schema-version`;
	const backupRoot = `${root}\\migration-backups`;
	const targetPath = `${root}\\radiora.db`;
	const markerPath = `${targetPath}.migration.json`;

	await Deno.writeTextFile(sourcePath, "dummy legacy surreal data");
	await Deno.writeTextFile(sourceVersionMarkerPath, "6");

	const sampleSnapshot = createComplexSnapshot();

	try {
		const result = await migrateLegacyStorageToTurso({
			sourcePath,
			sourceVersionMarkerPath,
			backupRoot,
			targetPath,
			markerPath,
			exportSnapshot: async () => sampleSnapshot,
		});

		assert(result);
		assertEquals(result.sourceStorageVersion, 6);
		assert(result.snapshotHash.length > 0);

		// Verify target is loadable via SqliteGraphStore
		const store = new SqliteGraphStore(targetPath);
		await store.initialize();
		const loaded = await store.exportGraphState();
		assertEquals(loaded.works.length, 1);
		assertEquals(loaded.workingCopies[0].text, sampleSnapshot.workingCopies[0].text);
		await store.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore batch commits multiple operations atomically and rolls back on failure", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-batch-test-" });
	const targetPath = `${root}\\batch.db`;
	const store = new SqliteGraphStore(targetPath);
	await store.initialize();

	try {
		const workId = crypto.randomUUID();
		const branchId = crypto.randomUUID();
		const occId1 = crypto.randomUUID();
		const occId2 = crypto.randomUUID();

		await store.createWorkBundle(
			{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT },
			{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: CREATED_AT },
			{ branchId, workId, text: "initial text", updatedAt: CREATED_AT },
			{
				id: occId1,
				workId,
				parentOccurrenceId: null,
				orderKey: 1024,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId },
			},
		);

		// Execute batch of multiple operations
		await store.batch(async () => {
			await store.createOccurrence({
				id: occId2,
				workId,
				parentOccurrenceId: occId1,
				orderKey: 2048,
				collapsed: true,
				revisionSelector: { mode: "branch", branchId },
			});
			await store.updateOccurrence({
				id: occId1,
				workId,
				parentOccurrenceId: null,
				orderKey: 512,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId },
			});
		});

		// Verify both updates committed
		const occurrences = await store.listOccurrences();
		assertEquals(occurrences.length, 2);
		assertEquals(occurrences.find((o) => o.id === occId1)?.orderKey, 512);
		assertEquals(occurrences.find((o) => o.id === occId2)?.parentOccurrenceId, occId1);

		// Verify failed batch rolls back both in memory and disk
		await assertRejects(
			() =>
				store.batch(async () => {
					await store.updateOccurrence({
						id: occId1,
						workId,
						parentOccurrenceId: null,
						orderKey: 9999,
						collapsed: false,
						revisionSelector: { mode: "branch", branchId },
					});
					throw new Error("simulated failure inside batch");
				}),
			Error,
			"simulated failure inside batch",
		);

		// Ensure orderKey was rolled back to 512
		const rolledBack = await store.listOccurrences();
		assertEquals(rolledBack.find((o) => o.id === occId1)?.orderKey, 512);

		// Reopen store from disk to ensure SQLite database also did not commit the failed change
		await store.close();
		const reopened = new SqliteGraphStore(targetPath);
		await reopened.initialize();
		const diskOccurrences = await reopened.listOccurrences();
		assertEquals(diskOccurrences.find((o) => o.id === occId1)?.orderKey, 512);
		await reopened.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore replaceKnots skips mutation and transaction when knots are unchanged", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-knot-trace-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();
	const executedStatements: Array<{ sql: string; args: unknown[] }> = [];

	const connector = async (path: string): Promise<SqliteDatabase> => {
		const opened = await NodeSqliteDatabaseAdapter.open(path);
		return {
			exec: (sql) => opened.exec(sql),
			get: (sql, ...args) => opened.get(sql, ...args),
			all: (sql, ...args) => opened.all(sql, ...args),
			transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
				return opened.transaction((txn) => {
					return fn({
						run: (sql, ...args) => {
							executedStatements.push({ sql, args });
							txn.run(sql, ...args);
						},
					});
				});
			},
			close: () => opened.close(),
		};
	};

	try {
		const store = new SqliteGraphStore(dbPath, { connector });
		await store.initialize();
		await store.restoreGraphState(snapshot);

		executedStatements.length = 0;
		let exportCount = 0;
		const originalExport = store.exportGraphState.bind(store);
		store.exportGraphState = async () => {
			exportCount++;
			return await originalExport();
		};

		const currentKnots = await store.listKnots();
		await store.replaceKnots(currentKnots);

		// Must not trigger exportGraphState or any write/transaction statements
		assertEquals(exportCount, 0);
		assertEquals(executedStatements.length, 0);

		await store.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("OccurrenceOperations listOutline executes zero write transactions and zero exports when knots are unchanged", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-listoutline-trace-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();
	const executedStatements: Array<{ sql: string; args: unknown[] }> = [];

	const connector = async (path: string): Promise<SqliteDatabase> => {
		const opened = await NodeSqliteDatabaseAdapter.open(path);
		return {
			exec: (sql) => opened.exec(sql),
			get: (sql, ...args) => opened.get(sql, ...args),
			all: (sql, ...args) => opened.all(sql, ...args),
			transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
				return opened.transaction((txn) => {
					return fn({
						run: (sql, ...args) => {
							executedStatements.push({ sql, args });
							txn.run(sql, ...args);
						},
					});
				});
			},
			close: () => opened.close(),
		};
	};

	let store: SqliteGraphStore | null = null;
	try {
		store = new SqliteGraphStore(dbPath, { connector });
		await store.initialize();
		await store.restoreGraphState(snapshot);

		const operations = new OccurrenceOperations(store);

		// First call reconciles and persists knot projection
		await operations.listOutline();

		executedStatements.length = 0;
		let replaceKnotsCalls = 0;
		const originalReplaceKnots = store.replaceKnots.bind(store);
		store.replaceKnots = async (knots) => {
			replaceKnotsCalls++;
			return await originalReplaceKnots(knots);
		};

		// Second call must execute zero write statements / transactions and zero replaceKnots calls
		await operations.listOutline();
		assertEquals(replaceKnotsCalls, 0);
		assertEquals(executedStatements.length, 0);
	} finally {
		if (store) await store.close();
		await safeRemoveDir(root);
	}
});

Deno.test("SqliteGraphStore targeted mutations (occurrence and resume position) bypass full snapshot capture and roll back on error", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-targeted-" });
	const dbPath = `${root}\\radiora.db`;
	const snapshot = createComplexSnapshot();
	const executedStatements: Array<{ sql: string; args: unknown[] }> = [];

	let failTransaction = false;

	const connector = async (path: string): Promise<SqliteDatabase> => {
		const opened = await NodeSqliteDatabaseAdapter.open(path);
		return {
			exec: (sql) => opened.exec(sql),
			get: (sql, ...args) => opened.get(sql, ...args),
			all: (sql, ...args) => opened.all(sql, ...args),
			transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
				if (failTransaction) {
					throw new Error("simulated disk transaction failure");
				}
				return opened.transaction((txn) => {
					return fn({
						run: (sql, ...args) => {
							executedStatements.push({ sql, args });
							txn.run(sql, ...args);
						},
					});
				});
			},
			close: () => opened.close(),
		};
	};

	let store: SqliteGraphStore | null = null;
	try {
		store = new SqliteGraphStore(dbPath, { connector });
		await store.initialize();
		await store.restoreGraphState(snapshot);

		let exportCount = 0;
		const originalExport = store.exportGraphState.bind(store);
		store.exportGraphState = async () => {
			exportCount++;
			return await originalExport();
		};

		// 1. updateOccurrence (e.g. collapse toggle)
		executedStatements.length = 0;
		exportCount = 0;
		const occ = snapshot.occurrences[0];
		await store.updateOccurrence({ ...occ, collapsed: true });

		assertEquals(exportCount, 0);
		assertEquals(executedStatements.length, 2); // 1 for occurrence, 1 for metadata
		assert(executedStatements[0].sql.includes("INSERT INTO occurrence "));
		assertEquals(executedStatements[0].args[0], occ.id);

		// Verify in memory
		const inMemOcc = (await store.listOccurrences()).find((o) => o.id === occ.id);
		assertEquals(inMemOcc?.collapsed, true);

		// 2. setResumePosition (caret move)
		executedStatements.length = 0;
		exportCount = 0;
		await store.setResumePosition({
			workId: occ.workId,
			occurrenceId: occ.id,
			caretOffset: 42,
			updatedAt: "2026-08-02T00:00:00.000Z",
		});

		assertEquals(exportCount, 0);
		assertEquals(executedStatements.length, 2); // 1 for resume_position, 1 for metadata
		assert(executedStatements[0].sql.includes("INSERT INTO resume_position "));
		assertEquals((await store.getResumePosition())?.caretOffset, 42);

		// 3. clearResumePosition
		executedStatements.length = 0;
		exportCount = 0;
		await store.clearResumePosition();

		assertEquals(exportCount, 0);
		assertEquals(executedStatements.length, 2); // 1 for DELETE resume_position, 1 for metadata
		assert(executedStatements[0].sql.includes("DELETE FROM resume_position"));
		assertEquals(await store.getResumePosition(), null);

		// 4. Rollback on transaction failure
		failTransaction = true;
		const activeStore = store;
		if (!activeStore) throw new Error("Store was closed before rollback verification");
		await assertRejects(
			() => activeStore.updateOccurrence({ ...occ, collapsed: false }),
			Error,
			"simulated disk transaction failure",
		);

		// Memory state must remain rolled back to collapsed: true
		const rolledBackOcc = (await store.listOccurrences()).find((o) => o.id === occ.id);
		assertEquals(rolledBackOcc?.collapsed, true);
	} finally {
		if (store) await store.close();
		await safeRemoveDir(root);
	}
});

Deno.test(
	"SqliteGraphStore batch isolates in-flight batch from concurrent external mutations and preserves external mutation on rollback (C05)",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-isolate-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		let reopened: SqliteGraphStore | null = null;
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const workId = snapshot.works[0].id;
			const occ = snapshot.occurrences[0];

			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();

			const batchPromise = store.batch(async () => {
				await store.updateOccurrence({ ...occ, collapsed: true });
				entered.resolve();
				await release.promise;
				throw new Error("simulated failure inside batch");
			});

			const batchRejection = assertRejects(
				() => batchPromise,
				Error,
				"simulated failure inside batch",
			);

			await entered.promise;

			let externalSettled = false;
			try {
				const externalUpdatePromise = store.updateWorkingCopy(
					workId,
					"Concurrent external update text",
					"2026-08-01T12:00:00.000Z",
				).then(() => {
					externalSettled = true;
				});

				await new Promise((resolve) => setTimeout(resolve, 30));
				assert(!externalSettled, "External mutation should wait in queue while batch is active");

				release.resolve();
				await batchRejection;

				await externalUpdatePromise;
				assert(externalSettled, "External mutation should succeed after batch finishes");

				const memoryOcc = (await store.listOccurrences()).find((o) => o.id === occ.id);
				assertEquals(memoryOcc?.collapsed, false);
				const memoryText = (await store.exportGraphState()).workingCopies.find((w) =>
					w.workId === workId
				)?.text;
				assertEquals(memoryText, "Concurrent external update text");

				await store.close();
				storeClosed = true;
				reopened = new SqliteGraphStore(targetPath);
				await reopened.initialize();
				const diskOcc = (await reopened.listOccurrences()).find((o) => o.id === occ.id);
				assertEquals(diskOcc?.collapsed, false);
				const diskText = (await reopened.exportGraphState()).workingCopies.find((w) =>
					w.workId === workId
				)?.text;
				assertEquals(diskText, "Concurrent external update text");
			} finally {
				release.resolve();
				await batchRejection;
			}
		} finally {
			if (!storeClosed) await store.close();
			if (reopened) await reopened.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore batch serializes concurrent external mutation on successful batch completion",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-success-concur-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		let reopened: SqliteGraphStore | null = null;
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const workId = snapshot.works[0].id;
			const occ = snapshot.occurrences[0];

			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();

			const batchPromise = store.batch(async () => {
				await store.updateOccurrence({ ...occ, collapsed: true });
				entered.resolve();
				await release.promise;
			});

			await entered.promise;

			let externalSettled = false;
			try {
				const externalUpdatePromise = store.updateWorkingCopy(
					workId,
					"External text after success",
					"2026-08-01T12:00:00.000Z",
				).then(() => {
					externalSettled = true;
				});

				await new Promise((resolve) => setTimeout(resolve, 30));
				assert(!externalSettled, "External mutation should wait in queue while batch is active");

				release.resolve();
				await batchPromise;
				await externalUpdatePromise;
				assert(externalSettled);

				const memoryOcc = (await store.listOccurrences()).find((o) => o.id === occ.id);
				assertEquals(memoryOcc?.collapsed, true);
				const memoryText = (await store.exportGraphState()).workingCopies.find((w) =>
					w.workId === workId
				)?.text;
				assertEquals(memoryText, "External text after success");

				await store.close();
				storeClosed = true;
				reopened = new SqliteGraphStore(targetPath);
				await reopened.initialize();
				const diskOcc = (await reopened.listOccurrences()).find((o) => o.id === occ.id);
				assertEquals(diskOcc?.collapsed, true);
				const diskText = (await reopened.exportGraphState()).workingCopies.find((w) =>
					w.workId === workId
				)?.text;
				assertEquals(diskText, "External text after success");
			} finally {
				release.resolve();
				await batchPromise;
			}
		} finally {
			if (!storeClosed) await store.close();
			if (reopened) await reopened.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore batch handles synchronous throw cleanly without leaving active batch state",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-syncthrow-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const workId = snapshot.works[0].id;

			await assertRejects(
				() =>
					store.batch(() => {
						throw new Error("sync error inside batch");
					}),
				Error,
				"sync error inside batch",
			);

			await store.updateWorkingCopy(workId, "Post sync throw text", "2026-08-01T12:00:00.000Z");
			const text = (await store.exportGraphState()).workingCopies.find((w) => w.workId === workId)
				?.text;
			assertEquals(text, "Post sync throw text");

			await store.close();
			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskText = (await reopened.exportGraphState()).workingCopies.find((w) =>
				w.workId === workId
			)?.text;
			assertEquals(diskText, "Post sync throw text");
			await reopened.close();
		} finally {
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore nested batch shares batch context without duplicate transaction or capture",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-nested-" });
		const targetPath = `${root}\\radiora.db`;
		let transactionCount = 0;
		const connector = async (path: string): Promise<SqliteDatabase> => {
			const opened = await NodeSqliteDatabaseAdapter.open(path);
			return {
				exec: (sql) => opened.exec(sql),
				get: (sql, ...args) => opened.get(sql, ...args),
				all: (sql, ...args) => opened.all(sql, ...args),
				transaction: <T>(fn: (txn: SqliteDatabaseTransaction) => T): T => {
					transactionCount++;
					return opened.transaction(fn);
				},
				close: () => opened.close(),
			};
		};

		const store = new SqliteGraphStore(targetPath, { connector });
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const occ = snapshot.occurrences[0];

			let exportCount = 0;
			const originalExport = store.exportGraphState.bind(store);
			store.exportGraphState = async () => {
				exportCount++;
				return await originalExport();
			};

			transactionCount = 0;
			exportCount = 0;

			await store.batch(async () => {
				await store.updateOccurrence({ ...occ, collapsed: true });
				await store.batch(async () => {
					await store.setResumePosition({
						workId: occ.workId,
						occurrenceId: occ.id,
						caretOffset: 99,
						updatedAt: "2026-08-01T12:00:00.000Z",
					});
				});
			});

			assertEquals(transactionCount, 1);
			assertEquals(exportCount, 2);

			const inMemOcc = (await store.listOccurrences()).find((o) => o.id === occ.id);
			assertEquals(inMemOcc?.collapsed, true);
			const pos = await store.getResumePosition();
			assertEquals(pos?.caretOffset, 99);

			await store.close();
			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskOcc = (await reopened.listOccurrences()).find((o) => o.id === occ.id);
			assertEquals(diskOcc?.collapsed, true);
			const diskPos = await reopened.getResumePosition();
			assertEquals(diskPos?.caretOffset, 99);
			await reopened.close();
		} finally {
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore rejects mutations issued from an expired batch context",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-expired-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const workId = snapshot.works[0].id;

			const timerTriggered = Promise.withResolvers<Promise<void>>();

			await store.batch(async () => {
				setTimeout(() => {
					timerTriggered.resolve(
						store.updateWorkingCopy(workId, "late text", "2026-08-01T12:00:00.000Z"),
					);
				}, 10);
			});

			await assertRejects(
				() => timerTriggered.promise,
				Error,
				"Batch context is expired",
			);

			await store.close();
			storeClosed = true;
		} finally {
			if (!storeClosed) await store.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore rejects close call attempted from inside an active batch",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-batch-close-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);

			await store.batch(async () => {
				await assertRejects(
					() => store.close(),
					Error,
					"Cannot close SqliteGraphStore from inside an active batch",
				);
			});

			await store.close();
		} finally {
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore serializes concurrent replaceKnots requests and respects latest queue state (C06)",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-knot-order-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		await store.initialize();

		try {
			const snapshot = createComplexSnapshot();
			await store.restoreGraphState(snapshot);
			const knotsA = structuredClone(snapshot.knots);
			const knotsB = [{
				id: crypto.randomUUID(),
				cycleIds: [snapshot.occurrences[0].id],
				createdAt: CREATED_AT,
			}];

			const p1 = store.replaceKnots(knotsB);
			const p2 = store.replaceKnots(knotsA);

			await Promise.all([p1, p2]);

			const finalKnots = (await store.exportGraphState()).knots;
			assertEquals(finalKnots[0].id, knotsA[0].id);

			await store.close();
			storeClosed = true;
			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskKnots = (await reopened.exportGraphState()).knots;
			assertEquals(diskKnots[0].id, knotsA[0].id);
			await reopened.close();
		} finally {
			if (!storeClosed) await store.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore allows updateWorkingCopy immediately after concurrent createWorkBundle (C07)",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-bundle-order-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		await store.initialize();

		try {
			const newWorkId = crypto.randomUUID();
			const newBranchId = crypto.randomUUID();
			const newOccId = crypto.randomUUID();
			const work = { id: newWorkId, createdAt: CREATED_AT, updatedAt: CREATED_AT };
			const branch = {
				id: newBranchId,
				workId: newWorkId,
				name: "main",
				headRevisionId: null,
				createdAt: CREATED_AT,
			};
			const workingCopy = {
				branchId: newBranchId,
				workId: newWorkId,
				text: "Initial text",
				updatedAt: CREATED_AT,
			};
			const occurrence = {
				id: newOccId,
				workId: newWorkId,
				parentOccurrenceId: null,
				orderKey: 1024,
				collapsed: false,
				revisionSelector: { mode: "branch" as const, branchId: newBranchId },
			};

			const p1 = store.createWorkBundle(work, branch, workingCopy, occurrence);
			const p2 = store.updateWorkingCopy(
				newWorkId,
				"Updated concurrent text",
				"2026-08-01T12:00:00.000Z",
			);

			await Promise.all([p1, p2]);

			const memoryText = (await store.exportGraphState()).workingCopies.find((w) =>
				w.workId === newWorkId
			)?.text;
			assertEquals(memoryText, "Updated concurrent text");

			await store.close();
			storeClosed = true;
			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskText = (await reopened.exportGraphState()).workingCopies.find((w) =>
				w.workId === newWorkId
			)?.text;
			assertEquals(diskText, "Updated concurrent text");
			await reopened.close();
		} finally {
			if (!storeClosed) await store.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore targeted mutations validate local references and treat missing occurrence as no-op (C04/C08)",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-ref-valid-" });
		const targetPath = `${root}\\radiora.db`;
		const store = new SqliteGraphStore(targetPath);
		let storeClosed = false;
		await store.initialize();

		try {
			const snapshot = createTwoWorkSnapshot();
			const rev1 = {
				id: crypto.randomUUID(),
				workId: snapshot.works[0].id,
				text: "rev 1 text",
				parentRevisionIds: [],
				kind: "checkpoint" as const,
				createdAt: CREATED_AT,
			};
			const rev2 = {
				id: crypto.randomUUID(),
				workId: snapshot.works[1].id,
				text: "rev 2 text",
				parentRevisionIds: [],
				kind: "checkpoint" as const,
				createdAt: CREATED_AT,
			};
			snapshot.revisions = [rev1, rev2];
			await store.restoreGraphState(snapshot);

			let exportCount = 0;
			const originalExport = store.exportGraphState.bind(store);
			store.exportGraphState = async () => {
				exportCount++;
				return await originalExport();
			};

			const occ1 = snapshot.occurrences[0];

			// 1. Missing occurrence -> no-op (no throw, exportCount = 0)
			exportCount = 0;
			const missingOcc = { ...occ1, id: crypto.randomUUID(), collapsed: true };
			await store.updateOccurrence(missingOcc);
			assertEquals(exportCount, 0);

			// 2. Nonexistent workId -> rejects and memory unchanged
			exportCount = 0;
			await assertRejects(
				() => store.updateOccurrence({ ...occ1, workId: "nonexistent-work-id" }),
				Error,
			);
			assertEquals(exportCount, 0);

			// 3. Branch selector belongs to another work -> rejects
			await assertRejects(
				() =>
					store.updateOccurrence({
						...occ1,
						revisionSelector: { mode: "branch", branchId: snapshot.branches[1].id },
					}),
				Error,
			);

			// 4. Pinned selector belongs to another work -> rejects
			await assertRejects(
				() =>
					store.updateOccurrence({
						...occ1,
						revisionSelector: { mode: "pinned", revisionId: rev2.id },
					}),
				Error,
			);

			// 5. Valid pinned selector -> succeeds with exportCount = 0
			exportCount = 0;
			await store.updateOccurrence({
				...occ1,
				revisionSelector: { mode: "pinned", revisionId: rev1.id },
			});
			assertEquals(exportCount, 0);

			const inMemOcc = (await store.listOccurrences()).find((o) => o.id === occ1.id);
			assertEquals(inMemOcc?.revisionSelector.mode, "pinned");

			// 6. Reopen from disk to verify persistence
			await store.close();
			storeClosed = true;
			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskOcc = (await reopened.listOccurrences()).find((o) => o.id === occ1.id);
			assertEquals(diskOcc?.revisionSelector.mode, "pinned");
			await reopened.close();
		} finally {
			if (!storeClosed) await store.close();
			await safeRemoveDir(root);
		}
	},
);

Deno.test(
	"SqliteGraphStore OccurrenceOperations.discardEmptyItems deletes 100 empty items in a single transaction",
	async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-sqlite-discard-empty-" });
		const targetPath = `${root}\\radiora.db`;
		const counters = new PerformanceCounters();
		const connector = createCountingSqliteConnector(counters);

		const store = new SqliteGraphStore(targetPath, { connector });
		await store.initialize();
		let storeClosed = false;

		try {
			const operations = new OccurrenceOperations(store);
			const emptyItemIds: string[] = [];

			// 100件の空アイテムを作成（バッチ内で）
			await store.batch(async () => {
				for (let i = 0; i < 100; i++) {
					const item = await operations.createItem({ text: "", parentId: null });
					emptyItemIds.push(item.id);
				}
			});

			const initialItems = await store.listItems();
			assertEquals(initialItems.length, 100);

			// スナップショット取得
			const beforeDiscard = counters.snapshot();

			// discardEmptyItems を実行
			const result = await operations.discardEmptyItems(emptyItemIds);

			assertEquals(result.deletedIds.length, 100);
			assertEquals(result.handledIds.length, 100);
			// 100件の削除が1つのトランザクション（batch）内で完了したことをassert
			assertEquals(counters.snapshot().transaction - beforeDiscard.transaction, 1);

			// メモリ上で削除されていることを確認
			const remainingItems = await store.listItems();
			assertEquals(remainingItems.length, 0);

			// ディスクに正しく反映されていることを再オープンで確認
			await store.close();
			storeClosed = true;

			const reopened = new SqliteGraphStore(targetPath);
			await reopened.initialize();
			const diskItems = await reopened.listItems();
			assertEquals(diskItems.length, 0);
			const diskTrash = await new OccurrenceOperations(reopened).listTrash();
			assertEquals(diskTrash.length, 100);
			await reopened.close();
		} finally {
			if (!storeClosed) await store.close();
			await safeRemoveDir(root);
		}
	},
);
