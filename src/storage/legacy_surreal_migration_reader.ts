import { parse } from "valibot";
import { HistoricalTimeSchema } from "../domain/historical_time.ts";
import type {
	Bookmark,
	Branch,
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
	StubCreationKind,
	SystemRelation,
	Work,
	WorkingCopy,
	WorkStub,
} from "../domain/models.ts";
import type { GraphStateSnapshot } from "./graph_store.ts";

export interface SurrealSqlStatementResult<T = Record<string, unknown>> {
	status: "OK" | "ERR";
	result?: T[];
	detail?: string;
}

export function extractRecordId(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "object" && value !== null && "id" in value) {
		return String((value as { id: unknown }).id);
	}
	const str = String(value);
	const sep = str.indexOf(":");
	return sep < 0 ? str : str.slice(sep + 1).replace(/^`|`$/g, "");
}

function optionalRecordId(value: unknown): string | null {
	if (value == null) return null;
	const id = extractRecordId(value);
	return id.length > 0 ? id : null;
}

function parseStub(value: unknown): WorkStub | undefined {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const rec = value as Record<string, unknown>;
	if (rec.created_at == null || rec.created_via == null) return undefined;
	return {
		createdAt: String(rec.created_at),
		createdVia: String(rec.created_via) as StubCreationKind,
		...(rec.context == null ? {} : { context: String(rec.context) }),
	};
}

const TABLE_INDEX_WORK = 0;
const TABLE_INDEX_BRANCH = 1;
const TABLE_INDEX_WORKING_COPY = 2;
const TABLE_INDEX_OCCURRENCE = 3;
const TABLE_INDEX_SEMANTIC_LINK = 4;
const TABLE_INDEX_SYSTEM_RELATION = 5;
const TABLE_INDEX_KNOT = 6;
const TABLE_INDEX_SEARCH_ALIAS = 7;
const TABLE_INDEX_EMERGENCE_FEEDBACK = 8;
const TABLE_INDEX_EMERGENCE_SUGGESTION = 9;
const TABLE_INDEX_SAVED_RULE_QUERY = 10;
const TABLE_INDEX_PURGE_MANIFEST = 11;
const TABLE_INDEX_REVISION = 12;
const TABLE_INDEX_RECOVERY_SNAPSHOT = 13;
const TABLE_INDEX_BOOKMARK = 14;
const TABLE_INDEX_RESUME_POSITION = 15;

export function buildExportQueries(): string {
	return [
		"SELECT record::id(id) AS id, historical_time, created_at, updated_at, deleted_at, stub, record::id(merged_into_work) AS merged_into_work_id, merged_at FROM work;",
		"SELECT record::id(id) AS id, record::id(work) AS work_id, name, record::id(head_revision) AS head_revision_id, created_at, promoted_at, archived_at FROM branch;",
		"SELECT record::id(branch) AS branch_id, record::id(work) AS work_id, text, updated_at FROM working_copy;",
		"SELECT record::id(id) AS id, record::id(work) AS work_id, record::id(parent_occurrence) AS parent_occurrence_id, record::id(parent_id) AS parent_id, record::id(branch) AS branch_id, record::id(branch_id) AS branch_id_alt, record::id(revision) AS revision_id, selector_mode, order_key, collapsed, contextual_heading, revision_selector FROM occurrence;",
		"SELECT record::id(id) AS id, record::id(from) AS from_id, record::id(to) AS to_id, from_scope, to_scope, record::id(from_revision) AS from_revision, record::id(to_revision) AS to_revision, type, status, origin, reason, created_at FROM semantic_link;",
		"SELECT record::id(id) AS id, record::id(from) AS from_id, record::id(to) AS to_id, type, created_at FROM system_relation;",
		"SELECT record::id(id) AS id, cycle_ids, created_at FROM knot;",
		"SELECT record::id(id) AS id, canonical, variants, created_at, updated_at FROM search_alias;",
		"SELECT record::id(id) AS id, action FROM emergence_feedback;",
		"SELECT record::id(id) AS id, kind, record::id(context_work) AS context_work_id, record::id(target_work) AS target_work_id, context_occurrence_id, target_occurrence_id, proposed_link_type, title, explanation, evidence, score, status, created_at, updated_at, resolved_at, resolution_reason FROM emergence_suggestion;",
		"SELECT record::id(id) AS id, name, source, created_at, updated_at FROM saved_rule_query;",
		"SELECT record::id(id) AS id, work_id, occurrence_ids, branch_ids, revision_ids, link_ids, purged_at FROM purge_manifest;",
		"SELECT record::id(id) AS id, record::id(work) AS work_id, text, parent_revisions, kind, created_at, message FROM revision;",
		"SELECT record::id(id) AS id, record::id(work) AS work_id, record::id(branch) AS branch_id, text, content_hash, created_at, record::id(source_revision) AS source_revision_id, name, protection_reason, protected_at, protection_expires_at FROM recovery_snapshot;",
		"SELECT record::id(id) AS id, record::id(work) AS work_id, record::id(occurrence) AS occurrence_id, created_at FROM bookmark;",
		"SELECT record::id(work) AS work_id, record::id(occurrence) AS occurrence_id, caret_offset, updated_at FROM resume_position:current;",
	].join("\n");
}

function parseWorkRow(r: Record<string, unknown>): Work {
	const stub = parseStub(r.stub);
	const mergedId = optionalRecordId(r.merged_into_work_id ?? r.merged_into_work);
	return {
		id: extractRecordId(r.id),
		...(r.historical_time == null
			? {}
			: { historicalTime: parse(HistoricalTimeSchema, r.historical_time) }),
		createdAt: String(r.created_at ?? ""),
		updatedAt: String(r.updated_at ?? ""),
		deletedAt: r.deleted_at == null ? undefined : String(r.deleted_at),
		...(stub ? { stub } : {}),
		...(mergedId ? { mergedIntoWorkId: mergedId } : {}),
		...(r.merged_at == null ? {} : { mergedAt: String(r.merged_at) }),
	};
}

function parseBranchRow(r: Record<string, unknown>): Branch {
	return {
		id: extractRecordId(r.id),
		workId: extractRecordId(r.work_id ?? r.work),
		name: String(r.name ?? ""),
		headRevisionId: optionalRecordId(r.head_revision_id ?? r.head_revision),
		createdAt: String(r.created_at ?? ""),
		promotedAt: r.promoted_at == null ? undefined : String(r.promoted_at),
		archivedAt: r.archived_at == null ? undefined : String(r.archived_at),
	};
}

function parseWorkingCopyRow(r: Record<string, unknown>): WorkingCopy {
	return {
		branchId: extractRecordId(r.branch_id ?? r.branch),
		workId: extractRecordId(r.work_id ?? r.work),
		text: String(r.text ?? ""),
		updatedAt: String(r.updated_at ?? ""),
	};
}

function parseOccurrenceRow(r: Record<string, unknown>): Occurrence {
	const parentId = optionalRecordId(r.parent_occurrence_id ?? r.parent_id);
	const branchId = extractRecordId(r.branch_id ?? r.branch_id_alt ?? r.branch);
	const revId = optionalRecordId(r.revision_id);
	const selectorMode = r.selector_mode === "pinned" ? "pinned" : "branch";
	return {
		id: extractRecordId(r.id),
		workId: extractRecordId(r.work_id ?? r.work),
		parentOccurrenceId: parentId,
		orderKey: Number(r.order_key ?? 0),
		collapsed: Boolean(r.collapsed),
		revisionSelector: selectorMode === "pinned" && revId
			? { mode: "pinned", revisionId: revId }
			: { mode: "branch", branchId },
		contextualHeading: r.contextual_heading == null ? undefined : String(r.contextual_heading),
	};
}

function parseLinkRow(r: Record<string, unknown>): OutlineLink {
	const fromId = extractRecordId(r.from_id ?? r.from);
	const toId = extractRecordId(r.to_id ?? r.to);
	return {
		id: extractRecordId(r.id),
		fromId,
		toId,
		from: r.from_scope === "revision"
			? { scope: "revision", workId: fromId, revisionId: extractRecordId(r.from_revision) }
			: { scope: "work", workId: fromId },
		to: r.to_scope === "revision"
			? { scope: "revision", workId: toId, revisionId: extractRecordId(r.to_revision) }
			: { scope: "work", workId: toId },
		type: String(r.type) as LinkType,
		status: String(r.status ?? "active") as OutlineLink["status"],
		origin: String(r.origin ?? "manual") as OutlineLink["origin"],
		createdAt: String(r.created_at ?? ""),
		reason: r.reason == null ? undefined : String(r.reason),
	};
}

function parseSystemRelationRow(r: Record<string, unknown>): SystemRelation {
	return {
		id: extractRecordId(r.id),
		fromWorkId: extractRecordId(r.from_id ?? r.from),
		toWorkId: extractRecordId(r.to_id ?? r.to),
		type: "IN",
		createdAt: String(r.created_at ?? ""),
	};
}

function parseKnotRow(r: Record<string, unknown>): Knot {
	return {
		id: extractRecordId(r.id),
		cycleIds: Array.isArray(r.cycle_ids) ? r.cycle_ids.map(extractRecordId) : [],
		createdAt: String(r.created_at ?? ""),
	};
}

function parseAliasRow(r: Record<string, unknown>): SearchAlias {
	return {
		id: extractRecordId(r.id),
		canonical: String(r.canonical ?? ""),
		variants: Array.isArray(r.variants) ? r.variants.map(String) : [],
		createdAt: String(r.created_at ?? ""),
		updatedAt: String(r.updated_at ?? ""),
	};
}

function parseEmergenceEvidence(evidence: unknown): EmergenceSuggestion["evidence"] {
	if (!Array.isArray(evidence)) return [];
	return evidence.map((step) => {
		const item = step as Record<string, unknown>;
		return {
			fromId: extractRecordId(item.fromId ?? item.from_id ?? item.from),
			toId: extractRecordId(item.toId ?? item.to_id ?? item.to),
			relation: String(item.relation ?? "") as EmergenceSuggestion["evidence"][number]["relation"],
		};
	});
}

function parseEmergenceSuggestionRow(r: Record<string, unknown>): EmergenceSuggestion {
	const status = String(r.status ?? "candidate") as EmergenceSuggestion["persistenceStatus"];
	return {
		id: extractRecordId(r.id),
		kind: String(r.kind) as EmergenceSuggestion["kind"],
		contextWorkId: extractRecordId(r.context_work_id ?? r.context_work),
		targetWorkId: extractRecordId(r.target_work_id ?? r.target_work),
		contextItemId: String(r.context_occurrence_id ?? ""),
		targetItemId: String(r.target_occurrence_id ?? ""),
		...(r.proposed_link_type == null
			? {}
			: { proposedLinkType: String(r.proposed_link_type) as LinkType }),
		title: String(r.title ?? ""),
		explanation: String(r.explanation ?? ""),
		evidence: parseEmergenceEvidence(r.evidence),
		score: Number(r.score ?? 0),
		...(status === "held" ? { status: "pinned" as const } : {}),
		persistenceStatus: status,
		createdAt: String(r.created_at ?? ""),
		updatedAt: String(r.updated_at ?? ""),
		...(r.resolved_at == null ? {} : { resolvedAt: String(r.resolved_at) }),
		...(r.resolution_reason == null ? {} : { resolutionReason: String(r.resolution_reason) }),
	};
}

function parseSavedRuleQueryRow(r: Record<string, unknown>): SavedRuleQuery {
	return {
		id: extractRecordId(r.id),
		name: String(r.name ?? ""),
		source: String(r.source ?? ""),
		createdAt: String(r.created_at ?? ""),
		updatedAt: String(r.updated_at ?? ""),
	};
}

function parsePurgeManifestRow(r: Record<string, unknown>): PurgeManifest {
	return {
		id: extractRecordId(r.id),
		workId: String(r.work_id ?? ""),
		occurrenceIds: Array.isArray(r.occurrence_ids) ? r.occurrence_ids.map(extractRecordId) : [],
		branchIds: Array.isArray(r.branch_ids) ? r.branch_ids.map(extractRecordId) : [],
		revisionIds: Array.isArray(r.revision_ids) ? r.revision_ids.map(extractRecordId) : [],
		linkIds: Array.isArray(r.link_ids) ? r.link_ids.map(extractRecordId) : [],
		purgedAt: String(r.purged_at ?? ""),
	};
}

function parseRevisionRow(r: Record<string, unknown>): Revision {
	return {
		id: extractRecordId(r.id),
		workId: extractRecordId(r.work_id ?? r.work),
		text: String(r.text ?? ""),
		parentRevisionIds: Array.isArray(r.parent_revisions)
			? r.parent_revisions.map(extractRecordId)
			: [],
		kind: String(r.kind ?? "checkpoint") as Revision["kind"],
		createdAt: String(r.created_at ?? ""),
		message: r.message == null ? undefined : String(r.message),
	};
}

function parseRecoverySnapshotRow(r: Record<string, unknown>): RecoverySnapshot {
	return {
		id: extractRecordId(r.id),
		workId: extractRecordId(r.work_id ?? r.work),
		branchId: extractRecordId(r.branch_id ?? r.branch),
		text: String(r.text ?? ""),
		contentHash: String(r.content_hash ?? ""),
		createdAt: String(r.created_at ?? ""),
		sourceRevisionId: optionalRecordId(r.source_revision_id ?? r.source_revision),
		name: r.name == null ? undefined : String(r.name),
		protection: r.protection_reason == null ? undefined : {
			reason: String(r.protection_reason) as NonNullable<
				RecoverySnapshot["protection"]
			>["reason"],
			protectedAt: String(r.protected_at ?? ""),
			...(r.protection_expires_at == null ? {} : { expiresAt: String(r.protection_expires_at) }),
		},
	};
}

function parseBookmarkRow(r: Record<string, unknown>): Bookmark {
	return {
		id: extractRecordId(r.id),
		workId: extractRecordId(r.work_id ?? r.work),
		occurrenceId: extractRecordId(r.occurrence_id ?? r.occurrence),
		createdAt: String(r.created_at ?? ""),
	};
}

function parseResumePosition(rows: Record<string, unknown>[]): ResumePosition | null {
	const first = rows[0];
	if (!first) return null;
	return {
		workId: extractRecordId(first.work_id ?? first.work),
		occurrenceId: extractRecordId(first.occurrence_id ?? first.occurrence),
		caretOffset: Number(first.caret_offset ?? 0),
		updatedAt: String(first.updated_at ?? ""),
	};
}

function parseEmergenceFeedback(
	rows: Record<string, unknown>[],
): Record<string, "accept" | "dismiss" | "pin"> {
	const feedback: Record<string, "accept" | "dismiss" | "pin"> = {};
	for (const r of rows) {
		const action = r.action;
		if (action === "accept" || action === "dismiss" || action === "pin") {
			feedback[extractRecordId(r.id)] = action;
		}
	}
	return feedback;
}

export function parseSurrealSqlResponse(
	responses: SurrealSqlStatementResult[],
): GraphStateSnapshot {
	const getRows = (index: number): Record<string, unknown>[] => {
		const res = responses[index];
		if (!res || res.status !== "OK" || !Array.isArray(res.result)) return [];
		return res.result as Record<string, unknown>[];
	};

	return {
		works: getRows(TABLE_INDEX_WORK).map(parseWorkRow),
		branches: getRows(TABLE_INDEX_BRANCH).map(parseBranchRow),
		workingCopies: getRows(TABLE_INDEX_WORKING_COPY).map(parseWorkingCopyRow),
		occurrences: getRows(TABLE_INDEX_OCCURRENCE).map(parseOccurrenceRow),
		links: getRows(TABLE_INDEX_SEMANTIC_LINK).map(parseLinkRow),
		systemRelations: getRows(TABLE_INDEX_SYSTEM_RELATION).map(parseSystemRelationRow),
		knots: getRows(TABLE_INDEX_KNOT).map(parseKnotRow),
		aliases: getRows(TABLE_INDEX_SEARCH_ALIAS).map(parseAliasRow),
		emergenceFeedback: parseEmergenceFeedback(getRows(TABLE_INDEX_EMERGENCE_FEEDBACK)),
		emergenceSuggestions: getRows(TABLE_INDEX_EMERGENCE_SUGGESTION).map(
			parseEmergenceSuggestionRow,
		),
		savedRuleQueries: getRows(TABLE_INDEX_SAVED_RULE_QUERY).map(parseSavedRuleQueryRow),
		purgeManifests: getRows(TABLE_INDEX_PURGE_MANIFEST).map(parsePurgeManifestRow),
		revisions: getRows(TABLE_INDEX_REVISION).map(parseRevisionRow),
		recoverySnapshots: getRows(TABLE_INDEX_RECOVERY_SNAPSHOT).map(parseRecoverySnapshotRow),
		bookmarks: getRows(TABLE_INDEX_BOOKMARK).map(parseBookmarkRow),
		resumePosition: parseResumePosition(getRows(TABLE_INDEX_RESUME_POSITION)),
	};
}

export async function readLegacySurrealSnapshot(
	endpoint: string,
	options: { username?: string; password?: string } = {},
): Promise<GraphStateSnapshot> {
	const username = options.username ?? "root";
	const password = options.password ?? "root";
	const auth = btoa(`${username}:${password}`);
	const queries = buildExportQueries();

	const url = `${endpoint.replace(/\/+$/, "")}/sql`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Basic ${auth}`,
			"surreal-ns": "radiora_v2",
			"surreal-db": "main",
			Accept: "application/json",
		},
		body: queries,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`SurrealDB query failed with HTTP status ${response.status}: ${text}`,
		);
	}

	const body = (await response.json()) as SurrealSqlStatementResult[];
	return parseSurrealSqlResponse(body);
}
