import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { SurrealRevisionRepository } from "./surreal_revision_repository.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const BRANCH_ID = "b48c2e55-6d3a-4f8b-9e1a-7c3d5f8a2b6e";

Deno.test("SurrealRevisionRepository owns Branch row mapping", async () => {
	let statement = "";
	const db: SurrealQueryClient = {
		query: <T>(nextStatement: string) => {
			statement = nextStatement;
			return Promise.resolve([[
				{
					id: BRANCH_ID,
					work_id: WORK_ID,
					name: "main",
					head_revision: null,
					created_at: "2026-08-09T00:00:00.000Z",
					promoted_at: null,
					archived_at: null,
				},
			]] as T);
		},
	};

	const branches = await new SurrealRevisionRepository(db).listBranches(WORK_ID);

	assertStringIncludes(statement, "FROM branch");
	assertEquals(branches[0].id, BRANCH_ID);
	assertEquals(branches[0].workId, WORK_ID);
});
