import { assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { SurrealWorkRepository } from "./surreal_work_repository.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";

class RecordingQueryClient implements SurrealQueryClient {
	readonly calls: Array<{ statement: string; variables?: Record<string, unknown> }> = [];

	query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
		this.calls.push({ statement, variables });
		if (statement.includes("FROM work")) {
			return Promise.resolve([[
				{
					id: WORK_ID,
					created_at: "2026-08-09T00:00:00.000Z",
					updated_at: "2026-08-09T00:00:00.000Z",
					deleted_at: null,
				},
			]] as T);
		}
		return Promise.resolve([[]] as T);
	}
}

function repository(client: SurrealQueryClient): SurrealWorkRepository {
	return new SurrealWorkRepository(
		client,
		{
			listBranches: () => Promise.resolve([]),
			listWorkingCopies: () => Promise.resolve([]),
			listOccurrences: () => Promise.resolve([]),
		},
		{ listLinks: () => Promise.resolve([]) },
		{ listAliases: () => Promise.resolve([]) },
	);
}

Deno.test("SurrealWorkRepository maps Work rows behind its query boundary", async () => {
	const client = new RecordingQueryClient();
	const works = await repository(client).listWorks();

	assertEquals(works.map((work) => work.id), [WORK_ID]);
	assertStringIncludes(client.calls[0].statement, "FROM work");
});

Deno.test("SurrealWorkRepository persists Work variables behind its query boundary", async () => {
	const client = new RecordingQueryClient();
	await repository(client).trashWork(WORK_ID, "2026-08-09T12:00:00.000Z");

	const call = client.calls[0];
	assertStringIncludes(call.statement, "SET deleted_at = $deletedAt");
	assertInstanceOf(call.variables?.work, RecordId);
	assertEquals(String((call.variables?.work as RecordId).id), WORK_ID);
});
