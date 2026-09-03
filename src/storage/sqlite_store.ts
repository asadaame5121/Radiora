import type {
	Bookmark,
	Branch,
	EmergenceAction,
	EmergenceSuggestion,
	Knot,
	LinkType,
	Occurrence,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	RelationTypeDefinition,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import type { GraphStateSnapshot, MergeWorksInput, WorkBundle } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";
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
export class SqliteGraphStore extends MemoryGraphStore {
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
			if (metadata !== undefined && metadata.schema_version !== SQLITE_STORAGE_SCHEMA_VERSION) {
				throw new Error(`Unsupported SQLite storage schema: ${String(metadata.schema_version)}`);
			}
			this.db = db;
			this.initialized = true;
			const state = this.readState();
			if (metadata !== undefined) {
				await super.restoreGraphState(state);
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

	override restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		return this.mutate(() => super.restoreGraphState(state));
	}

	override mergeWorks(input: MergeWorksInput): Promise<void> {
		return this.mutate(() => super.mergeWorks(input));
	}

	override createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		return this.mutate(() => super.createWorkBundle(work, branch, workingCopy, occurrence));
	}

	override importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		return this.mutate(() => super.importWorkBundles(bundles));
	}

	override createUnplacedWork(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
	): Promise<void> {
		return this.mutate(() => super.createUnplacedWork(work, branch, workingCopy));
	}

	override resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		return this.mutate(() => super.resolveWorkStub(workId, updatedAt));
	}

	override createOccurrence(occurrence: Occurrence): Promise<void> {
		return this.mutate(() => super.createOccurrence(occurrence));
	}

	override createBookmark(bookmark: Bookmark): Promise<void> {
		return this.mutate(() => super.createBookmark(bookmark));
	}

	override deleteBookmark(id: string): Promise<void> {
		return this.mutate(() => super.deleteBookmark(id));
	}

	override setResumePosition(position: ResumePosition): Promise<void> {
		return this.mutate(() => super.setResumePosition(position));
	}

	override clearResumePosition(): Promise<void> {
		return this.mutate(() => super.clearResumePosition());
	}

	override createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		return this.mutate(() => super.createBranch(branch, workingCopy));
	}

	override updateBranch(branch: Branch): Promise<void> {
		return this.mutate(() => super.updateBranch(branch));
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
			const main = this.branches.find((branch) =>
				branch.workId === workId && branch.name === "main"
			);
			if (!main) return Promise.reject(new Error(`Main Branch not found for Work: ${workId}`));
			return super.updateBranchWorkingCopy(main.id, text, updatedAt);
		});
	}

	override createRevision(revision: Revision, branchId: string): Promise<void> {
		return this.mutate(() => super.createRevision(revision, branchId));
	}

	override createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		return this.mutate(() => super.createRecoverySnapshot(snapshot));
	}

	override applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		return this.mutate(() => {
			const snapshot = this.recoverySnapshots.find((candidate) => candidate.id === snapshotId);
			if (!snapshot) {
				return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
			}
			return super.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
		});
	}

	override restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		return this.mutate(() => super.restoreRecoverySnapshot(snapshotId, beforeRestore, updatedAt));
	}

	override promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		return this.mutate(() =>
			super.promoteRecoverySnapshot(snapshotId, revision, branchId, protectedAt)
		);
	}

	override updateOccurrence(occurrence: Occurrence): Promise<void> {
		return this.mutate(() => super.updateOccurrence(occurrence));
	}

	override deleteOccurrence(id: string): Promise<void> {
		return this.mutate(() => super.deleteOccurrence(id));
	}

	override trashWork(workId: string, deletedAt: string): Promise<void> {
		return this.mutate(() => super.trashWork(workId, deletedAt));
	}

	override restoreWork(workId: string): Promise<void> {
		return this.mutate(() => super.restoreWork(workId));
	}

	override purgeWork(workId: string): Promise<PurgeManifest> {
		return this.mutate(() => super.purgeWork(workId));
	}

	override createLink(link: OutlineLink): Promise<void> {
		return this.mutate(() => super.createLink(link));
	}

	override deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		return this.mutate(() => super.deleteLink(fromId, toId, type));
	}

	override replaceKnots(knots: Knot[]): Promise<void> {
		return this.mutate(() => super.replaceKnots(knots));
	}

	override upsertAlias(alias: SearchAlias): Promise<void> {
		return this.mutate(() => super.upsertAlias(alias));
	}

	override deleteAlias(id: string): Promise<void> {
		return this.mutate(() => super.deleteAlias(id));
	}

	override setEmergenceFeedback(
		id: string,
		action: "accept" | "dismiss" | "pin",
	): Promise<void> {
		return this.mutate(() => super.setEmergenceFeedback(id, action));
	}

	override upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		return this.mutate(() => super.upsertEmergenceSuggestion(suggestion));
	}

	override resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		return this.mutate(() => super.resolveEmergenceSuggestion(id, action, link, reason));
	}

	override upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		return this.mutate(() => super.upsertSavedRuleQuery(query));
	}

	override deleteSavedRuleQuery(id: string): Promise<void> {
		return this.mutate(() => super.deleteSavedRuleQuery(id));
	}

	override createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		return this.mutate(() => super.createRelationTypeDefinition(definition));
	}

	private async mutate<T>(operation: () => Promise<T>): Promise<T> {
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
			const before = await super.exportGraphState();
			try {
				const result = await operation();
				const after = await super.exportGraphState();
				persistSqliteDiff(before, after, this.database());
				return result;
			} catch (cause) {
				await super.restoreGraphState(before);
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
