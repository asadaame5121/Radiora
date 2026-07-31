import { RecordId } from "surrealdb";
import type {
	Occurrence,
	OutlineItem,
	Revision,
	SnapshotProtection,
	StubCreationKind,
	Work,
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
