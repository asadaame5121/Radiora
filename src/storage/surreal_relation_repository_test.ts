import { assert, assertEquals } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { SurrealRelationRepository } from "./surreal_relation_repository.ts";

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const OTHER_WORK_ID = "b48c2e55-6d3a-4f8b-9e1a-7c3d5f8a2b6e";
const REVISION_ID = "d7f9a1c3-2e4b-4d6a-8c0e-1f3a5b7c9d2e";

type QueryCall = {
	statement: string;
	variables?: Record<string, unknown>;
};

class MockQueryClient implements SurrealQueryClient {
	readonly calls: QueryCall[] = [];
	private responses: unknown[] = [];

	respondWith(...responses: unknown[]): void {
		this.responses.push(...responses);
	}

	async query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
		this.calls.push({ statement, variables });
		return this.responses.shift() as T;
	}
}

Deno.test("SurrealRelationRepository maps relation rows through the query client boundary", async () => {
	const db = new MockQueryClient();
	db.respondWith(
		[[{
			id: "link-1",
			from_scope: "revision",
			from_id: WORK_ID,
			from_revision: new RecordId("revision", REVISION_ID),
			to_scope: "work",
			to_id: OTHER_WORK_ID,
			to_revision: null,
			type: "RELATED",
			status: "asserted",
			origin: "human",
			reason: "contextual",
			created_at: "2026-08-09T00:00:00.000Z",
		}]],
		[[{
			id: "system-1",
			from_id: WORK_ID,
			to_id: OTHER_WORK_ID,
			type: "IN",
			created_at: "2026-08-09T00:00:00.000Z",
		}]],
		[[{ id: "knot-1", cycle_ids: [WORK_ID, OTHER_WORK_ID], created_at: null }]],
	);
	const repository = new SurrealRelationRepository(db);

	assertEquals(await repository.listLinks(), [{
		id: "link-1",
		fromId: WORK_ID,
		toId: OTHER_WORK_ID,
		from: { scope: "revision", workId: WORK_ID, revisionId: REVISION_ID },
		to: { scope: "work", workId: OTHER_WORK_ID },
		type: "RELATED",
		status: "asserted",
		origin: "human",
		createdAt: "2026-08-09T00:00:00.000Z",
		reason: "contextual",
	}]);
	assertEquals(await repository.listSystemRelations(), [{
		id: "system-1",
		fromWorkId: WORK_ID,
		toWorkId: OTHER_WORK_ID,
		type: "IN",
		createdAt: "2026-08-09T00:00:00.000Z",
	}]);
	assertEquals(await repository.listKnots(), [{
		id: "knot-1",
		cycleIds: [WORK_ID, OTHER_WORK_ID],
		createdAt: "",
	}]);
	assertEquals(db.calls.map(({ statement }) => statement), [
		"SELECT record::id(id) AS id, from_scope, record::id(from_work) AS from_id,\n\t\t\t\tfrom_revision, to_scope,\n\t\t\t\trecord::id(to_work) AS to_id, to_revision,\n\t\t\t\ttype, status, origin, reason, created_at FROM semantic_link;",
		"SELECT record::id(id) AS id, record::id(from_work) AS from_id,\n\t\t\t\trecord::id(to_work) AS to_id, type, created_at FROM system_relation;",
		"SELECT record::id(id) AS id, cycle_ids, created_at FROM knot;",
	]);
});

Deno.test("SurrealRelationRepository preserves link write query and scoped RecordId variables", async () => {
	const db = new MockQueryClient();
	const repository = new SurrealRelationRepository(db);
	await repository.createLink({
		id: "link-1",
		fromId: WORK_ID,
		toId: OTHER_WORK_ID,
		from: { scope: "revision", workId: WORK_ID, revisionId: REVISION_ID },
		to: { scope: "work", workId: OTHER_WORK_ID },
		type: "SUPPORT",
		status: "asserted",
		origin: "human",
		createdAt: "2026-08-09T00:00:00.000Z",
		reason: "manual",
	});

	const call = db.calls[0];
	assert(call.statement.includes("CREATE $record CONTENT"));
	assert(call.statement.includes("from_revision: $fromRevision"));
	assert(call.statement.includes("to_revision: NONE"));
	assert(call.statement.includes("reason: $reason"));
	assertEquals(call.variables?.fromScope, "revision");
	assertEquals(call.variables?.toScope, "work");
	assertEquals(call.variables?.type, "SUPPORT");
	assertEquals(call.variables?.reason, "manual");
	assert(String(call.variables?.record).includes("link-1"));
	assert(String(call.variables?.fromWork).includes(WORK_ID));
	assert(String(call.variables?.fromRevision).includes(REVISION_ID));
	assert(String(call.variables?.toWork).includes(OTHER_WORK_ID));
	assertEquals(call.variables?.toRevision, undefined);
});

Deno.test("SurrealRelationRepository preserves link deletion and knot replacement boundaries", async () => {
	const db = new MockQueryClient();
	const repository = new SurrealRelationRepository(db);
	await repository.deleteLink(WORK_ID, OTHER_WORK_ID, "RELATED");
	await repository.replaceKnots([{
		id: "knot-1",
		cycleIds: [WORK_ID, OTHER_WORK_ID],
		createdAt: "2026-08-09T00:00:00.000Z",
	}]);

	assertEquals(db.calls.length, 3);
	assert(db.calls[0].statement.includes("UPDATE semantic_link SET status = $retracted"));
	assertEquals(db.calls[0].variables?.type, "RELATED");
	assertEquals(db.calls[0].variables?.retracted, "retracted");
	assert(String(db.calls[0].variables?.from).includes(WORK_ID));
	assert(String(db.calls[0].variables?.to).includes(OTHER_WORK_ID));
	assertEquals(db.calls[1], { statement: "DELETE knot;", variables: undefined });
	assert(db.calls[2].statement.includes("CREATE $record CONTENT"));
	assertEquals(db.calls[2].variables?.cycleIds, [WORK_ID, OTHER_WORK_ID]);
	assert(String(db.calls[2].variables?.record).includes("knot-1"));
});
