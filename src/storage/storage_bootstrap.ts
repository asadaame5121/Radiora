import type { GraphStore } from "./graph_store.ts";
import { JsonGraphStore } from "./json_store.ts";
import { SqliteGraphStore } from "./sqlite_store.ts";
import { isLegacyStorageMigrationComplete } from "./turso_migration.ts";
import { storagePathExists } from "./migration_backup.ts";

export interface StorageBootstrapLogger {
	info(event: string, fields?: Record<string, unknown>): void;
	error(event: string, cause?: unknown, fields?: Record<string, unknown>): void;
}

export interface StorageBootstrapOptions {
	dataDir: string;
	storageMode?: string;
	logger?: StorageBootstrapLogger;
}

export interface StorageBootstrapSession {
	store: GraphStore;
	storageMode: string;
	stop(): Promise<void>;
}

/**
 * Bootstraps the persistence layer according to storageMode and environment.
 * SQLite is the sole persistent production database backend.
 * When legacy SurrealDB data exists without a complete and matching migration marker,
 * startup is refused non-destructively to require running the standalone migration tool.
 */
export async function bootstrapStorage(
	options: StorageBootstrapOptions,
): Promise<StorageBootstrapSession> {
	const dataDir = options.dataDir;
	const rawMode = options.storageMode;
	const storageMode = rawMode ?? "sqlite";
	const logger = options.logger;

	let activeStore: GraphStore | null = null;

	const stop = async (): Promise<void> => {
		const st = activeStore;
		activeStore = null;
		if (st) {
			await st.close().catch((cause) => logger?.error("store.close.failed", cause));
		}
	};

	try {
		let nextStore: GraphStore;

		if (storageMode === "json") {
			nextStore = new JsonGraphStore(`${dataDir}\\radiora-v2.json`);
		} else if (storageMode === "sqlite" || storageMode === "turso") {
			const tursoDir = `${dataDir}\\turso`;
			const targetPath = `${tursoDir}\\radiora.db`;
			const surrealDir = `${dataDir}\\surreal`;
			const sourcePath = `${surrealDir}\\main.db`;
			const sourceVersionMarkerPath = `${surrealDir}\\storage-schema-version`;
			const markerPath = `${targetPath}.migration.json`;

			await Deno.mkdir(tursoDir, { recursive: true });

			if (await storagePathExists(sourcePath)) {
				const status = await isLegacyStorageMigrationComplete({
					sourcePath,
					sourceVersionMarkerPath,
					targetPath,
					markerPath,
				});

				if (!status.complete) {
					throw new Error(
						`Legacy SurrealDB data detected at ${sourcePath}, but has not been cleanly migrated to SQLite yet (${
							status.reason ?? "migration missing"
						}). ` +
							`Please run 'deno task storage:migrate:legacy' to migrate your data before starting Radiora.`,
					);
				}
			}

			nextStore = new SqliteGraphStore(targetPath);
		} else {
			throw new Error(`Unknown or deprecated RADIORA_STORAGE mode: ${storageMode}`);
		}

		activeStore = nextStore;
		await nextStore.initialize();
		return {
			store: nextStore,
			storageMode,
			stop,
		};
	} catch (cause) {
		await stop();
		throw cause;
	}
}
