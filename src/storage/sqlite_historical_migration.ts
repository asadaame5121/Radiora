import { APP_VERSION } from "../shared/app_version.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import type { SqliteDatabase } from "./sqlite_records.ts";

/** Protect the pre-migration state before advancing the payload schema. */
export async function migrateSqliteHistoricalTime(
	db: SqliteDatabase,
	path: string,
	state: GraphStateSnapshot,
): Promise<void> {
	const startedAt = new Date().toISOString();
	if (path !== ":memory:") {
		const backup = {
			format: "radiora-backup",
			schemaVersion: 7,
			exportedAt: startedAt,
			appVersion: APP_VERSION,
			source: { storageSchemaVersion: 1 },
			data: state,
		};
		try {
			await Deno.writeTextFile(`${path}.before-v2.json`, JSON.stringify(backup, null, 2), {
				createNew: true,
			});
		} catch (cause) {
			if (!(cause instanceof Deno.errors.AlreadyExists)) throw cause;
		}
	}
	db.transaction((txn) => {
		txn.run(
			"UPDATE storage_metadata SET schema_version = 2, updated_at = ? WHERE id = 'radiora'",
			startedAt,
		);
		txn.run(
			"INSERT OR REPLACE INTO migration_journal (id, from_version, to_version, started_at, completed_at, status) VALUES ('0002_historical_time', 1, 2, ?, ?, 'completed')",
			startedAt,
			new Date().toISOString(),
		);
	});
}
