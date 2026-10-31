import type { HistoricalTime } from "../domain/historical_time.ts";
import { areKnotsEqual } from "../domain/models.ts";
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
import { SqlitePersistence } from "./sqlite_persistence.ts";
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
import {
	planTargetedBranchWorkingCopyUpdate,
	planTargetedOccurrenceUpdate,
	planTargetedResumePositionClear,
	planTargetedResumePositionSet,
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
export class SqliteGraphStore extends MemoryGraphStore {
	private db: SqliteDatabase | null = null;
	private initialized = false;
	private readonly connector: SqliteDatabaseConnector;
	private readonly persistence: SqlitePersistence;
	private knotsDirty = false;

	constructor(
		private readonly path: string,
		options: SqliteGraphStoreOptions = {},
	) {
		super();
		this.connector = options.connector ?? defaultSqliteConnector;
		this.persistence = new SqlitePersistence(() => this.database(), {
			exportGraphState: () => this.exportGraphState(),
			restoreGraphState: (state) => super.restoreGraphState(state),
			prepareSnapshot: () => {
				if (this.knotsDirty) this.reconcileOutlineKnots();
				this.knotsDirty = false;
			},
			clearPendingProjection: () => {
				this.knotsDirty = false;
			},
		});
	}

	protected override afterOutlineStructureChanged(): void {
		this.knotsDirty = true;
	}

	private planOccurrenceUpdate(occurrence: Occurrence) {
		const step = planTargetedOccurrenceUpdate(this.state, occurrence);
		return {
			...step,
			execute: async () => {
				await step.execute();
				if (step.affectsOutlineStructure) this.afterOutlineStructureChanged();
			},
		};
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
				metadata !== undefined &&
				metadata.schema_version !== 1 &&
				metadata.schema_version !== SQLITE_STORAGE_SCHEMA_VERSION
			) {
				throw new Error(`Unsupported SQLite storage schema: ${String(metadata.schema_version)}`);
			}
			this.db = db;
			this.initialized = true;
			const state = this.readState();
			if (metadata !== undefined) {
				await super.restoreGraphState(state);
				if (metadata.schema_version === 1) await migrateSqliteHistoricalTime(db, this.path, state);
				persistSqliteDiff({ ...state, relationTypeDefinitions: [] }, state, db);
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
				throw new Error(`SQLite database initialization cleanup failed: ${String(closeCause)}`, {
					cause,
				});
			}
			throw cause;
		}
	}

	override close(): Promise<void> {
		return this.persistence.close(() => {
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
		});
	}

	override restoreGraphState(state: GraphStateSnapshot): Promise<void> {
		return this.persistence.mutate(() => super.restoreGraphState(state));
	}

	override mergeWorks(input: MergeWorksInput): Promise<void> {
		return this.persistence.mutate(() => super.mergeWorks(input));
	}

	override createWorkBundle(
		work: Work,
		branch: Branch,
		workingCopy: WorkingCopy,
		occurrence: Occurrence,
	): Promise<void> {
		return this.persistence.mutate(() =>
			super.createWorkBundle(work, branch, workingCopy, occurrence),
		);
	}

	override importWorkBundles(bundles: readonly WorkBundle[]): Promise<void> {
		return this.persistence.mutate(() => super.importWorkBundles(bundles));
	}

	override createUnplacedWork(work: Work, branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		return this.persistence.mutate(() => super.createUnplacedWork(work, branch, workingCopy));
	}

	override resolveWorkStub(workId: string, updatedAt: string): Promise<void> {
		return this.persistence.mutate(() => super.resolveWorkStub(workId, updatedAt));
	}

	override setWorkHistoricalTime(
		workId: string,
		value: HistoricalTime | null,
		updatedAt: string,
	): Promise<void> {
		return this.persistence.mutate(() => super.setWorkHistoricalTime(workId, value, updatedAt));
	}

	override createOccurrence(occurrence: Occurrence): Promise<void> {
		return this.persistence.mutate(() => super.createOccurrence(occurrence));
	}

	override createBookmark(bookmark: Bookmark): Promise<void> {
		return this.persistence.mutate(() => super.createBookmark(bookmark));
	}

	override deleteBookmark(id: string): Promise<void> {
		return this.persistence.mutate(() => super.deleteBookmark(id));
	}

	override createBranch(branch: Branch, workingCopy: WorkingCopy): Promise<void> {
		return this.persistence.mutate(() => super.createBranch(branch, workingCopy));
	}

	override updateBranch(branch: Branch): Promise<void> {
		return this.persistence.mutate(() => super.updateBranch(branch));
	}

	override createRevision(revision: Revision, branchId: string): Promise<void> {
		return this.persistence.mutate(() => super.createRevision(revision, branchId));
	}

	override createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		return this.persistence.mutate(() => super.createRecoverySnapshot(snapshot));
	}

	override restoreRecoverySnapshot(
		snapshotId: string,
		beforeRestore: RecoverySnapshot,
		updatedAt: string,
	): Promise<void> {
		return this.persistence.mutate(() =>
			super.restoreRecoverySnapshot(snapshotId, beforeRestore, updatedAt),
		);
	}

	override promoteRecoverySnapshot(
		snapshotId: string,
		revision: Revision,
		branchId: string,
		protectedAt: string,
	): Promise<void> {
		return this.persistence.mutate(() =>
			super.promoteRecoverySnapshot(snapshotId, revision, branchId, protectedAt),
		);
	}

	override deleteOccurrence(id: string): Promise<void> {
		return this.persistence.mutate(() => super.deleteOccurrence(id));
	}

	override trashWork(workId: string, deletedAt: string): Promise<void> {
		return this.persistence.mutate(() => super.trashWork(workId, deletedAt));
	}

	override restoreWork(workId: string): Promise<void> {
		return this.persistence.mutate(() => super.restoreWork(workId));
	}

	override purgeWork(workId: string): Promise<PurgeManifest> {
		return this.persistence.mutate(() => super.purgeWork(workId));
	}

	override createLink(link: OutlineLink): Promise<void> {
		return this.persistence.mutate(() => super.createLink(link));
	}

	override deleteLink(fromId: string, toId: string, type: LinkType): Promise<void> {
		return this.persistence.mutate(() => super.deleteLink(fromId, toId, type));
	}

	override upsertAlias(alias: SearchAlias): Promise<void> {
		return this.persistence.mutate(() => super.upsertAlias(alias));
	}

	override deleteAlias(id: string): Promise<void> {
		return this.persistence.mutate(() => super.deleteAlias(id));
	}

	override setEmergenceFeedback(id: string, action: "accept" | "dismiss" | "pin"): Promise<void> {
		return this.persistence.mutate(() => super.setEmergenceFeedback(id, action));
	}

	override upsertEmergenceSuggestion(suggestion: EmergenceSuggestion): Promise<void> {
		return this.persistence.mutate(() => super.upsertEmergenceSuggestion(suggestion));
	}

	override resolveEmergenceSuggestion(
		id: string,
		action: EmergenceAction,
		link?: OutlineLink,
		reason?: string,
	): Promise<void> {
		return this.persistence.mutate(() =>
			super.resolveEmergenceSuggestion(id, action, link, reason),
		);
	}

	override upsertSavedRuleQuery(query: SavedRuleQuery): Promise<void> {
		return this.persistence.mutate(() => super.upsertSavedRuleQuery(query));
	}

	override deleteSavedRuleQuery(id: string): Promise<void> {
		return this.persistence.mutate(() => super.deleteSavedRuleQuery(id));
	}

	override createRelationTypeDefinition(definition: RelationTypeDefinition): Promise<void> {
		return this.persistence.mutate(() => super.createRelationTypeDefinition(definition));
	}

	override updateOccurrence(occurrence: Occurrence): Promise<void> {
		return this.persistence.mutateTargeted(() => this.planOccurrenceUpdate(occurrence));
	}

	override setResumePosition(position: ResumePosition): Promise<void> {
		return this.persistence.mutateTargeted(() =>
			planTargetedResumePositionSet(this.state, position),
		);
	}

	override clearResumePosition(): Promise<void> {
		return this.persistence.mutateTargeted(() => planTargetedResumePositionClear(this.state));
	}

	override updateBranchWorkingCopy(
		branchId: string,
		text: string,
		updatedAt: string,
	): Promise<void> {
		return this.persistence.mutateTargeted(() =>
			planTargetedBranchWorkingCopyUpdate(this.state, branchId, text, updatedAt),
		);
	}

	override updateWorkingCopy(workId: string, text: string, updatedAt: string): Promise<void> {
		return this.persistence.mutateTargeted(() => {
			const main = this.state.branches.find(
				(branch) => branch.workId === workId && branch.name === "main",
			);
			if (!main) throw new Error(`Main Branch not found for Work: ${workId}`);
			return planTargetedBranchWorkingCopyUpdate(this.state, main.id, text, updatedAt);
		});
	}

	override applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		return this.persistence.mutate(() => {
			const snapshot = this.state.recoverySnapshots.find(
				(candidate) => candidate.id === snapshotId,
			);
			if (!snapshot) {
				return Promise.reject(new Error(`Recovery Snapshot not found: ${snapshotId}`));
			}
			return super.updateBranchWorkingCopy(snapshot.branchId, snapshot.text, updatedAt);
		});
	}

	override async replaceKnots(knots: Knot[]): Promise<void> {
		if (this.persistence.inBatch()) {
			if (!areKnotsEqual(this.state.knots, knots)) await super.replaceKnots(knots);
			return;
		}
		return await this.persistence.enqueue(() => {
			if (areKnotsEqual(this.state.knots, knots)) return Promise.resolve();
			return this.persistence.commitFullMutation(() => super.replaceKnots(knots));
		});
	}

	override batch<T>(operation: () => Promise<T>): Promise<T> {
		return this.persistence.batch(operation);
	}

	private readState(): GraphStateSnapshot {
		return readSqliteState(this.database());
	}

	private database(): SqliteDatabase {
		if (!this.db || !this.initialized) throw new Error("SqliteGraphStore is not initialized");
		return this.db;
	}
}
