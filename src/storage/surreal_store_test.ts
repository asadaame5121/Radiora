import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { evolvedFromEndpoints, itemFromRow } from "./surreal_store.ts";

const ITEM_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const PARENT_ID = "a3744669-9419-4edb-ab06-09f397c18932";

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

Deno.test("FROM persists from parent in-endpoint to child out-endpoint", () => {
	assertEquals(evolvedFromEndpoints(PARENT_ID, ITEM_ID), {
		inId: PARENT_ID,
		outId: ITEM_ID,
	});
});
