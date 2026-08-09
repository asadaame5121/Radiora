import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { GraphStateSnapshot, GraphStore } from "./graph_store.ts";
import { SurrealBackupRepository } from "./surreal_backup_repository.ts";
import type { SurrealQueryClient } from "./surreal_connection.ts";

const EMPTY_STATE: GraphStateSnapshot = {
	works: [],
	branches: [],
	workingCopies: [],
	occurrences: [],
	links: [],
	systemRelations: [],
	knots: [],
	aliases: [],
	emergenceFeedback: {},
	emergenceSuggestions: [],
	savedRuleQueries: [],
	purgeManifests: [],
	revisions: [],
	recoverySnapshots: [],
	bookmarks: [],
	resumePosition: null,
};

Deno.test("SurrealBackupRepository owns validated restore execution", async () => {
	let statement = "";
	let variables: Record<string, unknown> | undefined;
	const db: SurrealQueryClient = {
		query: <T>(nextStatement: string, nextVariables?: Record<string, unknown>) => {
			statement = nextStatement;
			variables = nextVariables;
			return Promise.resolve([] as T);
		},
	};
	const repository = new SurrealBackupRepository(
		db,
		() => ({}) as GraphStore,
	);

	await repository.restoreGraphState(EMPTY_STATE);

	assertStringIncludes(statement, "BEGIN TRANSACTION");
	assertStringIncludes(statement, "DELETE work");
	assertEquals(variables !== undefined, true);
});
