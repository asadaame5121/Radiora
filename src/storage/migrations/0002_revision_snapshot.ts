import type { MigrationContext, StorageMigration } from "./mod.ts";

export const revisionSnapshotMigration: StorageMigration = {
	id: "0002_revision_snapshot",
	fromVersion: 1,
	toVersion: 2,
	async up(context) {
		await context.execute(`
			DEFINE TABLE IF NOT EXISTS recovery_snapshot SCHEMAFULL;
			DEFINE FIELD IF NOT EXISTS work ON recovery_snapshot TYPE record<work>;
			DEFINE FIELD IF NOT EXISTS branch ON recovery_snapshot TYPE record<branch>;
			DEFINE FIELD IF NOT EXISTS text ON recovery_snapshot TYPE string;
			DEFINE FIELD IF NOT EXISTS content_hash ON recovery_snapshot TYPE string;
			DEFINE FIELD IF NOT EXISTS created_at ON recovery_snapshot TYPE string;
			DEFINE FIELD IF NOT EXISTS source_revision ON recovery_snapshot TYPE option<record<revision>>;
			DEFINE FIELD IF NOT EXISTS name ON recovery_snapshot TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS protection_reason ON recovery_snapshot TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS protected_at ON recovery_snapshot TYPE option<string>;
			DEFINE FIELD IF NOT EXISTS protection_expires_at ON recovery_snapshot TYPE option<string>;
		`);
	},
	async validate(context) {
		await context.execute(`
			INFO FOR TABLE recovery_snapshot;
			SELECT VALUE count() FROM revision GROUP ALL;
		`);
	},
};
