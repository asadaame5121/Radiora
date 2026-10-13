import type { GraphStore, RelationTypeDefinitionStorePort } from "./graph_store.ts";
import { JsonGraphStore } from "./json_store.ts";
import { SqliteGraphStore } from "./sqlite_store.ts";
import { readMigrationMarker } from "./turso_migration.ts";
import { storagePathExists } from "./migration_backup.ts";

export type BootstrappedGraphStore = GraphStore & RelationTypeDefinitionStorePort;

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
	store: BootstrappedGraphStore;
	storageMode: string;
	stop(): Promise<void>;
}

/**
 * Bootstraps the persistence layer according to storageMode and environment.
 * SQLite is the sole persistent production database backend.
 * When legacy SurrealDB data exists without a complete and matching migration marker,
 * startup is refused non-destructively to require running the standalone migration tool.
 * After migration, SQLite is authoritative. The retained legacy database is an archive,
 * not a live dependency: startup must not read its schema marker, data, or LOCK file.
 */
export async function bootstrapStorage(
	options: StorageBootstrapOptions,
): Promise<StorageBootstrapSession> {
	const dataDir = options.dataDir;
	const rawMode = options.storageMode;
	const storageMode = rawMode ?? "sqlite";
	const logger = options.logger;

	let activeStore: BootstrappedGraphStore | null = null;

	const stop = async (): Promise<void> => {
		const st = activeStore;
		activeStore = null;
		if (st) {
			await st.close().catch((cause) => logger?.error("store.close.failed", cause));
		}
	};

	try {
		let nextStore: BootstrappedGraphStore;

		if (storageMode === "json") {
			nextStore = new JsonGraphStore(`${dataDir}\\radiora-v2.json`);
		} else if (storageMode === "sqlite" || storageMode === "turso") {
			const tursoDir = `${dataDir}\\turso`;
			const targetPath = `${tursoDir}\\radiora.db`;
			const surrealDir = `${dataDir}\\surreal`;
			const sourcePath = `${surrealDir}\\main.db`;

			await Deno.mkdir(tursoDir, { recursive: true });
			await requireCompletedLegacyMigration(sourcePath, targetPath);

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

async function requireCompletedLegacyMigration(
	sourcePath: string,
	targetPath: string,
): Promise<void> {
	if (!(await storagePathExists(sourcePath))) return;
	const marker = await readMigrationMarker(`${targetPath}.migration.json`);
	const targetExists = await storagePathExists(targetPath);
	if (marker && marker.sourcePath === sourcePath && targetExists) return;

	const reason = !targetExists
		? "migrated SQLite database is missing"
		: !marker
		? "migration completion marker is missing"
		: "migration marker sourcePath does not match the legacy source";
	throw new Error(
		`Legacy SurrealDB data detected at ${sourcePath}: ${reason}. ` +
			`For first-time migration, close older versions of Radiora and run 'deno task storage:migrate:legacy'. ` +
			`If SQLite already exists, preserve both databases and restore the matching migration marker or SQLite from backup; do not overwrite existing data.`,
	);
}
