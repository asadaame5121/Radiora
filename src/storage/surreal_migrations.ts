import { RecordId, Surreal } from "surrealdb";
import {
	CURRENT_STORAGE_SCHEMA_VERSION,
	type MigrationJournalEntry,
	runStorageMigrations,
	type SchemaMetadata,
	type StorageMigration,
} from "./migrations/mod.ts";
import { workOccurrenceMigration } from "./migrations/0001_work_occurrence.ts";
import { revisionSnapshotMigration } from "./migrations/0002_revision_snapshot.ts";
import { bookmarkResumeMigration } from "./migrations/0003_bookmark_resume.ts";
import { stubStateMigration } from "./migrations/0004_stub_state.ts";
import { mergeProvenanceMigration } from "./migrations/0005_merge_provenance.ts";
import { emergenceSuggestionMigration } from "./migrations/0006_emergence_suggestion.ts";
import type { SurrealRow as Row } from "./surreal_row_mapper.ts";

const APP_VERSION = "0.1.0";

const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
	workOccurrenceMigration,
	revisionSnapshotMigration,
	bookmarkResumeMigration,
	stubStateMigration,
	mergeProvenanceMigration,
	emergenceSuggestionMigration,
];

export async function runSurrealStorageMigrations(db: Surreal): Promise<void> {
	await runStorageMigrations({
		appVersion: APP_VERSION,
		targetVersion: CURRENT_STORAGE_SCHEMA_VERSION,
		migrations: STORAGE_MIGRATIONS,
		context: {
			execute: (statement, variables) => db.query(statement, variables),
		},
		state: {
			readMetadata: async () => {
				const [rows] = await db.query<[Row[]]>(
					`SELECT version, updated_at, last_migration_id, app_version
						FROM schema_metadata:radiora;`,
				);
				const row = rows[0];
				if (!row) return null;
				return {
					id: "radiora",
					version: Number(row.version),
					updatedAt: String(row.updated_at ?? ""),
					lastMigrationId: String(row.last_migration_id ?? ""),
					appVersion: String(row.app_version ?? ""),
				} satisfies SchemaMetadata;
			},
			writeMetadata: (metadata) =>
				db.query(
					`UPSERT schema_metadata:radiora CONTENT {
						version: $version,
						updated_at: $updatedAt,
						last_migration_id: $lastMigrationId,
						app_version: $appVersion
					};`,
					{ ...metadata },
				).then(() => undefined),
			writeJournal: (entry) => writeMigrationJournal(db, entry),
		},
	});
}

async function writeMigrationJournal(
	db: Surreal,
	entry: MigrationJournalEntry,
): Promise<void> {
	const completedAt = entry.completedAt ? "$completedAt" : "NONE";
	const error = entry.error ? "$error" : "NONE";
	await db.query(
		`UPSERT $record CONTENT {
			from_version: $fromVersion,
			to_version: $toVersion,
			started_at: $startedAt,
			completed_at: ${completedAt},
			app_version: $appVersion,
			status: $status,
			error: ${error}
		};`,
		{
			...entry,
			record: new RecordId("migration_journal", entry.id),
		},
	);
}
