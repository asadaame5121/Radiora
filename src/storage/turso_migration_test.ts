import { assert, assertEquals } from "jsr:@std/assert@1";
import type { GraphStateSnapshot } from "./graph_store.ts";
import {
	graphStateHash,
	importGraphStateToTurso,
	migrateLegacyStorageToTurso,
} from "./turso_migration.ts";
import { TursoGraphStore } from "./turso_store.ts";

const CREATED_AT = "2026-07-28T00:00:00.000Z";

function snapshot(): GraphStateSnapshot {
	const workId = crypto.randomUUID();
	const branchId = crypto.randomUUID();
	return {
		works: [{ id: workId, createdAt: CREATED_AT, updatedAt: CREATED_AT }],
		branches: [{ id: branchId, workId, name: "main", headRevisionId: null, createdAt: CREATED_AT }],
		workingCopies: [{ branchId, workId, text: "本文", updatedAt: CREATED_AT }],
		occurrences: [{
			id: crypto.randomUUID(),
			workId,
			parentOccurrenceId: null,
			orderKey: 1024,
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
	};
}

Deno.test("imports a validated snapshot into a new Turso database atomically", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-import-" });
	const target = `${root}\\radiora.db`;
	const state = snapshot();
	try {
		const result = await importGraphStateToTurso(state, target);
		assertEquals(result.snapshotHash, await graphStateHash(state));
		const reopened = new TursoGraphStore(target);
		await reopened.initialize();
		assertEquals(await graphStateHash(await reopened.exportGraphState()), result.snapshotHash);
		await reopened.close();
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("copies legacy storage and leaves the source unchanged", async () => {
	const root = await Deno.makeTempDir({ prefix: "radiora-turso-migration-" });
	const source = `${root}\\surreal`;
	const sourceVersion = `${source}\\storage-schema-version`;
	const backupRoot = `${root}\\backups`;
	const target = `${root}\\turso\\radiora.db`;
	const marker = `${target}.migration.json`;
	const state = snapshot();
	let exportCount = 0;
	await Deno.mkdir(source, { recursive: true });
	await Deno.writeTextFile(`${source}\\CURRENT`, "unchanged");
	await Deno.writeTextFile(sourceVersion, "6\n");
	try {
		const result = await migrateLegacyStorageToTurso({
			sourcePath: source,
			sourceVersionMarkerPath: sourceVersion,
			backupRoot,
			targetPath: target,
			markerPath: marker,
			exportSnapshot: async (copyPath) => {
				exportCount += 1;
				assert(await Deno.stat(`${copyPath}\\CURRENT`));
				return state;
			},
		});
		assert(result);
		assertEquals(await Deno.readTextFile(`${source}\\CURRENT`), "unchanged");
		assertEquals(JSON.parse(await Deno.readTextFile(marker)).snapshotHash, result.snapshotHash);
		assert((await Array.fromAsync(Deno.readDir(backupRoot))).length === 1);
		assertEquals(
			await migrateLegacyStorageToTurso({
				sourcePath: source,
				sourceVersionMarkerPath: sourceVersion,
				backupRoot,
				targetPath: target,
				markerPath: marker,
				exportSnapshot: async () => {
					exportCount += 1;
					return state;
				},
			}),
			null,
		);
		assertEquals(exportCount, 1);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});
