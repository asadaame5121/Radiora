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
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	Work,
	WorkingCopy,
} from "../domain/models.ts";
import type { GraphStateSnapshot, MergeWorksInput, WorkBundle } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import { TURSO_SCHEMA_SQL, TURSO_STORAGE_SCHEMA_VERSION } from "./turso_schema.ts";
import {
	hasPersistedState,
	isRecord,
	persistTursoState,
	readTursoState,
	type TursoDatabase,
	type TursoDatabaseTransaction,
} from "./turso_records.ts";
import type { TursoSyncConfig, TursoSyncStatus } from "./turso_sync_config.ts";

export type { TursoDatabase, TursoDatabaseTransaction };

export type TursoDatabaseConnector = (
	path: string,
	syncConfig: TursoSyncConfig | null,
) => Promise<TursoDatabase>;

export interface TursoGraphStoreOptions {
	syncConfig?: TursoSyncConfig | null;
	connector?: TursoDatabaseConnector;
}

export interface TursoSyncResult {
	status: TursoSyncStatus;
	error?: string;
}

async function defaultTursoConnector(
	path: string,
	syncConfig: TursoSyncConfig | null,
): Promise<TursoDatabase> {
	if (syncConfig) {
		const { connect } = await import("@tursodatabase/sync");
		const db = await connect({
			path,
			url: syncConfig.syncUrl,
			authToken: syncConfig.authToken,
		});
		return db as TursoDatabase;
	}
	const { connect } = await import("@tursodatabase/database");
	const db = await connect(path, { timeout: 5000 });
	return db as TursoDatabase;
}

/**
 * Durable Turso implementation of the existing GraphStore contract.
 *
 * In local-only mode, uses @tursodatabase/database connect(path).
 * When sync is opted in, uses @tursodatabase/sync connect({ path, url, authToken })
 * to avoid duplicate connections to the same database file.
 */
export class TursoGraphStore extends MemoryGraphStore {
	private db: TursoDatabase | null = null;
	private initialized = false;
	private readonly syncConfig: TursoSyncConfig | null;
	private readonly connector: TursoDatabaseConnector;
	private syncStatus: TursoSyncStatus = "disabled";

	constructor(
		private readonly path: string,
		options: TursoGraphStoreOptions = {},
	) {
		super();
		this.syncConfig = options.syncConfig ?? null;
		this.connector = options.connector ?? defaultTursoConnector;
	}

	override async initialize(): Promise<void> {
		if (this.initialized) return;
		const db = await this.connector(this.path, this.syncConfig);
		try {
			await db.exec(TURSO_SCHEMA_SQL);
			const metadata = await db.get(
				"SELECT schema_version FROM storage_metadata WHERE id = ?",
				"radiora",
			);
			if (metadata !== undefined && !isRecord(metadata)) {
				throw new Error("Turso storage metadata row is invalid");
			}
			if (metadata !== undefined && metadata.schema_version !== TURSO_STORAGE_SCHEMA_VERSION) {
				throw new Error(`Unsupported Turso storage schema: ${String(metadata.schema_version)}`);
			}
			this.db = db;
			this.initialized = true;
			this.syncStatus = this.syncConfig ? "offline" : "disabled";
			const state = await this.readState();
			if (hasPersistedState(state)) await super.restoreGraphState(state);
			else await this.persistState(await super.exportGraphState());
		} catch (cause) {
			this.db = null;
			this.initialized = false;
			this.syncStatus = this.syncConfig ? "offline" : "disabled";
			let closeCause: unknown;
			try {
				await db.close();
			} catch (error) {
				closeCause = error;
			}
			if (closeCause !== undefined) {
				throw new Error(
					`Turso database initialization cleanup failed: ${String(closeCause)}`,
					{ cause },
				);
			}
			throw cause;
		}
	}

	override async close(): Promise<void> {
		const db = this.db;
		this.db = null;
		this.initialized = false;
		this.syncStatus = this.syncConfig ? "offline" : "disabled";
		if (!db) return;
		try {
			await this.persistState(await super.exportGraphState(), db);
			if (this.syncConfig) {
				await db.checkpoint?.();
			} else {
				await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
				await db.exec("PRAGMA journal_mode = DELETE");
			}
		} finally {
			await db.close();
		}
	}

	async sync(): Promise<TursoSyncResult> {
		this.assertInitialized();
		if (!this.syncConfig) {
			return { status: "disabled" };
		}
		const db = this.database();
		if (typeof db.push !== "function" || typeof db.pull !== "function") {
			throw new Error("Turso sync is enabled but database does not support push/pull");
		}

		this.syncStatus = "syncing";
		try {
			const pulled = await db.pull();
			if (pulled) {
				const state = await this.readState();
				await super.restoreGraphState(state);
			}
			await db.push();
			this.syncStatus = "synced";
			return { status: "synced" };
		} catch (cause) {
			const errorMessage = cause instanceof Error ? cause.message : String(cause);
			const isAuth = errorMessage.includes("401") || errorMessage.includes("403") ||
				errorMessage.includes("Unauthorized") || errorMessage.includes("unauthorized");
			const nextStatus: TursoSyncStatus = isAuth ? "auth_expired" : "offline";
			this.syncStatus = nextStatus;
			return { status: nextStatus, error: errorMessage };
		}
	}

	getSyncStatus(): TursoSyncStatus {
		return this.syncStatus;
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
		return this.mutate(() => super.updateWorkingCopy(workId, text, updatedAt));
	}

	override createRevision(revision: Revision, branchId: string): Promise<void> {
		return this.mutate(() => super.createRevision(revision, branchId));
	}

	override createRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
		return this.mutate(() => super.createRecoverySnapshot(snapshot));
	}

	override applyRecoverySnapshot(snapshotId: string, updatedAt: string): Promise<void> {
		return this.mutate(() => super.applyRecoverySnapshot(snapshotId, updatedAt));
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

	private async mutate<T>(operation: () => Promise<T>): Promise<T> {
		this.assertInitialized();
		const before = await super.exportGraphState();
		try {
			const result = await operation();
			await this.persistState(await super.exportGraphState());
			return result;
		} catch (cause) {
			await super.restoreGraphState(before);
			throw cause;
		}
	}

	private async readState(): Promise<GraphStateSnapshot> {
		return readTursoState(this.database());
	}

	private async persistState(
		state: GraphStateSnapshot,
		db = this.database(),
	): Promise<void> {
		return persistTursoState(state, db);
	}

	private database(): TursoDatabase {
		if (!this.db || !this.initialized) throw new Error("TursoGraphStore is not initialized");
		return this.db;
	}

	private assertInitialized(): void {
		this.database();
	}
}
