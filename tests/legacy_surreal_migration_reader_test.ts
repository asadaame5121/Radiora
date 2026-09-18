import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
	buildExportQueries,
	parseSurrealSqlResponse,
	readLegacySurrealSnapshot,
	type SurrealSqlStatementResult,
} from "../src/storage/legacy_surreal_migration_reader.ts";

const CREATED_AT = "2026-08-01T00:00:00.000Z";

Deno.test("buildExportQueries contains all required tables for GraphStateSnapshot", () => {
	const query = buildExportQueries();
	const expectedTables = [
		"work",
		"branch",
		"working_copy",
		"occurrence",
		"semantic_link",
		"system_relation",
		"knot",
		"search_alias",
		"emergence_feedback",
		"emergence_suggestion",
		"saved_rule_query",
		"purge_manifest",
		"revision",
		"recovery_snapshot",
		"bookmark",
		"resume_position",
	];
	for (const table of expectedTables) {
		assertEquals(query.includes(`FROM ${table}`), true, `Query must include table: ${table}`);
	}
});

Deno.test("parseSurrealSqlResponse correctly transforms Surreal HTTP rows into GraphStateSnapshot", () => {
	const mockResponses: SurrealSqlStatementResult[] = [
		// 0: work
		{
			status: "OK",
			result: [{
				id: "11111111-1111-4111-8111-111111111111",
				created_at: CREATED_AT,
				updated_at: CREATED_AT,
				deleted_at: null,
			}],
		},
		// 1: branch
		{
			status: "OK",
			result: [{
				id: "22222222-2222-4222-8222-222222222222",
				work_id: "11111111-1111-4111-8111-111111111111",
				name: "main",
				head_revision: null,
				created_at: CREATED_AT,
			}],
		},
		// 2: working_copy
		{
			status: "OK",
			result: [{
				branch_id: "22222222-2222-4222-8222-222222222222",
				work_id: "11111111-1111-4111-8111-111111111111",
				text: "Migrated legacy text",
				updated_at: CREATED_AT,
			}],
		},
		// 3: occurrence
		{
			status: "OK",
			result: [{
				id: "33333333-3333-4333-8333-333333333333",
				work_id: "11111111-1111-4111-8111-111111111111",
				parent_occurrence_id: null,
				order_key: 1000,
				collapsed: false,
				branch_id: "22222222-2222-4222-8222-222222222222",
			}],
		},
		// 4: semantic_link
		{ status: "OK", result: [] },
		// 5: system_relation
		{ status: "OK", result: [] },
		// 6: knot
		{ status: "OK", result: [] },
		// 7: search_alias
		{ status: "OK", result: [] },
		// 8: emergence_feedback
		{ status: "OK", result: [{ id: "fb-1", action: "accept" }] },
		// 9: emergence_suggestion
		{ status: "OK", result: [] },
		// 10: saved_rule_query
		{ status: "OK", result: [] },
		// 11: purge_manifest
		{ status: "OK", result: [] },
		// 12: revision
		{ status: "OK", result: [] },
		// 13: recovery_snapshot
		{ status: "OK", result: [] },
		// 14: bookmark
		{ status: "OK", result: [] },
		// 15: resume_position
		{
			status: "OK",
			result: [{
				work_id: "11111111-1111-4111-8111-111111111111",
				occurrence_id: "33333333-3333-4333-8333-333333333333",
				caret_offset: 42,
				updated_at: CREATED_AT,
			}],
		},
	];

	const snapshot = parseSurrealSqlResponse(mockResponses);
	assertEquals(snapshot.works.length, 1);
	assertEquals(snapshot.works[0].id, "11111111-1111-4111-8111-111111111111");
	assertEquals(snapshot.branches.length, 1);
	assertEquals(snapshot.workingCopies.length, 1);
	assertEquals(snapshot.workingCopies[0].text, "Migrated legacy text");
	assertEquals(snapshot.occurrences.length, 1);
	assertEquals(snapshot.emergenceFeedback["fb-1"], "accept");
	assertEquals(snapshot.resumePosition?.caretOffset, 42);
});

Deno.test("readLegacySurrealSnapshot throws descriptive error when response is not OK", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () =>
		Promise.resolve(
			new Response(JSON.stringify([{ status: "ERR", result: "Namespace not found" }]), {
				status: 400,
			}),
		);
	try {
		await assertRejects(
			() => readLegacySurrealSnapshot("http://127.0.0.1:9999"),
			Error,
			"SurrealDB query failed",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
