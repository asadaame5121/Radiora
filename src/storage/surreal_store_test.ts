import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import type { Branch, Revision } from "../domain/models.ts";
import { validateRevisionCreation } from "./graph_store.ts";
import {
	evolvedFromEndpoints,
	itemFromRow,
	navigationPurgeStatements,
	occurrenceFromRow,
	quickCaptureTransactionQuery,
	recoveryPromotionTransactionQuery,
	recoveryRestoreTransactionQuery,
	resumePositionUpsertQuery,
	revisionFromRow,
	snapshotProtectionFromRow,
	workFromRow,
} from "./surreal_store.ts";

Deno.test("Quick Capture Surreal writes are enclosed in one transaction", () => {
	const query = quickCaptureTransactionQuery();
	assertEquals(query.match(/BEGIN TRANSACTION/g)?.length, 1);
	assertEquals(query.match(/COMMIT TRANSACTION/g)?.length, 1);
	assertEquals(query.match(/\bCREATE\b/g)?.length, 3);
});

const ITEM_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const PARENT_ID = "a3744669-9419-4edb-ab06-09f397c18932";
const REVISION_ID = "5537ca1d-dcd4-43e8-b68d-fbfa672133de";
const OTHER_REVISION_ID = "9a27411e-bb3a-4566-a7d7-86340f04ae13";

function row(parentId: unknown) {
	return {
		id: ITEM_ID,
		work_id: ITEM_ID,
		text: "child",
		parent_id: parentId,
		selector_mode: "branch",
		branch_id: ITEM_ID,
		order_key: 1024,
		collapsed: false,
		created_at: "2026-07-21T00:00:00.000Z",
		updated_at: "2026-07-21T00:00:00.000Z",
	};
}

Deno.test("Surreal item rows expose child and parent IDs as domain UUIDs", () => {
	const item = itemFromRow(row(PARENT_ID));

	assertEquals(item.id, ITEM_ID);
	assertEquals(item.parentId, PARENT_ID);
});

Deno.test("Surreal item rows preserve a missing parent as null", () => {
	assertEquals(itemFromRow(row(null)).parentId, null);
});

Deno.test("Surreal item rows reject a record ID at the domain boundary", () => {
	assertThrows(
		() => itemFromRow(row(`outline_item:${PARENT_ID}`)),
		TypeError,
		"Expected parent_id to be a UUID",
	);
});

Deno.test("Surreal pinned Occurrence rows normalize Revision RecordId to a domain UUID", () => {
	const occurrence = occurrenceFromRow({
		...row(null),
		selector_mode: "pinned",
		branch_id: null,
		revision_id: new RecordId("revision", REVISION_ID),
	});

	assertEquals(occurrence.revisionSelector, {
		mode: "pinned",
		revisionId: REVISION_ID,
	});
});

Deno.test("Surreal Revision rows normalize parent RecordIds to domain UUIDs", () => {
	const revision = revisionFromRow({
		id: REVISION_ID,
		work_id: ITEM_ID,
		text: "revision",
		parent_revisions: [new RecordId("revision", OTHER_REVISION_ID)],
		kind: "edition",
		created_at: "2026-07-21T00:00:00.000Z",
	});

	assertEquals(revision.parentRevisionIds, [OTHER_REVISION_ID]);
});

Deno.test("Revision creation validation rejects invalid parent graphs before persistence", () => {
	const branch: Branch = {
		id: PARENT_ID,
		workId: ITEM_ID,
		name: "main",
		headRevisionId: REVISION_ID,
		createdAt: "2026-07-21T00:00:00.000Z",
	};
	const existing: Revision[] = [{
		id: REVISION_ID,
		workId: ITEM_ID,
		text: "existing",
		parentRevisionIds: [],
		kind: "edition",
		createdAt: "2026-07-21T00:00:00.000Z",
	}];
	const candidate = (id: string, parentRevisionIds: string[]): Revision => ({
		id,
		workId: ITEM_ID,
		text: "candidate",
		parentRevisionIds,
		kind: "edition",
		createdAt: "2026-07-21T00:01:00.000Z",
	});

	assertThrows(
		() => validateRevisionCreation(candidate(OTHER_REVISION_ID, ["missing"]), branch, existing),
		Error,
		"Parent Revision not found",
	);
	assertThrows(
		() =>
			validateRevisionCreation(
				candidate(OTHER_REVISION_ID, [REVISION_ID, REVISION_ID]),
				branch,
				existing,
			),
		Error,
		"Revision parents must be unique",
	);
	assertThrows(
		() =>
			validateRevisionCreation(
				candidate(OTHER_REVISION_ID, [OTHER_REVISION_ID]),
				branch,
				existing,
			),
		Error,
		"Revision cannot be its own parent",
	);
	assertThrows(
		() =>
			validateRevisionCreation(
				candidate(OTHER_REVISION_ID, [REVISION_ID]),
				branch,
				[{ ...existing[0], workId: PARENT_ID }],
			),
		Error,
		"Parent Revision does not belong to Revision Work",
	);
});

Deno.test("FROM persists from parent in-endpoint to child out-endpoint", () => {
	assertEquals(evolvedFromEndpoints(PARENT_ID, ITEM_ID), {
		inId: PARENT_ID,
		outId: ITEM_ID,
	});
});

Deno.test("Surreal Snapshot restore transaction saves recovery state before applying text", () => {
	const query = recoveryRestoreTransactionQuery(true, true);
	assertEquals(query.startsWith("BEGIN TRANSACTION;"), true);
	assertEquals(
		query.indexOf("CREATE $beforeRestore") < query.indexOf("UPDATE working_copy"),
		true,
	);
	assertEquals(query.trimEnd().endsWith("COMMIT TRANSACTION;"), true);
	assertEquals(query.includes("source_revision: $sourceRevision"), true);
});

Deno.test("Surreal Snapshot promotion atomically advances head and protects its source", () => {
	const query = recoveryPromotionTransactionQuery(false);
	assertEquals(query.startsWith("BEGIN TRANSACTION;"), true);
	assertEquals(query.indexOf("CREATE $revision") < query.indexOf("UPDATE $branch"), true);
	assertEquals(query.indexOf("UPDATE $branch") < query.indexOf("UPDATE $snapshot"), true);
	assertEquals(query.includes('protection_reason = "revision-source"'), true);
	assertEquals(query.trimEnd().endsWith("COMMIT TRANSACTION;"), true);
});

Deno.test("Surreal Snapshot protection omits an absent optional expiry", () => {
	const protection = snapshotProtectionFromRow({
		protection_reason: "revision-source",
		protected_at: "2026-07-28T00:02:00.000Z",
		protection_expires_at: null,
	});
	assertEquals(protection, {
		reason: "revision-source",
		protectedAt: "2026-07-28T00:02:00.000Z",
	});
	assertEquals(Object.hasOwn(protection ?? {}, "expiresAt"), false);
});

Deno.test("Surreal Snapshot protection preserves a concrete expiry", () => {
	assertEquals(
		snapshotProtectionFromRow({
			protection_reason: "user",
			protected_at: "2026-07-28T00:02:00.000Z",
			protection_expires_at: "2026-08-28T00:02:00.000Z",
		}),
		{
			reason: "user",
			protectedAt: "2026-07-28T00:02:00.000Z",
			expiresAt: "2026-08-28T00:02:00.000Z",
		},
	);
});

Deno.test("Surreal resume position uses one fixed upsert record", () => {
	const query = resumePositionUpsertQuery();
	assertEquals(query.includes("UPSERT resume_position:current"), true);
	assertEquals(query.includes("work: $work"), true);
	assertEquals(query.includes("occurrence: $occurrence"), true);
	assertEquals(query.includes("caret_offset: $caretOffset"), true);
});

Deno.test("Surreal Work purge removes both navigation records by Work", () => {
	const statements = navigationPurgeStatements();
	assertEquals(statements.includes("DELETE bookmark WHERE work = $work;"), true);
	assertEquals(statements.includes("DELETE resume_position WHERE work = $work;"), true);
});

Deno.test("Surreal Work rows preserve Stub metadata", () => {
	const work = workFromRow({
		id: ITEM_ID,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:00:00.000Z",
		deleted_at: null,
		stub: {
			created_at: "2026-07-30T00:00:00.000Z",
			created_via: "advanced-link-editor",
			context: "未解決の名前",
		},
	});

	assertEquals(work.id, ITEM_ID);
	assertEquals(work.stub, {
		createdAt: "2026-07-30T00:00:00.000Z",
		createdVia: "advanced-link-editor",
		context: "未解決の名前",
	});
});

Deno.test("Surreal Work rows omit an absent or partial Stub", () => {
	const base = {
		id: ITEM_ID,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:00:00.000Z",
		deleted_at: null,
	};

	const withoutStub = workFromRow({ ...base, stub: null });
	assertEquals(withoutStub.stub, undefined);
	assertEquals(Object.hasOwn(withoutStub, "stub"), false);

	const withoutContext = workFromRow({
		...base,
		stub: { created_at: "2026-07-30T00:00:00.000Z", created_via: "stub-list", context: null },
	});
	assertEquals(withoutContext.stub, {
		createdAt: "2026-07-30T00:00:00.000Z",
		createdVia: "stub-list",
	});
	assertEquals(Object.hasOwn(withoutContext.stub ?? {}, "context"), false);

	assertEquals(
		workFromRow({ ...base, stub: { created_via: "stub-list" } }).stub,
		undefined,
	);
});

Deno.test("Quick Capture transaction embeds Stub metadata only on demand", () => {
	const plain = quickCaptureTransactionQuery();
	assertEquals(plain.includes("stub"), false);

	const withStub = quickCaptureTransactionQuery(true, true);
	assertEquals(withStub.match(/\bCREATE\b/g)?.length, 3);
	assertEquals(withStub.match(/BEGIN TRANSACTION/g)?.length, 1);
	assertEquals(withStub.match(/COMMIT TRANSACTION/g)?.length, 1);
	assertEquals(withStub.includes("stub: {"), true);
	assertEquals(withStub.includes("created_via: $stubCreatedVia"), true);
	assertEquals(withStub.includes("context: $stubContext"), true);

	const withoutContext = quickCaptureTransactionQuery(true, false);
	assertEquals(withoutContext.includes("context: NONE"), true);
	assertEquals(withoutContext.includes("$stubContext"), false);
});
