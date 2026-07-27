import { assertEquals } from "jsr:@std/assert@1";
import { prepareStorageMigrationBackup, recordStorageVersion } from "./migration_backup.ts";

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
