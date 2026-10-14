import type { Knot, Occurrence, ResumePosition } from "../domain/models.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import { SqliteMutationGraphStore } from "./sqlite_mutation_graph_store.ts";
import { migrateSqliteHistoricalTime } from "./sqlite_historical_migration.ts";
import { SQLITE_SCHEMA_SQL, SQLITE_STORAGE_SCHEMA_VERSION } from "./sqlite_schema.ts";
import {
	isRecord,
	NodeSqliteDatabaseAdapter,
	persistSqliteDiff,
	readSqliteState,
	type SqliteDatabase,
	type SqliteDatabaseTransaction,
} from "./sqlite_records.ts";

export type { SqliteDatabase, SqliteDatabaseTransaction };

export type SqliteDatabaseConnector = (path: string) => Promise<SqliteDatabase> | SqliteDatabase;

export interface SqliteGraphStoreOptions {
	connector?: SqliteDatabaseConnector;
}

function defaultSqliteConnector(path: string): Promise<SqliteDatabase> {
	return NodeSqliteDatabaseAdapter.open(path);
}

/**
 * Durable SQLite implementation of the GraphStore contract backed by Deno's built-in node:sqlite.
 * Serializes concurrent async mutations via an in-memory queue to guarantee transaction isolation.
 */
export class SqliteGraphStore extends SqliteMutationGraphStore {
	private db: SqliteDatabase | null = null;
	private initialized = false;
	private readonly connector: SqliteDatabaseConnector;
	private mutationQueue: Promise<void> = Promise.resolve();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly path: string,
		options: SqliteGraphStoreOptions = {},
	) {
		super();
		this.connector = options.connector ?? defaultSqliteConnector;
	}

	override async initialize(): Promise<void> {
		if (this.initialized) return;
		const db = await this.connector(this.path);
		try {
			db.exec(SQLITE_SCHEMA_SQL);
			const metadata = db.get(
				"SELECT schema_version FROM storage_metadata WHERE id = ?",
				"radiora",
			);
			if (metadata !== undefined && !isRecord(metadata)) {
				throw new Error("SQLite storage metadata row is invalid");
			}
			if (
				metadata !== undefined && metadata.schema_version !== 1 &&
				metadata.schema_version !== SQLITE_STORAGE_SCHEMA_VERSION
			) {
				throw new Error(`Unsupported SQLite storage schema: ${String(metadata.schema_version)}`);
			}
			this.db = db;
			this.initialized = true;
			const state = this.readState();
			if (metadata !== undefined) {
				await this.restoreMemoryGraphState(state);
				if (metadata.schema_version === 1) await migrateSqliteHistoricalTime(db, this.path, state);
				persistSqliteDiff(
					{ ...state, relationTypeDefinitions: [] },
					await super.exportGraphState(),
					db,
				);
			} else {
				persistSqliteDiff(null, await super.exportGraphState(), db);
			}
		} catch (cause) {
			this.db = null;
			this.initialized = false;
			let closeCause: unknown;
			try {
				db.close();
			} catch (error) {
				closeCause = error;
			}
			if (closeCause !== undefined) {
				throw new Error(
					`SQLite database initialization cleanup failed: ${String(closeCause)}`,
					{ cause },
				);
			}
			throw cause;
		}
	}

	override close(): Promise<void> {
		this.closePromise ??= this.closeDatabase();
		return this.closePromise;
	}

	private async closeDatabase(): Promise<void> {
		// biome-ignore lint/plugin/noSwallowedRejection: Close must proceed even if a prior mutation in queue failed.
		await this.mutationQueue.catch(() => {
			// Prior mutation error is already returned to its caller.
		});
		const db = this.db;
		this.db = null;
		this.initialized = false;
		if (!db) return;
		try {
			db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			db.exec("PRAGMA journal_mode = DELETE");
		} finally {
			db.close();
		}
	}

	override setResumePosition(position: ResumePosition): Promise<void> {
		return this.mutate(() => super.setResumePosition(position));
	}

	override clearResumePosition(): Promise<void> {
		return this.mutate(() => super.clearResumePosition());
	}

	override updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		return this.mutate(() => super.updateBranchWorkingCopy(branchId, text, updatedAt));
	}

	override updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		return this.mutate(() => {
			const main = this.state.branches.find((branch) =>
				branch.workId === workId && branch.name === "main"
			);
			if (!main) return Promise.reject(new Error(`Main Branch not found for Work: ${workId}`));
			return super.updateBranchWorkingCopy(main.id, text, updatedAt);
		});
	}

	override applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		return this.mutate(() => {
			const snapshot = this.state.recoverySnapshots.find((candidate) =>
				candidate.id === snapshotId
			);
			if (!snapshot) {
				return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
			}
			return super.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
		});
	}

	override updateOccurrence(occurrence: Occurrence): Promise<void> {
		return this.mutate(() => super.updateOccurrence(occurrence));
	}

	override replaceKnots(knots: Knot[]): Promise<void> {
		return this.mutate(() => super.replaceKnots(knots));
	}

	override batch<T>(operation: () => Promise<T>): Promise<T> {
		if (this.isBatching) return super.batch(operation);
		return this.mutate(() => super.batch(operation));
	}

	protected override async mutate<T>(operation: () => Promise<T>): Promise<T> {
		this.assertInitialized();
		if (this.closePromise) throw new Error("SqliteGraphStore is closing");
		if (this.isBatching) return await operation();

		const currentQueue = this.mutationQueue;
		const gate = Promise.withResolvers<void>();
		this.mutationQueue = gate.promise;

		// biome-ignore lint/plugin/noSwallowedRejection: Prior mutation failure must not block execution of subsequent queued mutations.
		await currentQueue.catch(() => {
			// Prior mutation error is already returned to its caller.
		});
		try {
			this.assertInitialized();
			const before = await super.exportGraphState();
			try {
				const result = await operation();
				const after = await super.exportGraphState();
				persistSqliteDiff(before, after, this.database());
				return result;
			} catch (cause) {
				this.state.rollback(before);
				throw cause;
			}
		} finally {
			gate.resolve();
		}
	}

	private readState(): GraphStateSnapshot {
		return readSqliteState(this.database());
	}

	private database(): SqliteDatabase {
		if (!this.db || !this.initialized) throw new Error("SqliteGraphStore is not initialized");
		return this.db;
	}

	private assertInitialized(): void {
		this.database();
	}
}
