import type { GraphStateSnapshot } from "./graph_store.ts";
import { validatedGraphStateSnapshot } from "./graph_store.ts";
import { TURSO_RECORD_TABLES, TURSO_STORAGE_SCHEMA_VERSION } from "./turso_schema.ts";

export type RecordTable = (typeof TURSO_RECORD_TABLES)[number];

export interface StoredRecord {
	id: string;
	payload: unknown;
}

export interface UnknownRecord {
	[key: string]: unknown;
}

export interface TursoDatabaseTransaction {
	run(sql: string, ...args: unknown[]): Promise<unknown>;
}

export interface TursoDatabase {
	exec(sql: string): Promise<void>;
	get(sql: string, ...args: unknown[]): Promise<unknown>;
	all(sql: string, ...args: unknown[]): Promise<unknown[]>;
	transactionAsync<T>(fn: (txn: TursoDatabaseTransaction) => Promise<T>): {
		immediate(): Promise<T>;
	};
	close(): Promise<void>;
	push?(): Promise<void>;
	pull?(): Promise<boolean>;
	checkpoint?(): Promise<void>;
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

export function recordId(table: RecordTable, value: unknown): string {
	if (!isRecord(value)) throw new Error(`Invalid Turso ${table} payload`);
	const key = table === "working_copy" ? "branchId" : "id";
	const id = value[key];
	if (typeof id !== "string" || !id) throw new Error(`Invalid Turso ${table} ID`);
	return id;
}

export function parseStoredRecord(table: RecordTable, row: unknown, index: number): StoredRecord {
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

export async function readTursoState(db: TursoDatabase): Promise<GraphStateSnapshot> {
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
		const rows: unknown[] = await db.all(`SELECT id, payload FROM ${table} ORDER BY position, id`);
		state[key] = rows.map((row, index) => parseStoredRecord(table, row, index).payload);
	}
	const feedbackRows: unknown[] = await db.all(
		"SELECT id, payload FROM emergence_feedback ORDER BY position, id",
	);
	state.emergenceFeedback = Object.fromEntries(
		feedbackRows.map((row, i) => {
			const parsed = parseStoredRecord("emergence_feedback", row, i);
			return [parsed.id, parsed.payload];
		}),
	);
	const resumeRows: unknown[] = await db.all(
		"SELECT id, payload FROM resume_position ORDER BY position, id",
	);
	if (resumeRows.length > 1) throw new Error("Turso resume position singleton is invalid");
	state.resumePosition = resumeRows[0]
		? parseStoredRecord("resume_position", resumeRows[0], 0).payload
		: null;
	return validatedGraphStateSnapshot(state);
}

export async function persistTursoState(
	state: GraphStateSnapshot,
	db: TursoDatabase,
): Promise<void> {
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
