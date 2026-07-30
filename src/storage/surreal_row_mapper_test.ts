import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import {
	itemFromRow,
	occurrenceFromRow,
	revisionFromRow,
	snapshotProtectionFromRow,
	workFromRow,
	workStubFromRow,
} from "./surreal_row_mapper.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const PARENT_ID = "a3744669-9419-4edb-ab06-09f397c18932";
const REVISION_ID = "5537ca1d-dcd4-43e8-b68d-fbfa672133de";

Deno.test("Surreal row mappers preserve UUID domain boundaries and optional records", () => {
	const base = {
		id: WORK_ID,
		work_id: WORK_ID,
		text: "child",
		parent_id: PARENT_ID,
		selector_mode: "branch",
		branch_id: WORK_ID,
		order_key: 1024,
		collapsed: false,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:00:00.000Z",
	};

	assertEquals(itemFromRow(base).parentId, PARENT_ID);
	assertEquals(itemFromRow({ ...base, parent_id: null }).parentId, null);
	assertThrows(
		() => itemFromRow({ ...base, parent_id: `outline_item:${PARENT_ID}` }),
		TypeError,
		"Expected parent_id to be a UUID",
	);
	assertEquals(
		occurrenceFromRow({
			...base,
			selector_mode: "pinned",
			branch_id: null,
			revision_id: new RecordId("revision", REVISION_ID),
		}).revisionSelector,
		{ mode: "pinned", revisionId: REVISION_ID },
	);
	assertEquals(
		revisionFromRow({
			id: REVISION_ID,
			work_id: WORK_ID,
			text: "revision",
			parent_revisions: [new RecordId("revision", REVISION_ID)],
			kind: "edition",
			created_at: base.created_at,
		}).parentRevisionIds,
		[REVISION_ID],
	);
});

Deno.test("Surreal work row mappers retain complete metadata and omit partial optionals", () => {
	const base = {
		id: WORK_ID,
		created_at: "2026-07-30T00:00:00.000Z",
		updated_at: "2026-07-30T00:01:00.000Z",
		deleted_at: null,
	};
	const cases = [
		{
			name: "complete stub and merge provenance",
			row: {
				...base,
				stub: { created_at: base.created_at, created_via: "stub-list", context: "draft" },
				merged_into_work: new RecordId("work", PARENT_ID),
				merged_at: base.updated_at,
			},
			expected: {
				stub: {
					createdAt: base.created_at,
					createdVia: "stub-list" as const,
					context: "draft",
				},
				mergedIntoWorkId: PARENT_ID,
				mergedAt: base.updated_at,
			},
		},
		{
			name: "partial stub is omitted",
			row: { ...base, stub: { created_via: "stub-list" } },
			expected: {},
		},
	];

	for (const testCase of cases) {
		const work = workFromRow(testCase.row);
		assertEquals(work.stub, testCase.expected.stub, testCase.name);
		assertEquals(work.mergedIntoWorkId, testCase.expected.mergedIntoWorkId, testCase.name);
		assertEquals(work.mergedAt, testCase.expected.mergedAt, testCase.name);
	}
	assertEquals(workStubFromRow({ ...base, stub: [] }), undefined);
	assertEquals(snapshotProtectionFromRow({}), undefined);
	assertEquals(
		snapshotProtectionFromRow({
			protection_reason: "revision-source",
			protected_at: base.created_at,
			protection_expires_at: null,
		}),
		{ reason: "revision-source", protectedAt: base.created_at },
	);
});
