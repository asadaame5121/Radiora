import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { RecordId } from "surrealdb";
import type { OutlineItem, SearchAlias } from "../domain/models.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";
import { SurrealDiscoveryRepository } from "./surreal_discovery_repository.ts";

function item(id: string, workId: string, text: string, updatedAt: string): OutlineItem {
	return {
		id,
		workId,
		text,
		parentId: null,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "branch-id" },
		createdAt: updatedAt,
		updatedAt,
	};
}

function mockQueryClient(
	responses: unknown[] = [],
): {
	client: SurrealQueryClient;
	calls: { statement: string; variables?: Record<string, unknown> }[];
} {
	const calls: { statement: string; variables?: Record<string, unknown> }[] = [];
	const client: SurrealQueryClient = {
		query: async <T>(statement: string, variables?: Record<string, unknown>) => {
			calls.push({ statement, variables });
			return (responses.shift() ?? [[]]) as T;
		},
	};
	return { client, calls };
}

const alias: SearchAlias = {
	id: "alias-id",
	canonical: "canonical",
	variants: ["variant"],
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
};

Deno.test("suggestItems and searchLexical use the injected outline loader", async () => {
	const { client, calls } = mockQueryClient();
	let loads = 0;
	const repository = new SurrealDiscoveryRepository(client, async () => {
		loads++;
		return [
			item("item-a", "work-a", "Alpha body", "2026-01-01T00:00:00.000Z"),
			item("item-a-duplicate", "work-a", "Alpha duplicate", "2026-01-03T00:00:00.000Z"),
			item("item-b", "work-b", "Beta body", "2026-01-02T00:00:00.000Z"),
		];
	});

	assertEquals((await repository.suggestItems(" alp ", 8)).map((entry) => entry.id), ["item-a"]);
	assertEquals((await repository.searchLexical("beta", 8)).map((hit) => hit.item.id), ["item-b"]);
	assertEquals(loads, 2);
	assertEquals(calls, []);
});

Deno.test("alias operations preserve SQL boundaries and Surreal record ids", async () => {
	const { client, calls } = mockQueryClient([[[{
		id: "alias-id",
		canonical: "canonical",
		variants: ["variant"],
		created_at: alias.createdAt,
		updated_at: alias.updatedAt,
	}]]]);
	const repository = new SurrealDiscoveryRepository(client, async () => []);

	assertEquals(await repository.listAliases(), [alias]);
	await repository.upsertAlias(alias);
	await repository.deleteAlias(alias.id);

	assertEquals(calls.length, 3);
	assertEquals(calls[0].statement.includes("FROM search_alias ORDER BY canonical"), true);
	assertEquals(calls[1].variables?.record, new RecordId("search_alias", alias.id));
	assertEquals(calls[2].variables, { record: new RecordId("search_alias", alias.id) });
});

Deno.test("emergence feedback and saved rule queries map rows and write scoped records", async () => {
	const { client, calls } = mockQueryClient([
		[[{ action: "pin" }]],
		[[]],
		[[{
			id: "query-id",
			name: "Recent",
			source: "SELECT * FROM work",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-02T00:00:00.000Z",
		}]],
	]);
	const repository = new SurrealDiscoveryRepository(client, async () => []);

	assertEquals(await repository.getEmergenceFeedback("suggestion-id"), "pin");
	await repository.setEmergenceFeedback("suggestion-id", "accept");
	assertEquals((await repository.listSavedRuleQueries())[0].name, "Recent");
	await repository.upsertSavedRuleQuery({
		id: "query-id",
		name: "Recent",
		source: "SELECT * FROM work",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
	});
	await repository.deleteSavedRuleQuery("query-id");

	assertEquals(calls[0].variables, { record: new RecordId("emergence_feedback", "suggestion-id") });
	assertEquals(calls[1].variables?.record, new RecordId("emergence_feedback", "suggestion-id"));
	assertEquals(calls[3].variables?.record, new RecordId("saved_rule_query", "query-id"));
	assertEquals(calls[4].variables, { record: new RecordId("saved_rule_query", "query-id") });
});

Deno.test("resolveEmergenceSuggestion preserves validation and query variants", async () => {
	const { client, calls } = mockQueryClient();
	const repository = new SurrealDiscoveryRepository(client, async () => []);

	await assertRejects(
		() => repository.resolveEmergenceSuggestion("suggestion-id", "dismiss", undefined, "  "),
		Error,
		"Dismissed emergence suggestion requires a reason",
	);
	await assertRejects(
		() => repository.resolveEmergenceSuggestion("suggestion-id", "accept"),
		Error,
		"Accepted emergence suggestion requires an asserted suggestion link",
	);

	await repository.resolveEmergenceSuggestion("suggestion-id", "dismiss", undefined, "not a fit");
	assertEquals(calls.length, 1);
	assertEquals(calls[0].statement.includes('status = "dismissed"'), false);
	assertEquals(calls[0].variables?.status, "dismissed");
	assertEquals(calls[0].variables?.reason, "not a fit");
});
