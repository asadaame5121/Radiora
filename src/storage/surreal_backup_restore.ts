import { RecordId } from "surrealdb";
import type { GraphStateSnapshot, GraphStore } from "./graph_store.ts";
import type { SurrealRow } from "./surreal_row_mapper.ts";
import {
	bookmarkFromRow,
	emergenceFeedbackActionFromRow,
	resumePositionFromRow,
} from "./surreal_row_mapper.ts";

export interface SurrealRestoreTransaction {
	query: string;
	variables: Record<string, unknown>;
}

const DATA_TABLES = [
	"semantic_link",
	"system_relation",
	"bookmark",
	"resume_position",
	"recovery_snapshot",
	"occurrence",
	"working_copy",
	"revision",
	"branch",
	"knot",
	"search_alias",
	"emergence_feedback",
	"emergence_suggestion",
	"saved_rule_query",
	"purge_manifest",
	"work",
] as const;

export function buildSurrealRestoreTransaction(
	state: GraphStateSnapshot,
): SurrealRestoreTransaction {
	const statements = DATA_TABLES.map((table) => `DELETE ${table};`);
	const variables: Record<string, unknown> = {};
	let index = 0;
	const create = (table: string, id: string, content: Record<string, unknown>): void => {
		const suffix = index++;
		statements.push(`CREATE $restoreRecord${suffix} CONTENT $restoreContent${suffix};`);
		variables[`restoreRecord${suffix}`] = new RecordId(table, id);
		variables[`restoreContent${suffix}`] = compact(content);
	};
	const record = (table: string, id: string): RecordId => new RecordId(table, id);

	for (const work of state.works) {
		create("work", work.id, {
			created_at: work.createdAt,
			updated_at: work.updatedAt,
			deleted_at: work.deletedAt,
			stub: work.stub
				? compact({
					created_at: work.stub.createdAt,
					created_via: work.stub.createdVia,
					context: work.stub.context,
				})
				: undefined,
			merged_into_work: work.mergedIntoWorkId ? record("work", work.mergedIntoWorkId) : undefined,
			merged_at: work.mergedAt,
		});
	}
	for (const branch of state.branches) {
		create("branch", branch.id, {
			work: record("work", branch.workId),
			name: branch.name,
			head_revision: branch.headRevisionId ? record("revision", branch.headRevisionId) : undefined,
			created_at: branch.createdAt,
			promoted_at: branch.promotedAt,
			archived_at: branch.archivedAt,
		});
	}
	for (const copy of state.workingCopies) {
		create("working_copy", copy.branchId, {
			work: record("work", copy.workId),
			branch: record("branch", copy.branchId),
			text: copy.text,
			updated_at: copy.updatedAt,
		});
	}
	for (const revision of state.revisions) {
		create("revision", revision.id, {
			work: record("work", revision.workId),
			text: revision.text,
			parent_revisions: revision.parentRevisionIds.map((id) => record("revision", id)),
			kind: revision.kind,
			created_at: revision.createdAt,
			message: revision.message,
		});
	}
	for (const snapshot of state.recoverySnapshots) {
		create("recovery_snapshot", snapshot.id, {
			work: record("work", snapshot.workId),
			branch: record("branch", snapshot.branchId),
			text: snapshot.text,
			content_hash: snapshot.contentHash,
			created_at: snapshot.createdAt,
			source_revision: snapshot.sourceRevisionId
				? record("revision", snapshot.sourceRevisionId)
				: undefined,
			name: snapshot.name,
			protection_reason: snapshot.protection?.reason,
			protected_at: snapshot.protection?.protectedAt,
			protection_expires_at: snapshot.protection?.expiresAt,
		});
	}
	for (const occurrence of state.occurrences) {
		create("occurrence", occurrence.id, {
			work: record("work", occurrence.workId),
			parent_occurrence: occurrence.parentOccurrenceId
				? record("occurrence", occurrence.parentOccurrenceId)
				: undefined,
			order_key: occurrence.orderKey,
			collapsed: occurrence.collapsed,
			selector_mode: occurrence.revisionSelector.mode,
			branch: occurrence.revisionSelector.mode === "branch"
				? record("branch", occurrence.revisionSelector.branchId)
				: undefined,
			revision: occurrence.revisionSelector.mode === "pinned"
				? record("revision", occurrence.revisionSelector.revisionId)
				: undefined,
			contextual_heading: occurrence.contextualHeading,
		});
	}
	for (const link of state.links) {
		create("semantic_link", link.id, {
			from_scope: link.from.scope,
			from_work: record("work", link.from.workId),
			from_revision: link.from.scope === "revision"
				? record("revision", link.from.revisionId)
				: undefined,
			to_scope: link.to.scope,
			to_work: record("work", link.to.workId),
			to_revision: link.to.scope === "revision"
				? record("revision", link.to.revisionId)
				: undefined,
			type: link.type,
			status: link.status,
			origin: link.origin,
			reason: link.reason,
			created_at: link.createdAt,
		});
	}
	for (const relation of state.systemRelations) {
		create("system_relation", relation.id, {
			from_work: record("work", relation.fromWorkId),
			to_work: record("work", relation.toWorkId),
			type: relation.type,
			created_at: relation.createdAt,
		});
	}
	for (const knot of state.knots) {
		create("knot", knot.id, { cycle_ids: knot.cycleIds, created_at: knot.createdAt });
	}
	for (const alias of state.aliases) {
		create("search_alias", alias.id, {
			canonical: alias.canonical,
			variants: alias.variants,
			created_at: alias.createdAt,
			updated_at: alias.updatedAt,
		});
	}
	for (const [id, action] of Object.entries(state.emergenceFeedback)) {
		create("emergence_feedback", id, {
			action,
			updated_at: "1970-01-01T00:00:00.000Z",
		});
	}
	for (const suggestion of state.emergenceSuggestions) {
		create("emergence_suggestion", suggestion.id, {
			kind: suggestion.kind,
			context_work: record("work", suggestion.contextWorkId),
			target_work: record("work", suggestion.targetWorkId),
			context_occurrence_id: suggestion.contextItemId,
			target_occurrence_id: suggestion.targetItemId,
			proposed_link_type: suggestion.proposedLinkType,
			title: suggestion.title,
			explanation: suggestion.explanation,
			evidence: suggestion.evidence,
			score: suggestion.score,
			status: suggestion.persistenceStatus,
			created_at: suggestion.createdAt,
			updated_at: suggestion.updatedAt,
			resolved_at: suggestion.resolvedAt,
			resolution_reason: suggestion.resolutionReason,
		});
	}
	for (const query of state.savedRuleQueries) {
		create("saved_rule_query", query.id, {
			name: query.name,
			source: query.source,
			created_at: query.createdAt,
			updated_at: query.updatedAt,
		});
	}
	for (const manifest of state.purgeManifests) {
		create("purge_manifest", manifest.id, {
			work_id: manifest.workId,
			occurrence_ids: manifest.occurrenceIds,
			branch_ids: manifest.branchIds,
			revision_ids: manifest.revisionIds,
			link_ids: manifest.linkIds,
			purged_at: manifest.purgedAt,
		});
	}
	for (const bookmark of state.bookmarks) {
		create("bookmark", bookmark.id, {
			work: record("work", bookmark.workId),
			occurrence: record("occurrence", bookmark.occurrenceId),
			created_at: bookmark.createdAt,
		});
	}
	if (state.resumePosition) {
		create("resume_position", "current", {
			work: record("work", state.resumePosition.workId),
			occurrence: record("occurrence", state.resumePosition.occurrenceId),
			caret_offset: state.resumePosition.caretOffset,
			updated_at: state.resumePosition.updatedAt,
		});
	}
	return {
		query: `BEGIN TRANSACTION;\n${statements.join("\n")}\nCOMMIT TRANSACTION;`,
		variables,
	};
}

export async function exportSurrealGraphState(
	store: GraphStore,
	db: { query<T>(query: string): Promise<T> },
): Promise<GraphStateSnapshot> {
	const [
		works,
		branches,
		workingCopies,
		occurrences,
		links,
		systemRelations,
		knots,
		aliases,
		emergenceSuggestions,
		savedRuleQueries,
		purgeManifests,
		revisions,
		recoverySnapshots,
		bookmarkResult,
		resumeResult,
		feedbackResult,
	] = await Promise.all([
		store.listWorks(true),
		store.listBranches(),
		store.listWorkingCopies(),
		store.listOccurrences(true),
		store.listLinks(),
		store.listSystemRelations(),
		store.listKnots(),
		store.listAliases(),
		store.listEmergenceSuggestions(),
		store.listSavedRuleQueries(),
		store.listPurgeManifests(),
		store.listRevisions(),
		store.listRecoverySnapshots(),
		db.query<[SurrealRow[]]>(
			`SELECT record::id(id) AS id, record::id(work) AS work_id,
				record::id(occurrence) AS occurrence_id, created_at FROM bookmark;`,
		),
		db.query<[SurrealRow[]]>(
			`SELECT record::id(work) AS work_id, record::id(occurrence) AS occurrence_id,
				caret_offset, updated_at FROM resume_position:current;`,
		),
		db.query<[SurrealRow[]]>(
			`SELECT record::id(id) AS id, action FROM emergence_feedback;`,
		),
	]);
	const bookmarks = bookmarkResult[0].map(bookmarkFromRow);
	const resumeRow = resumeResult[0][0];
	const resumePosition = resumeRow ? resumePositionFromRow(resumeRow) : null;
	const emergenceFeedback = Object.fromEntries(
		feedbackResult[0].flatMap((row) => {
			const action = emergenceFeedbackActionFromRow(row);
			return action ? [[String(row.id), action]] : [];
		}),
	) as Record<string, "accept" | "dismiss" | "pin">;
	return {
		works,
		branches,
		workingCopies,
		occurrences,
		links,
		systemRelations,
		knots,
		aliases,
		emergenceFeedback,
		emergenceSuggestions,
		savedRuleQueries,
		purgeManifests,
		revisions,
		recoverySnapshots,
		bookmarks,
		resumePosition,
	};
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
