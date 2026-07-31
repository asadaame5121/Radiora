import { assert, assertEquals } from "jsr:@std/assert@1";
import type { GraphStateSnapshot } from "./graph_store.ts";
import { buildSurrealRestoreTransaction } from "./surreal_backup_restore.ts";

const emptyState = (): GraphStateSnapshot => ({
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
});

Deno.test("Surreal backup restore deletes and recreates data in one transaction", () => {
	const state = emptyState();
	state.works.push({
		id: "work-1",
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
	});
	const { query, variables } = buildSurrealRestoreTransaction(state);
	assert(query.startsWith("BEGIN TRANSACTION;"));
	assert(query.endsWith("COMMIT TRANSACTION;"));
	assertEquals(query.match(/BEGIN TRANSACTION;/g)?.length, 1);
	assertEquals(query.match(/COMMIT TRANSACTION;/g)?.length, 1);
	for (
		const table of [
			"work",
			"branch",
			"revision",
			"recovery_snapshot",
			"occurrence",
			"semantic_link",
			"emergence_suggestion",
		]
	) {
		assert(query.includes(`DELETE ${table};`));
	}
	assert(query.includes("CREATE $restoreRecord0 CONTENT $restoreContent0;"));
	assertEquals(Object.keys(variables).sort(), ["restoreContent0", "restoreRecord0"]);
});
