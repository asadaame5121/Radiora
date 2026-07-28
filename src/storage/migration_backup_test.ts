import { assertEquals } from "jsr:@std/assert@1";
import {
	prepareStorageMigrationBackup,
	recordStorageVersion,
	restoreStorageMigrationBackup,
} from "./migration_backup.ts";

Deno.test("migration backup is cold-copied once and skipped after version is recorded", async () => {
	const directory = await Deno.makeTempDir();
	const database = `${directory}\\main.db`;
	const backup = `${directory}\\migration-backups\\storage-v0`;
	const marker = `${directory}\\storage-schema-version`;
	try {
		await Deno.mkdir(database);
		await Deno.writeTextFile(`${database}\\CURRENT`, "legacy");

		assertEquals(
			await prepareStorageMigrationBackup(database, backup, marker, 1),
			backup,
		);
		assertEquals(await Deno.readTextFile(`${backup}\\CURRENT`), "legacy");

		await Deno.writeTextFile(`${database}\\CURRENT`, "changed");
		assertEquals(
			await prepareStorageMigrationBackup(database, backup, marker, 1),
			backup,
		);
		assertEquals(await Deno.readTextFile(`${backup}\\CURRENT`), "legacy");

		await recordStorageVersion(marker, 1);
		assertEquals(
			await prepareStorageMigrationBackup(database, backup, marker, 1),
			null,
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("failed migration restores the cold backup and can restart cleanly", async () => {
	const directory = await Deno.makeTempDir();
	const database = `${directory}\\main.db`;
	const backup = `${directory}\\migration-backups\\storage-v0`;
	const marker = `${directory}\\storage-schema-version`;
	try {
		await Deno.mkdir(database);
		await Deno.writeTextFile(`${database}\\CURRENT`, "legacy");
		await Deno.writeTextFile(`${database}\\data.json`, '{"value":"before"}');
		await prepareStorageMigrationBackup(database, backup, marker, 1);

		await Deno.writeTextFile(`${database}\\CURRENT`, "partial-migration");
		await Deno.writeTextFile(`${database}\\data.json`, '{"value":"corrupted"}');
		await Deno.writeTextFile(marker, "1\n");

		const restored = await restoreStorageMigrationBackup(database, backup, marker);
		assertEquals(await Deno.readTextFile(`${database}\\CURRENT`), "legacy");
		assertEquals(await Deno.readTextFile(`${database}\\data.json`), '{"value":"before"}');
		assertEquals(
			await Deno.readTextFile(`${restored.failedDatabasePath}\\CURRENT`),
			"partial-migration",
		);
		assertEquals(await pathExists(marker), false);

		assertEquals(
			await prepareStorageMigrationBackup(database, backup, marker, 1),
			backup,
		);
		await Deno.writeTextFile(`${database}\\CURRENT`, "migration-complete");
		await recordStorageVersion(marker, 1);
		assertEquals(
			await prepareStorageMigrationBackup(database, backup, marker, 1),
			null,
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

async function pathExists(path: string): Promise<boolean> {
	try {
		await Deno.stat(path);
		return true;
	} catch (cause) {
		if (cause instanceof Deno.errors.NotFound) return false;
		throw cause;
	}
}
