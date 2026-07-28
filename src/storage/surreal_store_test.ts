import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import type { Branch, Revision } from "../domain/models.ts";
import { validateRevisionCreation } from "./graph_store.ts";
import {
	evolvedFromEndpoints,
	itemFromRow,
	occurrenceFromRow,
	revisionFromRow,
} from "./surreal_store.ts";

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
