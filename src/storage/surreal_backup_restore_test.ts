import { assert, assertEquals } from "jsr:@std/assert@1";
import type { GraphStateSnapshot, GraphStore } from "./graph_store.ts";
import {
	buildSurrealRestoreTransaction,
	exportSurrealGraphState,
} from "./surreal_backup_restore.ts";

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

const WORK_ID = "31a56a11-35ac-4700-9f68-20de9c9d58dc";
const BRANCH_ID = "b48c2e55-6d3a-4f8b-9e1a-7c3d5f8a2b6e";
const OCCURRENCE_ID = "d7f9a1c3-2e4b-4d6a-8c0e-1f3a5b7c9d2e";

Deno.test("exportSurrealGraphState delegates list calls to store and maps auxiliary rows", async () => {
	const state = emptyState();
	state.works.push({
		id: WORK_ID,
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
	});
	const listCalls: string[] = [];
	const mockStore = {
		listWorks: () => {
			listCalls.push("listWorks");
			return Promise.resolve(state.works);
		},
		listBranches: () => {
			listCalls.push("listBranches");
			return Promise.resolve(state.branches);
		},
		listWorkingCopies: () => {
			listCalls.push("listWorkingCopies");
			return Promise.resolve(state.workingCopies);
		},
		listOccurrences: () => {
			listCalls.push("listOccurrences");
			return Promise.resolve(state.occurrences);
		},
		listLinks: () => {
			listCalls.push("listLinks");
			return Promise.resolve(state.links);
		},
		listSystemRelations: () => {
			listCalls.push("listSystemRelations");
			return Promise.resolve(state.systemRelations);
		},
		listKnots: () => {
			listCalls.push("listKnots");
			return Promise.resolve(state.knots);
		},
		listAliases: () => {
			listCalls.push("listAliases");
			return Promise.resolve(state.aliases);
		},
		listEmergenceSuggestions: () => {
			listCalls.push("listEmergenceSuggestions");
			return Promise.resolve(state.emergenceSuggestions);
		},
		listSavedRuleQueries: () => {
			listCalls.push("listSavedRuleQueries");
			return Promise.resolve(state.savedRuleQueries);
		},
		listPurgeManifests: () => {
			listCalls.push("listPurgeManifests");
			return Promise.resolve(state.purgeManifests);
		},
		listRevisions: () => {
			listCalls.push("listRevisions");
			return Promise.resolve(state.revisions);
		},
		listRecoverySnapshots: () => {
			listCalls.push("listRecoverySnapshots");
			return Promise.resolve(state.recoverySnapshots);
		},
	} as unknown as GraphStore;

	const queries: string[] = [];
	const mockDb = {
		query: <T>(q: string): Promise<T> => {
			queries.push(q);
			if (q.includes("bookmark")) {
				return Promise.resolve([[{
					id: "bm-1",
					work_id: WORK_ID,
					occurrence_id: OCCURRENCE_ID,
					created_at: "2026-07-30T00:00:00.000Z",
				}]]) as Promise<T>;
			}
			if (q.includes("resume_position")) {
				return Promise.resolve([[{
					work_id: WORK_ID,
					occurrence_id: OCCURRENCE_ID,
					caret_offset: 42,
					updated_at: "2026-07-30T12:00:00.000Z",
				}]]) as Promise<T>;
			}
			if (q.includes("emergence_feedback")) {
				return Promise.resolve([[
					{ id: "fb-1", action: "accept" },
					{ id: "fb-2", action: "invalid" },
					{ id: "fb-3", action: "pin" },
				]]) as Promise<T>;
			}
			return Promise.resolve([[]]) as Promise<T>;
		},
	};

	const result = await exportSurrealGraphState(mockStore, mockDb);

	assertEquals(listCalls, [
		"listWorks",
		"listBranches",
		"listWorkingCopies",
		"listOccurrences",
		"listLinks",
		"listSystemRelations",
		"listKnots",
		"listAliases",
		"listEmergenceSuggestions",
		"listSavedRuleQueries",
		"listPurgeManifests",
		"listRevisions",
		"listRecoverySnapshots",
	]);
	assertEquals(queries.length, 3);
	assert(queries[0].includes("bookmark"));
	assert(queries[1].includes("resume_position"));
	assert(queries[2].includes("emergence_feedback"));

	assertEquals(result.works, state.works);
	assertEquals(result.bookmarks, [{
		id: "bm-1",
		workId: WORK_ID,
		occurrenceId: OCCURRENCE_ID,
		createdAt: "2026-07-30T00:00:00.000Z",
	}]);
	assertEquals(result.resumePosition, {
		workId: WORK_ID,
		occurrenceId: OCCURRENCE_ID,
		caretOffset: 42,
		updatedAt: "2026-07-30T12:00:00.000Z",
	});
	assertEquals(result.emergenceFeedback, { "fb-1": "accept", "fb-3": "pin" });
});
