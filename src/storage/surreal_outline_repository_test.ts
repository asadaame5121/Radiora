import { assertEquals } from "jsr:@std/assert@1";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { SurrealOutlineRepository } from "./surreal_outline_repository.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const OCCURRENCE_ID = "d7f9a1c3-2e4b-4d6a-8c0e-1f3a5b7c9d2e";
const BRANCH_ID = "b48c2e55-6d3a-4f8b-9e1a-7c3d5f8a2b6e";

const db: SurrealQueryClient = {
	query: <T>() =>
		Promise.resolve([[
			{
				id: OCCURRENCE_ID,
				work_id: WORK_ID,
				parent_occurrence: null,
				order_key: 1024,
				collapsed: false,
				selector_mode: "branch",
				branch: BRANCH_ID,
				revision: null,
				contextual_heading: null,
			},
		]] as T),
};

Deno.test("SurrealOutlineRepository composes navigation rows with Work content", async () => {
	const repository = new SurrealOutlineRepository(db, {
		listWorks: () =>
			Promise.resolve([{
				id: WORK_ID,
				createdAt: "2026-08-09T00:00:00.000Z",
				updatedAt: "2026-08-09T01:00:00.000Z",
			}]),
		listWorkingCopies: () =>
			Promise.resolve([{
				workId: WORK_ID,
				branchId: BRANCH_ID,
				text: "owned by the Work repository",
				updatedAt: "2026-08-09T01:00:00.000Z",
			}]),
		listRevisions: () => Promise.resolve([]),
	});

	const items = await repository.listItems();

	assertEquals(items[0].id, OCCURRENCE_ID);
	assertEquals(items[0].text, "owned by the Work repository");
});
