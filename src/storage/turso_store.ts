import { connect, type Database } from "@tursodatabase/database";
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
import { validatedGraphStateSnapshot } from "./graph_store.ts";
import { MemoryGraphStore } from "./memory_store.ts";
import {
	TURSO_RECORD_TABLES,
	TURSO_SCHEMA_SQL,
	TURSO_STORAGE_SCHEMA_VERSION,
} from "./turso_schema.ts";

type RecordTable = (typeof TURSO_RECORD_TABLES)[number];

interface StoredRecord {
	id: string;
	payload: unknown;
}

interface UnknownRecord {
	[key: string]: unknown;
}

const TABLE_FOR_STATE: Record<
	Exclude<keyof GraphStateSnapshot, "emergenceFeedback" | "resumePosition">,
	RecordTable
> = {
	works: "work",
	branches: "branch",
	workingCopies: "working_copy",
	revisions: "revision",
	recoverySnapshots: "recovery_snapshot",
	occurrences: "occurrence",
	links: "semantic_link",
	systemRelations: "system_relation",
	knots: "knot",
	aliases: "search_alias",
	emergenceSuggestions: "emergence_suggestion",
	savedRuleQueries: "saved_rule_query",
	purgeManifests: "purge_manifest",
	bookmarks: "bookmark",
};

const ARRAY_STATE_KEYS = Object.keys(TABLE_FOR_STATE) as Array<
	Exclude<keyof GraphStateSnapshot, "emergenceFeedback" | "resumePosition">
>;

/**
 * Durable Turso implementation of the existing GraphStore contract.
 *
 * ponytail: rewrite the validated full snapshot per mutation; replace with row-level SQL only
 * after a measured dataset shows this O(n) durability path is a bottleneck.
 */
export class TursoGraphStore extends MemoryGraphStore {
	private db: Database | null = null;
	private initialized = false;

	constructor(private readonly path: string) {
		super();
	}

	override async initialize(): Promise<void> {
		if (this.initialized) return;
		const db = await connect(this.path, { timeout: 5000 });
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
			const state = await this.readState();
			if (hasPersistedState(state)) await super.restoreGraphState(state);
			else await this.persistState(await super.exportGraphState());
		} catch (cause) {
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
		if (!db) return;
		try {
			await this.persistState(await super.exportGraphState(), db);
			await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			await db.exec("PRAGMA journal_mode = DELETE");
		} finally {
			await db.close();
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
		const state: Record<string, unknown> = {
			works: [],
			branches: [],
			workingCopies: [],
			revisions: [],
			recoverySnapshots: [],
			occurrences: [],
			links: [],
			systemRelations: [],
			knots: [],
			aliases: [],
			emergenceFeedback: {},
			emergenceSuggestions: [],
			savedRuleQueries: [],
			purgeManifests: [],
			bookmarks: [],
			resumePosition: null,
		};
		for (const key of ARRAY_STATE_KEYS) {
			state[key] = (await this.readRecords(TABLE_FOR_STATE[key])).map(({ payload }) => payload);
		}
		const feedback = await this.readRecords("emergence_feedback");
		state.emergenceFeedback = Object.fromEntries(
			feedback.map(({ id, payload }) => [id, payload]),
		);
		const resume = await this.readRecords("resume_position");
		if (resume.length > 1) throw new Error("Turso resume position singleton is invalid");
		state.resumePosition = resume[0]?.payload ?? null;
		return validatedGraphStateSnapshot(state);
	}

	private async readRecords(table: RecordTable): Promise<StoredRecord[]> {
		const rows: unknown[] = await this.database().all(
			`SELECT id, payload FROM ${table} ORDER BY position, id`,
		);
		return rows.map((row, index) => parseStoredRecord(table, row, index));
	}

	private async persistState(state: GraphStateSnapshot, db = this.database()): Promise<void> {
		const validated = validatedGraphStateSnapshot(state);
		const transaction = db.transactionAsync(async (txn) => {
			for (const table of TURSO_RECORD_TABLES) await txn.run(`DELETE FROM ${table}`);
			for (const key of ARRAY_STATE_KEYS) {
				const table = TABLE_FOR_STATE[key];
				for (const [position, value] of validated[key].entries()) {
					await txn.run(
						`INSERT INTO ${table} (id, position, payload) VALUES (?, ?, ?)`,
						recordId(table, value),
						position,
						JSON.stringify(value),
					);
				}
			}
			for (
				const [position, [id, action]] of Object.entries(validated.emergenceFeedback).entries()
			) {
				await txn.run(
					"INSERT INTO emergence_feedback (id, position, payload) VALUES (?, ?, ?)",
					id,
					position,
					JSON.stringify(action),
				);
			}
			if (validated.resumePosition) {
				await txn.run(
					"INSERT INTO resume_position (id, position, payload) VALUES (?, ?, ?)",
					"current",
					0,
					JSON.stringify(validated.resumePosition),
				);
			}
			await txn.run(
				`INSERT INTO storage_metadata (id, schema_version, updated_at)
				 VALUES ('radiora', ?, ?)
				 ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version,
				 updated_at = excluded.updated_at`,
				TURSO_STORAGE_SCHEMA_VERSION,
				new Date().toISOString(),
			);
		});
		await transaction.immediate();
	}

	private database(): Database {
		if (!this.db || !this.initialized) throw new Error("TursoGraphStore is not initialized");
		return this.db;
	}

	private assertInitialized(): void {
		this.database();
	}
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedState(state: GraphStateSnapshot): boolean {
	return Object.values(state).some((value) => Array.isArray(value) && value.length > 0) ||
		Object.keys(state.emergenceFeedback).length > 0 || state.resumePosition !== null;
}

function recordId(table: RecordTable, value: unknown): string {
	if (!isRecord(value)) throw new Error(`Invalid Turso ${table} payload`);
	const key = table === "working_copy" ? "branchId" : "id";
	const id = value[key];
	if (typeof id !== "string" || !id) throw new Error(`Invalid Turso ${table} ID`);
	return id;
}

function parseStoredRecord(table: RecordTable, row: unknown, index: number): StoredRecord {
	if (!isRecord(row) || typeof row.id !== "string" || typeof row.payload !== "string") {
		throw new Error(`Invalid Turso ${table} row at index ${index}`);
	}
	const payload = parsePayload(table, row.payload, index);
	assertRecordIdentity(table, row.id, payload, index);
	return { id: row.id, payload };
}

function parsePayload(table: RecordTable, source: string, index: number): unknown {
	try {
		return JSON.parse(source);
	} catch (cause) {
		throw new Error(`Invalid Turso ${table} JSON at index ${index}`, { cause });
	}
}

function assertRecordIdentity(
	table: RecordTable,
	id: string,
	payload: unknown,
	index: number,
): void {
	if (table === "emergence_feedback" || table === "resume_position") return;
	const key = table === "working_copy" ? "branchId" : "id";
	if (!isRecord(payload) || payload[key] !== id) {
		throw new Error(`Invalid Turso ${table} identity at index ${index}`);
	}
}
