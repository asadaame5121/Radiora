import { RecordId } from "surrealdb";
import type {
	Bookmark,
	Branch,
	EmergenceSuggestion,
	Knot,
	LinkType,
	Occurrence,
	OutlineItem,
	OutlineLink,
	PurgeManifest,
	RecoverySnapshot,
	ResumePosition,
	Revision,
	SavedRuleQuery,
	SearchAlias,
	SnapshotProtection,
	StubCreationKind,
	SystemRelation,
	Work,
	WorkingCopy,
	WorkStub,
} from "../domain/models.ts";

export type SurrealRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function domainId(
	value: unknown,
	field: "id" | "work_id" | "parent_id" | "branch_id" | "revision_id",
): string {
	const id = String(value ?? "");
	if (!UUID_PATTERN.test(id)) {
		throw new TypeError(`Expected ${field} to be a UUID, received: ${id}`);
	}
	return id;
}

export function optionalRecordDomainId(value: unknown): string | null {
	if (value == null) return null;
	if (value instanceof RecordId) return String(value.id);
	if (typeof value === "object" && "id" in value) {
		return String((value as { id: unknown }).id);
	}
	const raw = String(value);
	const separator = raw.indexOf(":");
	return separator < 0 ? raw : raw.slice(separator + 1).replace(/^`|`$/g, "");
}

export function snapshotProtectionFromRow(row: SurrealRow): SnapshotProtection | undefined {
	if (row.protection_reason == null) return undefined;
	return {
		reason: String(row.protection_reason) as SnapshotProtection["reason"],
		protectedAt: String(row.protected_at ?? ""),
		...(row.protection_expires_at == null ? {} : { expiresAt: String(row.protection_expires_at) }),
	};
}

export function workStubFromRow(row: SurrealRow): WorkStub | undefined {
	const stub = row.stub;
	if (stub == null || typeof stub !== "object" || Array.isArray(stub)) return undefined;
	const record = stub as SurrealRow;
	if (record.created_at == null || record.created_via == null) return undefined;
	return {
		createdAt: String(record.created_at),
		createdVia: String(record.created_via) as StubCreationKind,
		...(record.context == null ? {} : { context: String(record.context) }),
	};
}

export function workFromRow(row: SurrealRow): Work {
	const stub = workStubFromRow(row);
	return {
		id: domainId(row.id, "id"),
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
		deletedAt: row.deleted_at == null ? undefined : String(row.deleted_at),
		...(stub ? { stub } : {}),
		...(row.merged_into_work == null
			? {}
			: { mergedIntoWorkId: domainId(optionalRecordDomainId(row.merged_into_work), "work_id") }),
		...(row.merged_at == null ? {} : { mergedAt: String(row.merged_at) }),
	};
}

export function itemFromRow(row: SurrealRow): OutlineItem {
	const selectorMode = row.selector_mode === "pinned" ? "pinned" : "branch";
	return {
		id: domainId(row.id, "id"),
		workId: domainId(row.work_id ?? row.id, "work_id"),
		text: String(row.text ?? ""),
		parentId: row.parent_id == null ? null : domainId(row.parent_id, "parent_id"),
		orderKey: Number(row.order_key ?? 0),
		collapsed: Boolean(row.collapsed),
		revisionSelector: selectorMode === "branch"
			? { mode: "branch", branchId: domainId(row.branch_id ?? row.work_id, "branch_id") }
			: {
				mode: "pinned",
				revisionId: domainId(optionalRecordDomainId(row.revision_id), "revision_id"),
			},
		contextualHeading: row.contextual_heading == null ? undefined : String(row.contextual_heading),
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export function occurrenceFromRow(row: SurrealRow): Occurrence {
	const workId = domainId(row.work_id, "work_id");
	return {
		id: domainId(row.id, "id"),
		workId,
		parentOccurrenceId: row.parent_id == null ? null : domainId(row.parent_id, "parent_id"),
		orderKey: Number(row.order_key ?? 0),
		collapsed: Boolean(row.collapsed),
		revisionSelector: row.selector_mode === "pinned"
			? {
				mode: "pinned",
				revisionId: domainId(optionalRecordDomainId(row.revision_id), "revision_id"),
			}
			: {
				mode: "branch",
				branchId: domainId(optionalRecordDomainId(row.branch_id), "branch_id"),
			},
		contextualHeading: row.contextual_heading == null ? undefined : String(row.contextual_heading),
	};
}

export function revisionFromRow(row: SurrealRow): Revision {
	return {
		id: String(row.id),
		workId: domainId(row.work_id, "work_id"),
		text: String(row.text ?? ""),
		parentRevisionIds: Array.isArray(row.parent_revisions)
			? row.parent_revisions.map((id) => domainId(optionalRecordDomainId(id), "revision_id"))
			: [],
		kind: String(row.kind) as Revision["kind"],
		createdAt: String(row.created_at ?? ""),
		message: row.message == null ? undefined : String(row.message),
	};
}

export function branchFromRow(row: SurrealRow): Branch {
	return {
		id: String(row.id),
		workId: domainId(row.work_id, "work_id"),
		name: String(row.name ?? ""),
		headRevisionId: optionalRecordDomainId(row.head_revision),
		createdAt: String(row.created_at ?? ""),
		promotedAt: row.promoted_at == null ? undefined : String(row.promoted_at),
		archivedAt: row.archived_at == null ? undefined : String(row.archived_at),
	};
}

export function workingCopyFromRow(row: SurrealRow): WorkingCopy {
	return {
		workId: domainId(row.work_id, "work_id"),
		branchId: domainId(row.branch_id, "branch_id"),
		text: String(row.text ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export function recoverySnapshotFromRow(row: SurrealRow): RecoverySnapshot {
	return {
		id: String(row.id),
		workId: domainId(row.work_id, "work_id"),
		branchId: domainId(row.branch_id, "branch_id"),
		text: String(row.text ?? ""),
		contentHash: String(row.content_hash ?? ""),
		createdAt: String(row.created_at ?? ""),
		sourceRevisionId: optionalRecordDomainId(row.source_revision),
		name: row.name == null ? undefined : String(row.name),
		protection: snapshotProtectionFromRow(row),
	};
}

export function bookmarkFromRow(row: SurrealRow): Bookmark {
	return {
		id: String(row.id),
		workId: domainId(row.work_id, "work_id"),
		occurrenceId: domainId(row.occurrence_id, "id"),
		createdAt: String(row.created_at ?? ""),
	};
}

export function resumePositionFromRow(row: SurrealRow): ResumePosition {
	return {
		workId: domainId(row.work_id, "work_id"),
		occurrenceId: domainId(row.occurrence_id, "id"),
		caretOffset: Number(row.caret_offset),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export function purgeManifestFromRow(row: SurrealRow): PurgeManifest {
	return {
		id: String(row.id),
		workId: String(row.work_id),
		occurrenceIds: Array.isArray(row.occurrence_ids) ? row.occurrence_ids.map(String) : [],
		branchIds: Array.isArray(row.branch_ids) ? row.branch_ids.map(String) : [],
		revisionIds: Array.isArray(row.revision_ids) ? row.revision_ids.map(String) : [],
		linkIds: Array.isArray(row.link_ids) ? row.link_ids.map(String) : [],
		purgedAt: String(row.purged_at ?? ""),
	};
}

export function outlineLinkFromRow(row: SurrealRow): OutlineLink {
	const fromId = domainId(row.from_id, "work_id");
	const toId = domainId(row.to_id, "work_id");
	return {
		id: String(row.id),
		fromId,
		toId,
		from: row.from_scope === "revision"
			? {
				scope: "revision",
				workId: fromId,
				revisionId: optionalRecordDomainId(row.from_revision) ?? "",
			}
			: { scope: "work", workId: fromId },
		to: row.to_scope === "revision"
			? {
				scope: "revision",
				workId: toId,
				revisionId: optionalRecordDomainId(row.to_revision) ?? "",
			}
			: { scope: "work", workId: toId },
		type: String(row.type) as LinkType,
		status: String(row.status) as OutlineLink["status"],
		origin: String(row.origin) as OutlineLink["origin"],
		createdAt: String(row.created_at ?? ""),
		reason: row.reason == null ? undefined : String(row.reason),
	};
}

export function systemRelationFromRow(row: SurrealRow): SystemRelation {
	return {
		id: String(row.id),
		fromWorkId: domainId(row.from_id, "work_id"),
		toWorkId: domainId(row.to_id, "work_id"),
		type: "IN",
		createdAt: String(row.created_at ?? ""),
	};
}

export function knotFromRow(row: SurrealRow): Knot {
	return {
		id: String(row.id),
		cycleIds: Array.isArray(row.cycle_ids) ? row.cycle_ids.map(String) : [],
		createdAt: String(row.created_at ?? ""),
	};
}

export function searchAliasFromRow(row: SurrealRow): SearchAlias {
	return {
		id: String(row.id),
		canonical: String(row.canonical ?? ""),
		variants: Array.isArray(row.variants) ? row.variants.map(String) : [],
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export function emergenceSuggestionFromRow(row: SurrealRow): EmergenceSuggestion {
	const persistenceStatus = String(row.status) as EmergenceSuggestion["persistenceStatus"];
	return {
		id: String(row.id),
		kind: String(row.kind) as EmergenceSuggestion["kind"],
		contextWorkId: domainId(row.context_work_id, "work_id"),
		targetWorkId: domainId(row.target_work_id, "work_id"),
		contextItemId: String(row.context_occurrence_id ?? ""),
		targetItemId: String(row.target_occurrence_id ?? ""),
		...(row.proposed_link_type == null
			? {}
			: { proposedLinkType: String(row.proposed_link_type) as LinkType }),
		title: String(row.title ?? ""),
		explanation: String(row.explanation ?? ""),
		evidence: Array.isArray(row.evidence)
			? row.evidence.map((step) => {
				const value = step as SurrealRow;
				return {
					fromId: String(value.fromId ?? value.from_id ?? ""),
					toId: String(value.toId ?? value.to_id ?? ""),
					relation: String(
						value.relation ?? "",
					) as EmergenceSuggestion["evidence"][number]["relation"],
				};
			})
			: [],
		score: Number(row.score ?? 0),
		...(persistenceStatus === "held" ? { status: "pinned" as const } : {}),
		persistenceStatus,
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
		...(row.resolved_at == null ? {} : { resolvedAt: String(row.resolved_at) }),
		...(row.resolution_reason == null ? {} : { resolutionReason: String(row.resolution_reason) }),
	};
}

export function savedRuleQueryFromRow(row: SurrealRow): SavedRuleQuery {
	return {
		id: String(row.id),
		name: String(row.name ?? ""),
		source: String(row.source ?? ""),
		createdAt: String(row.created_at ?? ""),
		updatedAt: String(row.updated_at ?? ""),
	};
}

export function emergenceFeedbackActionFromRow(
	row: SurrealRow,
): "accept" | "dismiss" | "pin" | null {
	const action = row.action;
	return action === "accept" || action === "dismiss" || action === "pin" ? action : null;
}
