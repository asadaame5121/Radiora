import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"storage",
	[
		"src/storage/backup_migrations.ts",
		"src/storage/legacy_surreal_migration_reader.ts",
	],
	[
		"tests/legacy_surreal_migration_reader_test.ts",
	],
);
