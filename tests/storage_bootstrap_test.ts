import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { bootstrapStorage } from "../src/storage/storage_bootstrap.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import {
	migrateLegacyStorageToTurso,
	readMigrationMarker,
} from "../src/storage/turso_migration.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_store.ts";

const CREATED_AT = "2026-08-01T00:00:00.000Z";

function createTestSnapshot(): GraphStateSnapshot {
	const workId = "w-bootstrap-test";
	const branchId = "b-bootstrap-test";
	const occId = "o-bootstrap-test";
	return validatedGraphStateSnapshot({
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [
			{
				id: branchId,
				workId,
				name: "main",
				headRevisionId: null,
				createdAt: CREATED_AT,
			},
		],
		workingCopies: [
			{
				branchId,
				workId,
				text: "Bootstrap storage text",
				updatedAt: CREATED_AT,
			},
		],
		occurrences: [
			{
				id: occId,
				workId,
				parentOccurrenceId: null,
				orderKey: 1000,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId },
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
		bookmarks: [],
		resumePosition: null,
	});
}

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

Deno.test("bootstrapStorage defaults to SQLite when storageMode is omitted or sqlite/turso", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-default-" });
	try {
		// 1. Default (omitted)
		const session1 = await bootstrapStorage({ dataDir: root });
		assertEquals(session1.storageMode, "sqlite");
		assert(session1.store !== null);
		await session1.stop();

		// 2. Explicit "sqlite"
		const session2 = await bootstrapStorage({ dataDir: root, storageMode: "sqlite" });
		assertEquals(session2.storageMode, "sqlite");
		await session2.stop();

		// 3. Alias "turso"
		const session3 = await bootstrapStorage({ dataDir: root, storageMode: "turso" });
		assertEquals(session3.storageMode, "turso");
		await session3.stop();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("bootstrapStorage supports json mode for test and dev", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-json-" });
	try {
		const session = await bootstrapStorage({ dataDir: root, storageMode: "json" });
		assertEquals(session.storageMode, "json");
		const snapshot = createTestSnapshot();
		await session.store.restoreGraphState(snapshot);
		const exported = await session.store.exportGraphState();
		assertEquals(exported.workingCopies[0].text, "Bootstrap storage text");
		await session.stop();

		// Verify json file created on disk
		const jsonStat = await Deno.stat(`${root}\\radiora-v2.json`);
		assert(jsonStat.isFile && jsonStat.size > 0);
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("bootstrapStorage rejects deprecated surreal, surreal-diagnostic, and unknown modes explicitly", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-reject-" });
	try {
		await assertRejects(
			() => bootstrapStorage({ dataDir: root, storageMode: "surreal" }),
			Error,
			"Unknown or deprecated RADIORA_STORAGE mode: surreal",
		);

		await assertRejects(
			() => bootstrapStorage({ dataDir: root, storageMode: "surreal-diagnostic" }),
			Error,
			"Unknown or deprecated RADIORA_STORAGE mode: surreal-diagnostic",
		);

		await assertRejects(
			() => bootstrapStorage({ dataDir: root, storageMode: "in-memory-xyz" }),
			Error,
			"Unknown or deprecated RADIORA_STORAGE mode: in-memory-xyz",
		);
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("bootstrapStorage rejects startup with descriptive error when legacy Surreal data exists without migration, preserving source data", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-unmigrated-" });
	const surrealDir = `${root}\\surreal`;
	const sourceDbPath = `${surrealDir}\\main.db`;
	const sourceVersionPath = `${surrealDir}\\storage-schema-version`;
	await Deno.mkdir(surrealDir, { recursive: true });
	await Deno.writeTextFile(sourceDbPath, "legacy surreal binary payload");
	await Deno.writeTextFile(sourceVersionPath, "6");

	try {
		const err = await assertRejects(
			() =>
				bootstrapStorage({
					dataDir: root,
					storageMode: "sqlite",
				}),
			Error,
		);

		// Must clearly point to the standalone migration task
		assert(err.message.includes("Legacy SurrealDB data detected"));
		assert(err.message.includes("deno task storage:migrate:legacy"));

		// Source data must be untouched
		const sourceContent = await Deno.readTextFile(sourceDbPath);
		assertEquals(sourceContent, "legacy surreal binary payload");

		// Target sqlite DB must not have been created implicitly
		let targetExists = false;
		try {
			await Deno.stat(`${root}\\turso\\radiora.db`);
			targetExists = true;
		} catch {
			targetExists = false;
		}
		assertEquals(targetExists, false);
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("bootstrapStorage keeps migrated SQLite authoritative after legacy source changes", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-migrated-" });
	const surrealDir = `${root}\\surreal`;
	const sourceDbPath = `${surrealDir}\\main.db`;
	const sourceVersionPath = `${surrealDir}\\storage-schema-version`;
	await Deno.mkdir(surrealDir, { recursive: true });
	await Deno.writeTextFile(sourceDbPath, "legacy surreal binary payload");
	await Deno.writeTextFile(sourceVersionPath, "6");

	const tursoDir = `${root}\\turso`;
	const targetPath = `${tursoDir}\\radiora.db`;
	const markerPath = `${targetPath}.migration.json`;
	const backupRoot = `${tursoDir}\\migration-backups`;

	const sampleSnapshot = createTestSnapshot();

	try {
		// Run actual migration helper to create genuine marker & target
		const migrationResult = await migrateLegacyStorageToTurso({
			sourcePath: sourceDbPath,
			sourceVersionMarkerPath: sourceVersionPath,
			backupRoot,
			targetPath,
			markerPath,
			exportSnapshot: async () => sampleSnapshot,
		});
		assert(migrationResult !== null);

		// 1. Normal bootstrap should succeed because marker matches
		const session = await bootstrapStorage({
			dataDir: root,
			storageMode: "sqlite",
		});
		assertEquals(session.storageMode, "sqlite");
		const exported = await session.store.exportGraphState();
		assertEquals(exported.workingCopies[0].text, "Bootstrap storage text");
		const updated = validatedGraphStateSnapshot({
			...exported,
			workingCopies: exported.workingCopies.map((copy) => ({
				...copy,
				text: "New SQLite edits",
			})),
		});
		await session.store.restoreGraphState(updated);
		await session.stop();

		// 2. Modify legacy source after migration (simulating external update)
		await Deno.writeTextFile(sourceDbPath, "modified legacy surreal payload");
		await Deno.writeTextFile(sourceVersionPath, "7");
		const markerBefore = await Deno.readTextFile(markerPath);

		// Migration is an ownership handoff, not continuing synchronization.
		const reopened = await bootstrapStorage({ dataDir: root, storageMode: "sqlite" });
		try {
			assertEquals(await reopened.store.exportGraphState(), updated);
			assertEquals(await Deno.readTextFile(sourceDbPath), "modified legacy surreal payload");
			assertEquals(await Deno.readTextFile(sourceVersionPath), "7");
			assertEquals(await Deno.readTextFile(markerPath), markerBefore);
		} finally {
			await reopened.stop();
		}
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("bootstrapStorage does not read a migrated legacy LOCK file", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-locked-" });
	const surrealDir = `${root}\\surreal`;
	const sourcePath = `${surrealDir}\\main.db`;
	const sourceVersionMarkerPath = `${surrealDir}\\storage-schema-version`;
	const targetPath = `${root}\\turso\\radiora.db`;
	const markerPath = `${targetPath}.migration.json`;
	const lockPath = `${sourcePath}/LOCK`;
	try {
		await Deno.mkdir(sourcePath, { recursive: true });
		await Deno.writeTextFile(lockPath, "");
		await Deno.writeTextFile(sourceVersionMarkerPath, "6");
		await migrateLegacyStorageToTurso({
			sourcePath,
			sourceVersionMarkerPath,
			targetPath,
			markerPath,
			backupRoot: `${root}\\turso\\migration-backups`,
			exportSnapshot: async () => createTestSnapshot(),
		});
		const readFile = Deno.readFile;
		let lockReads = 0;
		Deno.readFile = (path, options) => {
			if (String(path) === lockPath) {
				lockReads++;
				return Promise.reject(new Error(`Sharing violation (os error 32): readfile '${lockPath}'`));
			}
			return readFile(path, options);
		};
		try {
			const session = await bootstrapStorage({ dataDir: root });
			try {
				assertEquals(
					(await session.store.exportGraphState()).workingCopies[0].text,
					"Bootstrap storage text",
				);
				assertEquals(lockReads, 0);
			} finally {
				await session.stop();
			}
		} finally {
			Deno.readFile = readFile;
		}
	} finally {
		await safeRemoveDir(root);
	}
});

for (const failure of [
	"missing target",
	"missing marker",
	"corrupt marker",
	"wrong source",
	"corrupt SQLite",
]) {
	Deno.test(`bootstrapStorage refuses ${failure} without altering retained data`, async () => {
		const root = await Deno.makeTempDir({ prefix: "radiora-boot-invalid-" });
		const sourcePath = `${root}\\surreal\\main.db`;
		const sourceVersionMarkerPath = `${root}\\surreal\\storage-schema-version`;
		const targetPath = `${root}\\turso\\radiora.db`;
		const markerPath = `${targetPath}.migration.json`;
		try {
			await Deno.mkdir(`${root}\\surreal`, { recursive: true });
			await Deno.writeTextFile(sourcePath, "retained legacy data");
			await Deno.writeTextFile(sourceVersionMarkerPath, "6");
			await migrateLegacyStorageToTurso({
				sourcePath,
				sourceVersionMarkerPath,
				targetPath,
				markerPath,
				backupRoot: `${root}\\turso\\migration-backups`,
				exportSnapshot: async () => createTestSnapshot(),
			});
			if (failure === "missing target") await Deno.remove(targetPath);
			if (failure === "missing marker") await Deno.remove(markerPath);
			if (failure === "corrupt marker") await Deno.writeTextFile(markerPath, "{broken");
			if (failure === "wrong source") {
				const marker = await readMigrationMarker(markerPath);
				assert(marker);
				await Deno.writeTextFile(markerPath, JSON.stringify({ ...marker, sourcePath: "other.db" }));
			}
			if (failure === "corrupt SQLite") await Deno.writeTextFile(targetPath, "not a database");
			const targetBefore = failure === "missing target" ? null : await Deno.readFile(targetPath);
			const markerBefore =
				failure === "missing marker" ? null : await Deno.readTextFile(markerPath);

			await assertRejects(() => bootstrapStorage({ dataDir: root }), Error);
			assertEquals(await Deno.readTextFile(sourcePath), "retained legacy data");
			if (targetBefore) {
				assertEquals(await Deno.readFile(targetPath), targetBefore);
			} else {
				await assertRejects(() => Deno.stat(targetPath), Deno.errors.NotFound);
			}
			if (markerBefore !== null) {
				assertEquals(await Deno.readTextFile(markerPath), markerBefore);
			} else {
				await assertRejects(() => Deno.stat(markerPath), Deno.errors.NotFound);
			}
		} finally {
			await safeRemoveDir(root);
		}
	});
}

Deno.test("bootstrapStorage session.stop properly closes active store and is idempotent", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-boot-stop-" });
	try {
		const session = await bootstrapStorage({
			dataDir: root,
			storageMode: "sqlite",
		});

		const snapshot = createTestSnapshot();
		await session.store.restoreGraphState(snapshot);

		// First stop closes the store cleanly
		await session.stop();

		// Subsequent mutation on closed store must reject
		await assertRejects(() => session.store.restoreGraphState(snapshot), Error);

		// Second stop should be safe and idempotent
		await session.stop();
	} finally {
		await safeRemoveDir(root);
	}
});
