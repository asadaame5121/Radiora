import type { GraphStateSnapshot } from "./graph_store.ts";
import { validatedGraphStateSnapshot } from "./graph_store.ts";
import { SQLITE_RECORD_TABLES, SQLITE_STORAGE_SCHEMA_VERSION } from "./sqlite_schema.ts";

export type RecordTable = (typeof SQLITE_RECORD_TABLES)[number];

export interface StoredRecord {
	id: string;
	payload: unknown;
}

export interface UnknownRecord {
	[key: string]: unknown;
}

export interface SqliteDatabaseTransaction {
	run(sql: string, ...args: unknown[]): void;
}

export interface SqliteDatabase {
	exec(sql: string): void;
	get(sql: string, ...args: unknown[]): unknown;
	all(sql: string, ...args: unknown[]): unknown[];
	transaction<T>(fn: (txn: SqliteDatabaseTransaction) => T): T;
	close(): void;
}

interface RawStatementSync {
	get(...args: unknown[]): unknown;
	all(...args: unknown[]): unknown[];
	run(...args: unknown[]): unknown;
}

interface RawDatabaseSync {
	exec(sql: string): void;
	prepare(sql: string): RawStatementSync;
	close(): void;
}

interface RawDatabaseSyncConstructor {
	new (path: string, options?: { open?: boolean }): RawDatabaseSync;
}

let cachedDatabaseSync: RawDatabaseSyncConstructor | null = null;

async function loadDatabaseSync(): Promise<RawDatabaseSyncConstructor> {
	if (cachedDatabaseSync) return cachedDatabaseSync;
	const specifier = "node:sqlite";
	const mod = await import(specifier) as { DatabaseSync: RawDatabaseSyncConstructor };
	cachedDatabaseSync = mod.DatabaseSync;
	return cachedDatabaseSync;
}

export class NodeSqliteDatabaseAdapter implements SqliteDatabase {
	private readonly db: RawDatabaseSync;

	constructor(db: RawDatabaseSync) {
		this.db = db;
		this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
	}

	static async open(path: string): Promise<NodeSqliteDatabaseAdapter> {
		const DatabaseSyncClass = await loadDatabaseSync();
		const raw = new DatabaseSyncClass(path, { open: true });
		return new NodeSqliteDatabaseAdapter(raw);
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	get(sql: string, ...args: unknown[]): unknown {
		return this.db.prepare(sql).get(...args);
	}

	all(sql: string, ...args: unknown[]): unknown[] {
		return this.db.prepare(sql).all(...args);
	}

	transaction<T>(fn: (txn: SqliteDatabaseTransaction) => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = fn({
				run: (sql, ...args) => {
					this.db.prepare(sql).run(...args);
				},
			});
			this.db.exec("COMMIT");
			return result;
		} catch (cause) {
			try {
				this.db.exec("ROLLBACK");
			} catch (rollbackError) {
				const failure = new Error("SQLite transaction rollback failed", { cause: rollbackError });
				throw Object.assign(failure, { transactionCause: cause });
			}
			throw cause;
		}
	}

	close(): void {
		this.db.close();
	}
}

export const TABLE_FOR_STATE: Record<
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
	relationTypeDefinitions: "relation_type_definition",
};

export const ARRAY_STATE_KEYS = Object.keys(TABLE_FOR_STATE) as Array<
	Exclude<keyof GraphStateSnapshot, "emergenceFeedback" | "resumePosition">
>;

export function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasPersistedState(state: GraphStateSnapshot): boolean {
	return Object.values(state).some((value) => Array.isArray(value) && value.length > 0) ||
		Object.keys(state.emergenceFeedback).length > 0 || state.resumePosition !== null;
}

export function recordIdentityKey(table: RecordTable): string {
	if (table === "working_copy") return "branchId";
	if (table === "relation_type_definition") return "name";
	return "id";
}

export function recordId(table: RecordTable, value: unknown): string {
	if (!isRecord(value)) throw new Error(`Invalid SQLite ${table} payload`);
	const key = recordIdentityKey(table);
	const id = value[key];
	if (typeof id !== "string" || !id) throw new Error(`Invalid SQLite ${table} ID`);
	return id;
}

export function parseStoredRecord(table: RecordTable, row: unknown, index: number): StoredRecord {
	if (!isRecord(row) || typeof row.id !== "string" || typeof row.payload !== "string") {
		throw new Error(`Invalid SQLite ${table} row at index ${index}`);
	}
	const payload = parsePayload(table, row.payload, index);
	assertRecordIdentity(table, row.id, payload, index);
	return { id: row.id, payload };
}

function parsePayload(table: RecordTable, source: string, index: number): unknown {
	try {
		return JSON.parse(source);
	} catch (cause) {
		throw new Error(`Invalid SQLite ${table} JSON at index ${index}`, { cause });
	}
}

function assertRecordIdentity(
	table: RecordTable,
	id: string,
	payload: unknown,
	index: number,
): void {
	if (table === "emergence_feedback" || table === "resume_position") return;
	const key = recordIdentityKey(table);
	if (!isRecord(payload) || payload[key] !== id) {
		throw new Error(`Invalid SQLite ${table} identity at index ${index}`);
	}
}

export function readSqliteState(db: SqliteDatabase): GraphStateSnapshot {
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
		const table = TABLE_FOR_STATE[key];
		const rows: unknown[] = db.all(`SELECT id, payload FROM ${table} ORDER BY position, id`);
		if (key === "relationTypeDefinitions" && rows.length === 0) {
			continue;
		}
		state[key] = rows.map((row, index) => parseStoredRecord(table, row, index).payload);
	}
	const feedbackRows: unknown[] = db.all(
		"SELECT id, payload FROM emergence_feedback ORDER BY position, id",
	);
	state.emergenceFeedback = Object.fromEntries(
		feedbackRows.map((row, i) => {
			const parsed = parseStoredRecord("emergence_feedback", row, i);
			return [parsed.id, parsed.payload];
		}),
	);
	const resumeRows: unknown[] = db.all(
		"SELECT id, payload FROM resume_position ORDER BY position, id",
	);
	if (resumeRows.length > 1) throw new Error("SQLite resume position singleton is invalid");
	state.resumePosition = resumeRows[0]
		? parseStoredRecord("resume_position", resumeRows[0], 0).payload
		: null;
	return validatedGraphStateSnapshot(state);
}

export interface SqliteDiffOperations {
	deletes: Array<{ table: RecordTable; id: string }>;
	upserts: Array<{ table: RecordTable; id: string; position: number; payload: unknown }>;
}

function diffArrayTable(
	table: RecordTable,
	beforeList: readonly unknown[],
	afterList: readonly unknown[],
	diff: SqliteDiffOperations,
): void {
	const beforeMap = new Map<string, { position: number; json: string }>();
	for (const [pos, item] of beforeList.entries()) {
		beforeMap.set(recordId(table, item), { position: pos, json: JSON.stringify(item) });
	}

	const afterIds = new Set<string>();
	for (const [pos, item] of afterList.entries()) {
		const id = recordId(table, item);
		afterIds.add(id);
		const beforeEntry = beforeMap.get(id);
		const json = JSON.stringify(item);
		if (!beforeEntry || beforeEntry.position !== pos || beforeEntry.json !== json) {
			diff.upserts.push({ table, id, position: pos, payload: item });
		}
	}

	for (const id of beforeMap.keys()) {
		if (!afterIds.has(id)) diff.deletes.push({ table, id });
	}
}

function appendFeedbackDiff(
	before: GraphStateSnapshot | null,
	after: GraphStateSnapshot,
	diff: SqliteDiffOperations,
): void {
	const beforeFeedback = before ? before.emergenceFeedback : {};
	const afterFeedback = after.emergenceFeedback;
	const beforeFeedbackKeys = new Set(Object.keys(beforeFeedback));
	const afterFeedbackEntries = Object.entries(afterFeedback);
	const afterFeedbackKeys = new Set(afterFeedbackEntries.map(([k]) => k));

	for (const [pos, [id, action]] of afterFeedbackEntries.entries()) {
		const beforeAction = beforeFeedback[id];
		const beforePos = Object.keys(beforeFeedback).indexOf(id);
		const json = JSON.stringify(action);
		const beforeJson = beforeAction !== undefined ? JSON.stringify(beforeAction) : null;
		if (beforeAction === undefined || beforePos !== pos || beforeJson !== json) {
			diff.upserts.push({ table: "emergence_feedback", id, position: pos, payload: action });
		}
	}

	for (const id of beforeFeedbackKeys) {
		if (!afterFeedbackKeys.has(id)) diff.deletes.push({ table: "emergence_feedback", id });
	}
}

function appendResumeDiff(
	before: GraphStateSnapshot | null,
	after: GraphStateSnapshot,
	diff: SqliteDiffOperations,
): void {
	const beforeResume = before ? before.resumePosition : null;
	const afterResume = after.resumePosition;
	if (beforeResume && !afterResume) {
		diff.deletes.push({ table: "resume_position", id: "current" });
	} else if (afterResume) {
		const afterJson = JSON.stringify(afterResume);
		const beforeJson = beforeResume ? JSON.stringify(beforeResume) : null;
		if (afterJson !== beforeJson) {
			diff.upserts.push({
				table: "resume_position",
				id: "current",
				position: 0,
				payload: afterResume,
			});
		}
	}
}

export function calculateSqliteDiff(
	before: GraphStateSnapshot | null,
	after: GraphStateSnapshot,
): SqliteDiffOperations {
	const diff: SqliteDiffOperations = { deletes: [], upserts: [] };
	for (const key of ARRAY_STATE_KEYS) {
		const table = TABLE_FOR_STATE[key];
		const beforeList = before?.[key] ?? [];
		const afterList = after[key] ?? [];
		diffArrayTable(table, beforeList, afterList, diff);
	}
	appendFeedbackDiff(before, after, diff);
	appendResumeDiff(before, after, diff);
	return diff;
}

export function persistSqliteDiff(
	before: GraphStateSnapshot | null,
	after: GraphStateSnapshot,
	db: SqliteDatabase,
): void {
	const validated = validatedGraphStateSnapshot(after);
	const diff = calculateSqliteDiff(before, validated);
	if (before !== null && diff.deletes.length === 0 && diff.upserts.length === 0) return;

	db.transaction((txn) => {
		for (const del of diff.deletes) {
			txn.run(`DELETE FROM ${del.table} WHERE id = ?`, del.id);
		}
		for (const upsert of diff.upserts) {
			txn.run(
				`INSERT INTO ${upsert.table} (id, position, payload) VALUES (?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET position = excluded.position, payload = excluded.payload`,
				upsert.id,
				upsert.position,
				JSON.stringify(upsert.payload),
			);
		}
		txn.run(
			`INSERT INTO storage_metadata (id, schema_version, updated_at)
			 VALUES ('radiora', ?, ?)
			 ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version,
			 updated_at = excluded.updated_at`,
			SQLITE_STORAGE_SCHEMA_VERSION,
			new Date().toISOString(),
		);
	});
}

export function persistSqliteState(
	state: GraphStateSnapshot,
	db: SqliteDatabase,
): void {
	persistSqliteDiff(null, state, db);
}
