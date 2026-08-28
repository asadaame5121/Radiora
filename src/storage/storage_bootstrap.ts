import type { GraphStateSnapshot, GraphStore } from "./graph_store.ts";
import { JsonGraphStore } from "./json_store.ts";
import { SqliteGraphStore } from "./sqlite_store.ts";
import { migrateLegacyStorageToTurso } from "./turso_migration.ts";
import { exportLegacySnapshot } from "./legacy_surreal_exporter.ts";

export interface StorageBootstrapLogger {
	info(event: string, fields?: Record<string, unknown>): void;
	error(event: string, cause?: unknown, fields?: Record<string, unknown>): void;
}

export interface StorageBootstrapOptions {
	dataDir: string;
	storageMode?: string;
	logger?: StorageBootstrapLogger;
	exportSnapshot?: (copyPath: string) => Promise<GraphStateSnapshot>;
}

export interface StorageBootstrapSession {
	store: GraphStore;
	storageMode: string;
	stop(): Promise<void>;
}

/**
 * Bootstraps the persistence layer according to storageMode and environment.
 * SQLite is the sole persistent production database backend.
 * One-time migration from legacy SurrealDB is executed automatically when source data exists.
 * Surreal fallback during normal runtime or migration is explicitly rejected.
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
			await Deno.mkdir(tursoDir, { recursive: true });

			const exporter = options.exportSnapshot ??
				((copyPath) =>
					exportLegacySnapshot(copyPath, {
						onLog: (event, fields, cause) => {
							if (cause) logger?.error(event, cause, fields);
							else logger?.info(event, fields);
						},
					}));

			try {
				const migrated = await migrateLegacyStorageToTurso({
					sourcePath,
					sourceVersionMarkerPath: `${surrealDir}\\storage-schema-version`,
					backupRoot: `${tursoDir}\\migration-backups`,
					targetPath,
					markerPath: `${targetPath}.migration.json`,
					exportSnapshot: exporter,
				});
				if (migrated) logger?.info("storage.turso_migration.ready", { ...migrated });
			} catch (cause) {
				logger?.error("storage.turso_migration.failed", cause, { sourcePath });
				throw cause;
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
