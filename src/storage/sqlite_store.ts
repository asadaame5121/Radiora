import { AsyncLocalStorage } from "node:async_hooks";
import {
	areKnotsEqual,
	type Knot,
	type Occurrence,
	type ResumePosition,
} from "../domain/models.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import { SqliteMutationGraphStore } from "./sqlite_mutation_graph_store.ts";
import { migrateSqliteHistoricalTime } from "./sqlite_historical_migration.ts";
import { SQLITE_SCHEMA_SQL, SQLITE_STORAGE_SCHEMA_VERSION } from "./sqlite_schema.ts";
import {
	applySqliteDiffOperations,
	isRecord,
	NodeSqliteDatabaseAdapter,
	persistSqliteDiff,
	readSqliteState,
	type SqliteDatabase,
	type SqliteDatabaseTransaction,
} from "./sqlite_records.ts";
import {
	planTargetedBranchWorkingCopyUpdate,
	planTargetedOccurrenceUpdate,
	planTargetedResumePositionClear,
	planTargetedResumePositionSet,
	type TargetedMutationStep,
} from "./sqlite_targeted_mutations.ts";

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
	private readonly batchContext = new AsyncLocalStorage<{ active: boolean }>();
	private knotsDirty = false;

	constructor(
		private readonly path: string,
		options: SqliteGraphStoreOptions = {},
	) {
		super();
		this.connector = options.connector ?? defaultSqliteConnector;
	}

	protected override afterOutlineStructureChanged(): void {
		this.knotsDirty = true;
	}

	private planOccurrenceUpdate(occurrence: Occurrence) {
		const step = planTargetedOccurrenceUpdate(this.state, occurrence);
		const previous = this.state.occurrences.find((candidate) => candidate.id === occurrence.id);
		const isStructureChange = previous !== undefined && (
			previous.parentOccurrenceId !== occurrence.parentOccurrenceId ||
			previous.workId !== occurrence.workId
		);
		return { step, isStructureChange };
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
				await MemoryGraphStore.prototype.restoreGraphState.call(this, state);
				if (metadata.schema_version === 1) await migrateSqliteHistoricalTime(db, this.path, state);
				persistSqliteDiff(
					{ ...state, relationTypeDefinitions: [] },
					state,
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
		const context = this.batchContext.getStore();
		if (context?.active) {
			return Promise.reject(new Error("Cannot close SqliteGraphStore from inside an active batch"));
		}
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

	override updateOccurrence(occurrence: Occurrence): Promise<void> {
		const context = this.batchContext.getStore();
		if (context) {
			if (!context.active) {
				return Promise.reject(new Error("Batch context is expired"));
			}
			const { step, isStructureChange } = this.planOccurrenceUpdate(occurrence);
			if (isStructureChange) {
				return super.updateOccurrence(occurrence);
			}
			return step.execute();
		}
		return this.enqueueMutation(async () => {
			const { step, isStructureChange } = this.planOccurrenceUpdate(occurrence);
			if (isStructureChange) {
				return await this.commitFullMutation(async () => {
					await step.execute();
					this.afterOutlineStructureChanged();
				});
			}
			try {
				const result = await step.execute();
				applySqliteDiffOperations(step.diff, this.database());
				return result;
			} catch (cause) {
				step.rollback();
				throw cause;
			}
		});
	}

	override setResumePosition(position: ResumePosition): Promise<void> {
		return this.mutateTargeted(() => planTargetedResumePositionSet(this.state, position));
	}

	override clearResumePosition(): Promise<void> {
		return this.mutateTargeted(() => planTargetedResumePositionClear(this.state));
	}

	override updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		return this.mutateTargeted(() =>
			planTargetedBranchWorkingCopyUpdate(this.state, branchId, text, updatedAt)
		);
	}

	override updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		return this.mutateTargeted(() => {
			const main = this.state.branches.find((branch) =>
				branch.workId === workId && branch.name === "main"
			);
			if (!main) throw new Error(`Main Branch not found for Work: ${workId}`);
			return planTargetedBranchWorkingCopyUpdate(this.state, main.id, text, updatedAt);
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

	override replaceKnots(knots: Knot[]): Promise<void> {
		const context = this.batchContext.getStore();
		if (context) {
			if (!context.active) {
				return Promise.reject(new Error("Batch context is expired"));
			}
			if (areKnotsEqual(this.state.knots, knots)) {
				return Promise.resolve();
			}
			return super.replaceKnots(knots);
		}
		return this.enqueueMutation(() => {
			if (areKnotsEqual(this.state.knots, knots)) {
				return Promise.resolve();
			}
			return this.commitFullMutation(() => super.replaceKnots(knots));
		});
	}

	override batch<T>(operation: () => Promise<T>): Promise<T> {
		const current = this.batchContext.getStore();
		if (current) {
			if (!current.active) {
				return Promise.reject(new Error("Batch context is expired"));
			}
			return operation();
		}
		return this.mutate(async () => {
			const context = { active: true };
			return await this.batchContext.run(context, async () => {
				try {
					return await operation();
				} finally {
					context.active = false;
				}
			});
		});
	}

	private async enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
		this.assertInitialized();
		if (this.closePromise) throw new Error("SqliteGraphStore is closing");

		const currentQueue = this.mutationQueue;
		const gate = Promise.withResolvers<void>();
		this.mutationQueue = gate.promise;

		// biome-ignore lint/plugin/noSwallowedRejection: Prior mutation failure must not block execution of subsequent queued mutations.
		await currentQueue.catch(() => {
			// Prior mutation error is already returned to its caller.
		});
		try {
			this.assertInitialized();
			return await task();
		} finally {
			gate.resolve();
		}
	}

	private mutateTargeted<T>(plan: () => TargetedMutationStep<T>): Promise<T> {
		const context = this.batchContext.getStore();
		if (context) {
			if (!context.active) {
				return Promise.reject(new Error("Batch context is expired"));
			}
			return plan().execute();
		}
		return this.enqueueMutation(async () => {
			const step = plan();
			try {
				const result = await step.execute();
				applySqliteDiffOperations(step.diff, this.database());
				return result;
			} catch (cause) {
				step.rollback();
				throw cause;
			}
		});
	}

	private async commitFullMutation<T>(operation: () => Promise<T>): Promise<T> {
		const before = await this.exportGraphState();
		try {
			const result = await operation();
			if (this.knotsDirty) {
				this.reconcileOutlineKnots();
				this.knotsDirty = false;
			}
			const after = await this.exportGraphState();
			persistSqliteDiff(before, after, this.database());
			return result;
		} catch (cause) {
			this.knotsDirty = false;
			await MemoryGraphStore.prototype.restoreGraphState.call(this, before);
			this.knotsDirty = false;
			throw cause;
		} finally {
			this.knotsDirty = false;
		}
	}

	protected override mutate<T>(operation: () => Promise<T>): Promise<T> {
		const context = this.batchContext.getStore();
		if (context) {
			if (!context.active) {
				return Promise.reject(new Error("Batch context is expired"));
			}
			return operation();
		}
		return this.enqueueMutation(() => this.commitFullMutation(operation));
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
