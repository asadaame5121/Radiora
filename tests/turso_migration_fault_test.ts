import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { GraphStateSnapshot } from "../src/storage/graph_store.ts";
import {
	graphStateHash,
	importGraphStateToTurso,
	migrateLegacyStorageToTurso,
} from "../src/storage/turso_migration.ts";
import { TursoGraphStore } from "../src/storage/turso_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";

function createComplexSnapshot(): GraphStateSnapshot {
	const workId1 = crypto.randomUUID();
	const workId2 = crypto.randomUUID();
	const branchId1 = crypto.randomUUID();
	const branchId2 = crypto.randomUUID();
	const occId1 = crypto.randomUUID();
	const occId2 = crypto.randomUUID();
	const linkId = crypto.randomUUID();
	const knotId = crypto.randomUUID();

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
			{
				branchId: branchId1,
				workId: workId1,
				text: "親ノードの日本語テキスト。\n[[別ノード]] への参照と radiora://work/" + workId2,
				updatedAt: CREATED_AT,
			},
			{
				branchId: branchId2,
				workId: workId2,
				text: "子ノードの本文内容",
				updatedAt: CREATED_AT,
			},
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
				parentOccurrenceId: occId1,
				orderKey: 2048,
				collapsed: false,
				revisionSelector: { mode: "branch", branchId: branchId2 },
			},
		],
		links: [
			{
				id: linkId,
				fromId: workId1,
				toId: workId2,
				from: { scope: "work", workId: workId1 },
				to: { scope: "work", workId: workId2 },
				type: "RELATED",
				status: "asserted",
				origin: "human",
				createdAt: CREATED_AT,
			},
		],
		systemRelations: [],
		knots: [
			{
				id: knotId,
				cycleIds: [occId1, occId2],
				createdAt: CREATED_AT,
			},
		],
		aliases: [
			{
				id: crypto.randomUUID(),
				canonical: "別名エイリアス",
				variants: ["エイリアス1", "エイリアス2"],
				createdAt: CREATED_AT,
				updatedAt: CREATED_AT,
			},
		],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [
			{
				id: crypto.randomUUID(),
				workId: workId1,
				occurrenceId: occId1,
				createdAt: CREATED_AT,
			},
		],
		resumePosition: {
			workId: workId1,
			occurrenceId: occId1,
			caretOffset: 12,
			updatedAt: CREATED_AT,
		},
	};
}

Deno.test("migration cleans up temporary copy when exportSnapshot throws an error", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-fault-export-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;

	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "legacy-data");
	await Deno.writeTextFile(sourceVersion, "6\n");

	try {
		await assertRejects(
			async () => {
				await migrateLegacyStorageToTurso({
					sourcePath: source,
					sourceVersionMarkerPath: sourceVersion,
					backupRoot,
					targetPath: target,
					markerPath: marker,
					exportSnapshot: async (_copyPath) => {
						throw new Error("Simulated SurrealDB export corruption / failure");
					},
				});
			},
			Error,
			"Simulated SurrealDB export corruption / failure",
		);

		// Source database remains intact
		assertEquals(await Deno.readTextFile(`${source}\\CURRENT`), "legacy-data");

		// Cold backup was created before copy attempt
		const backupEntries = await Array.fromAsync(Deno.readDir(backupRoot));
		assertEquals(backupEntries.length, 1);

		// Target DB and marker were never created
		let targetExists = false;
		try {
			await Deno.stat(target);
			targetExists = true;
		} catch {
			targetExists = false;
		}
		assertEquals(targetExists, false);

		// Temporary migration copies are cleaned up
		const rootEntries = await Array.fromAsync(Deno.readDir(root));
		const tempCopies = rootEntries.filter((e) => e.name.includes(".turso-migration-"));
		assertEquals(tempCopies.length, 0);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("migration cleans up temporary migrating DB when target validation fails", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-fault-validation-" });
	const target = `${root}\\radiora.db`;
	const invalidSnapshot = createComplexSnapshot();
	// Inject invalid occurrence work reference
	invalidSnapshot.occurrences[0].workId = crypto.randomUUID();

	try {
		await assertRejects(
			async () => {
				await importGraphStateToTurso(invalidSnapshot, target);
			},
		);

		// Target database must not exist
		let targetExists = false;
		try {
			await Deno.stat(target);
			targetExists = true;
		} catch {
			targetExists = false;
		}
		assertEquals(targetExists, false);

		// No .migrating temporary files remain
		const rootEntries = await Array.fromAsync(Deno.readDir(root));
		const tempDbs = rootEntries.filter((e) => e.name.includes(".migrating-"));
		assertEquals(tempDbs.length, 0);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("migration rejects when target exists without a valid marker and does not overwrite target", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-fault-existing-target-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;

	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "legacy-data");
	await Deno.writeTextFile(sourceVersion, "6\n");

	// Pre-create an unmanaged target database
	await Deno.mkdir(`${root}\\turso`, { recursive: true });
	await Deno.writeTextFile(target, "pre-existing-content");

	try {
		await assertRejects(
			async () => {
				await migrateLegacyStorageToTurso({
					sourcePath: source,
					sourceVersionMarkerPath: sourceVersion,
					backupRoot,
					targetPath: target,
					markerPath: marker,
					exportSnapshot: async () => createComplexSnapshot(),
				});
			},
			Error,
			"Turso migration target exists without a valid completion marker",
		);

		// Existing target was not overwritten
		assertEquals(await Deno.readTextFile(target), "pre-existing-content");
		// Source remained unchanged
		assertEquals(await Deno.readTextFile(`${source}\\CURRENT`), "legacy-data");
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("complex snapshot with Japanese text, markdown, knots, and bookmarks round-trips perfectly through Turso migration", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-complex-roundtrip-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;
	const originalState = createComplexSnapshot();

	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "surreal-db-v6");
	await Deno.writeTextFile(sourceVersion, "6\n");

	try {
		const result = await migrateLegacyStorageToTurso({
			sourcePath: source,
			sourceVersionMarkerPath: sourceVersion,
			backupRoot,
			targetPath: target,
			markerPath: marker,
			exportSnapshot: async () => originalState,
		});

		assert(result);
		const originalHash = await graphStateHash(originalState);
		assertEquals(result.snapshotHash, originalHash);

		// Verify reopened store matches snapshot
		const reopened = new TursoGraphStore(target);
		await reopened.initialize();
		const exported = await reopened.exportGraphState();
		const exportedHash = await graphStateHash(exported);
		assertEquals(exportedHash, originalHash);
		assertEquals(exported.workingCopies[0].text, originalState.workingCopies[0].text);
		assertEquals(exported.knots.length, 1);
		assertEquals(exported.knots[0].cycleIds.length, 2);
		assertEquals(exported.bookmarks.length, 1);
		assertEquals(exported.resumePosition?.workId, originalState.resumePosition?.workId);
		assertEquals(exported.resumePosition?.caretOffset, 12);
		await reopened.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("migration tolerates pre-existing orphaned temporary directories from prior crashes", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-prior-crash-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;
	const originalState = createComplexSnapshot();

	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "surreal-db-v6");
	await Deno.writeTextFile(sourceVersion, "6\n");

	// Pre-create orphaned temporary files simulating a hard kill of previous attempts
	await Deno.mkdir(`${source}.turso-migration-orphaned-copy`, { recursive: true });
	await Deno.writeTextFile(`${source}.turso-migration-orphaned-copy\\stale.txt`, "stale");
	await Deno.mkdir(`${root}\\turso`, { recursive: true });
	await Deno.writeTextFile(`${target}.migrating-orphaned-db`, "stale-db");

	try {
		const result = await migrateLegacyStorageToTurso({
			sourcePath: source,
			sourceVersionMarkerPath: sourceVersion,
			backupRoot,
			targetPath: target,
			markerPath: marker,
			exportSnapshot: async () => originalState,
		});

		assert(result);
		assertEquals(result.snapshotHash, await graphStateHash(originalState));

		// Verify target database is usable and matches
		const reopened = new TursoGraphStore(target);
		await reopened.initialize();
		assertEquals(await graphStateHash(await reopened.exportGraphState()), result.snapshotHash);
		await reopened.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("migration rejects corrupted migration marker files", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-corrupted-marker-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;

	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "legacy-data");
	await Deno.writeTextFile(sourceVersion, "6\n");

	// Create target db and a corrupted (non-JSON) marker
	await Deno.mkdir(`${root}\\turso`, { recursive: true });
	await Deno.writeTextFile(target, "some-db-content");
	await Deno.writeTextFile(marker, "{ invalid json content");

	try {
		await assertRejects(
			async () => {
				await migrateLegacyStorageToTurso({
					sourcePath: source,
					sourceVersionMarkerPath: sourceVersion,
					backupRoot,
					targetPath: target,
					markerPath: marker,
					exportSnapshot: async () => createComplexSnapshot(),
				});
			},
			Error,
			"Invalid Turso migration marker",
		);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});
