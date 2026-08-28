import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { bootstrapStorage } from "../src/storage/storage_bootstrap.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import { migrateLegacyStorageToTurso } from "../src/storage/turso_migration.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_store.ts";

const CREATED_AT = "2026-08-01T00:00:00.000Z";

function createTestSnapshot(): GraphStateSnapshot {
	const workId = "w-bootstrap-test";
	const branchId = "b-bootstrap-test";
	const occId = "o-bootstrap-test";
	return validatedGraphStateSnapshot({
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [{
			id: branchId,
			workId,
			name: "main",
			headRevisionId: null,
			createdAt: CREATED_AT,
		}],
		workingCopies: [{
			branchId,
			workId,
			text: "Bootstrap storage text",
			updatedAt: CREATED_AT,
		}],
		occurrences: [{
			id: occId,
			workId,
			parentOccurrenceId: null,
			orderKey: 1000,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId },
		}],
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

Deno.test("bootstrapStorage opens SQLite normally when valid legacy migration marker exists, but rejects if source was modified after migration", async () => {
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
		await session.stop();

		// 2. Modify legacy source after migration (simulating external update)
		await Deno.writeTextFile(sourceDbPath, "modified legacy surreal payload");

		// Bootstrap must reject to prevent data loss or silent divergence
		const err = await assertRejects(
			() =>
				bootstrapStorage({
					dataDir: root,
					storageMode: "sqlite",
				}),
			Error,
		);
		assert(err.message.includes("source fingerprint differs from migration marker"));
	} finally {
		await safeRemoveDir(root);
	}
});

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
		await assertRejects(
			() => session.store.restoreGraphState(snapshot),
			Error,
		);

		// Second stop should be safe and idempotent
		await session.stop();
	} finally {
		await safeRemoveDir(root);
	}
});
