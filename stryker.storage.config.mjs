import { denoMutationBatch } from "./scripts/quality/stryker_deno_config.mjs";

export default denoMutationBatch(
	"storage",
	[
		"src/storage/backup_migrations.ts",
		"src/storage/surreal_backup_restore.ts",
		"src/storage/surreal_row_mapper.ts",
		"src/storage/migrations/*.ts",
		"!src/storage/migrations/*_test.ts",
	],
	[
		"src/storage/migrations/mod_test.ts",
		"src/storage/surreal_backup_restore_test.ts",
		"src/storage/surreal_row_mapper_test.ts",
	],
);
