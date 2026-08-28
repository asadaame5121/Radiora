import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { parseCliArgs, runStandaloneMigration } from "../scripts/migrate_legacy_surreal.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import { validatedGraphStateSnapshot } from "../src/storage/graph_store.ts";

const CREATED_AT = "2026-08-01T00:00:00.000Z";

function createTestSnapshot(): GraphStateSnapshot {
	const workId = "w-cli-test";
	const branchId = "b-cli-test";
	const occId = "o-cli-test";
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
			text: "CLI migration text",
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

Deno.test("parseCliArgs validates trust boundary: accepts default and --data-dir, rejects invalid args", () => {
	// 1. Default (empty args)
	assertEquals(parseCliArgs([]), { dataDir: undefined });

	// 2. Valid --data-dir
	assertEquals(parseCliArgs(["--data-dir", "C:\\Custom\\Data"]), {
		dataDir: "C:\\Custom\\Data",
	});

	// 3. Missing value for --data-dir
	assertThrows(
		() => parseCliArgs(["--data-dir"]),
		Error,
		"Missing value for --data-dir option.",
	);

	// 4. Empty value for --data-dir
	assertThrows(
		() => parseCliArgs(["--data-dir", "   "]),
		Error,
		"Value for --data-dir cannot be empty.",
	);

	// 5. Unknown option
	assertThrows(
		() => parseCliArgs(["--source", "C:\\foo"]),
		Error,
		"Unknown option or positional argument: '--source'",
	);

	// 6. Positional argument
	assertThrows(
		() => parseCliArgs(["extra-arg"]),
		Error,
		"Unknown option or positional argument: 'extra-arg'",
	);
});

Deno.test("standalone legacy migration successfully migrates source to target and creates marker", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-cli-mig-" });
	const surrealDir = `${root}\\surreal`;
	const sourceDbPath = `${surrealDir}\\main.db`;
	const sourceVersionPath = `${surrealDir}\\storage-schema-version`;
	await Deno.mkdir(surrealDir, { recursive: true });
	await Deno.writeTextFile(sourceDbPath, "legacy surreal binary payload for cli test");
	await Deno.writeTextFile(sourceVersionPath, "6");

	const sampleSnapshot = createTestSnapshot();

	try {
		const result = await runStandaloneMigration({
			dataDir: root,
			exportSnapshot: async () => sampleSnapshot,
		});

		assert(result !== null);
		assert(result.backupPath.length > 0);

		// Verify target SQLite database has the migrated data
		const store = new SqliteGraphStore(`${root}\\turso\\radiora.db`);
		await store.initialize();
		const exported = await store.exportGraphState();
		assertEquals(exported.workingCopies[0].text, "CLI migration text");
		await store.close();

		// Verify marker file exists
		const markerStat = await Deno.stat(`${root}\\turso\\radiora.db.migration.json`);
		assert(markerStat.isFile);

		// Second run should skip cleanly (idempotent)
		const secondResult = await runStandaloneMigration({
			dataDir: root,
			exportSnapshot: async () => {
				throw new Error("Should not be called when already migrated");
			},
		});
		assertEquals(secondResult, null);
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("standalone legacy migration rejects re-migration when source was modified after migration, preserving existing target", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-cli-mod-" });
	const surrealDir = `${root}\\surreal`;
	const sourceDbPath = `${surrealDir}\\main.db`;
	const sourceVersionPath = `${surrealDir}\\storage-schema-version`;
	await Deno.mkdir(surrealDir, { recursive: true });
	await Deno.writeTextFile(sourceDbPath, "original surreal payload");
	await Deno.writeTextFile(sourceVersionPath, "6");

	const sampleSnapshot = createTestSnapshot();

	try {
		// 1. Initial successful migration
		const result = await runStandaloneMigration({
			dataDir: root,
			exportSnapshot: async () => sampleSnapshot,
		});
		assert(result !== null);

		// 2. Modify source data externally
		await Deno.writeTextFile(sourceDbPath, "updated surreal payload after migration");

		// 3. Re-running migration must fail because target exists but source fingerprint is mismatched
		const err = await assertRejects(
			() =>
				runStandaloneMigration({
					dataDir: root,
					exportSnapshot: async () => {
						throw new Error("Should not execute export when target exists");
					},
				}),
			Error,
		);
		assert(err.message.includes("source was modified after migration"));

		// Existing target SQLite data must still be intact
		const store = new SqliteGraphStore(`${root}\\turso\\radiora.db`);
		await store.initialize();
		const exported = await store.exportGraphState();
		assertEquals(exported.workingCopies[0].text, "CLI migration text");
		await store.close();
	} finally {
		await safeRemoveDir(root);
	}
});

Deno.test("standalone legacy migration preserves source data when export fails", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-cli-fail-" });
	const surrealDir = `${root}\\surreal`;
	const sourceDbPath = `${surrealDir}\\main.db`;
	const sourceVersionPath = `${surrealDir}\\storage-schema-version`;
	await Deno.mkdir(surrealDir, { recursive: true });
	await Deno.writeTextFile(sourceDbPath, "untouched surreal payload");
	await Deno.writeTextFile(sourceVersionPath, "6");

	try {
		await assertRejects(
			() =>
				runStandaloneMigration({
					dataDir: root,
					exportSnapshot: async () => {
						throw new Error("Simulated exporter failure");
					},
				}),
			Error,
			"Simulated exporter failure",
		);

		// Source data must be untouched
		const sourceContent = await Deno.readTextFile(sourceDbPath);
		assertEquals(sourceContent, "untouched surreal payload");

		// Target sqlite DB must not exist
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
