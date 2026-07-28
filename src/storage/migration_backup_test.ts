import { assertEquals } from "jsr:@std/assert@1";
import {
	prepareStorageMigrationBackup,
	recordStorageVersion,
	restoreStorageMigrationBackup,
} from "./migration_backup.ts";

Deno.test("migration backups are isolated and reused by recorded source version", async () => {
	const directory = await Deno.makeTempDir();
	const database = `${directory}\\main.db`;
	const backupRoot = `${directory}\\migration-backups`;
	const backupV0 = `${backupRoot}\\storage-v0`;
	const backupV1 = `${backupRoot}\\storage-v1`;
	const marker = `${directory}\\storage-schema-version`;
	try {
		await Deno.mkdir(database);
		await Deno.writeTextFile(`${database}\\CURRENT`, "legacy");

		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 1),
			backupV0,
		);
		assertEquals(await Deno.readTextFile(`${backupV0}\\CURRENT`), "legacy");

		await Deno.writeTextFile(`${database}\\CURRENT`, "must not replace v0");
		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 1),
			backupV0,
		);
		assertEquals(await Deno.readTextFile(`${backupV0}\\CURRENT`), "legacy");

		await recordStorageVersion(marker, 1);
		await Deno.writeTextFile(`${database}\\CURRENT`, "version-one");
		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 2),
			backupV1,
		);
		assertEquals(await Deno.readTextFile(`${backupV1}\\CURRENT`), "version-one");
		assertEquals(await Deno.readTextFile(`${backupV0}\\CURRENT`), "legacy");

		await Deno.writeTextFile(`${database}\\CURRENT`, "must not replace v1");
		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 2),
			backupV1,
		);
		assertEquals(await Deno.readTextFile(`${backupV1}\\CURRENT`), "version-one");

		await recordStorageVersion(marker, 2);
		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 2),
			null,
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("failed migration restores the cold backup and can restart cleanly", async () => {
	const directory = await Deno.makeTempDir();
	const database = `${directory}\\main.db`;
	const backupRoot = `${directory}\\migration-backups`;
	const backup = `${backupRoot}\\storage-v0`;
	const marker = `${directory}\\storage-schema-version`;
	try {
		await Deno.mkdir(database);
		await Deno.writeTextFile(`${database}\\CURRENT`, "legacy");
		await Deno.writeTextFile(`${database}\\data.json`, '{"value":"before"}');
		await prepareStorageMigrationBackup(database, backupRoot, marker, 1);

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
			await prepareStorageMigrationBackup(database, backupRoot, marker, 1),
			backup,
		);
		await Deno.writeTextFile(`${database}\\CURRENT`, "migration-complete");
		await recordStorageVersion(marker, 1);
		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 1),
			null,
		);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("failed version 1 to 2 migration restores its exact v1 backup and marker", async () => {
	const directory = await Deno.makeTempDir();
	const database = `${directory}\\main.db`;
	const backupRoot = `${directory}\\migration-backups`;
	const backupV1 = `${backupRoot}\\storage-v1`;
	const marker = `${directory}\\storage-schema-version`;
	try {
		await Deno.mkdir(database);
		await Deno.writeTextFile(`${database}\\CURRENT`, "version-one");
		await recordStorageVersion(marker, 1);
		const prepared = await prepareStorageMigrationBackup(database, backupRoot, marker, 2);
		assertEquals(prepared, backupV1);

		await Deno.writeTextFile(`${database}\\CURRENT`, "partial-version-two");
		await recordStorageVersion(marker, 2);
		await restoreStorageMigrationBackup(database, prepared!, marker);
		assertEquals(await Deno.readTextFile(`${database}\\CURRENT`), "version-one");
		assertEquals(await Deno.readTextFile(marker), "1\n");

		assertEquals(
			await prepareStorageMigrationBackup(database, backupRoot, marker, 2),
			backupV1,
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
