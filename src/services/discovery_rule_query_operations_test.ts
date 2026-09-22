import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DiscoveryOperations } from "./discovery_operations.ts";
import {
	addDiscoveryTestLink,
	addDiscoveryTestWork,
	DISCOVERY_TEST_NOW,
} from "./discovery_operations_test_support.ts";

Deno.test("rule-query contract: a saved query validates, executes, and projects without persisting nodes", async () => {
	const store = new MemoryGraphStore();
	const alpha = await addDiscoveryTestWork(store, "alpha", "Alpha");
	const beta = await addDiscoveryTestWork(store, "beta", "Beta");
	await addDiscoveryTestLink(store, "alpha", "beta", "RELATED");
	const operations = new DiscoveryOperations(store);
	const saved = await operations.saveRuleQuery({
		name: " 関係 ",
		source: "?- link(RELATED, A, B).",
	});
	const itemCountBeforeProjection = (await store.listItems()).length;

	const projection = await operations.buildQueryProjectionNodes(saved.id);
	assertEquals(saved.name, "関係");
	assertEquals(projection.result.rows, [["RELATED", alpha.id, beta.id]]);
	assert(projection.nodes.some((node) => node.occurrenceId === alpha.id));
	assert(projection.nodes.some((node) => node.occurrenceId === beta.id));
	assertEquals((await store.listItems()).length, itemCountBeforeProjection);
});

Deno.test("rule-query contract: query evaluates implicit FROM links from outline hierarchy", async () => {
	const store = new MemoryGraphStore();
	const parent = await addDiscoveryTestWork(store, "p-work", "Parent Work");
	// create child work with parentOccurrenceId pointing to parent
	const childWork = { id: "c-work", createdAt: DISCOVERY_TEST_NOW, updatedAt: DISCOVERY_TEST_NOW };
	const childBranch = {
		id: "c-work-main",
		workId: "c-work",
		name: "main",
		headRevisionId: null,
		createdAt: DISCOVERY_TEST_NOW,
	};
	const childCopy = {
		branchId: childBranch.id,
		workId: "c-work",
		text: "Child Work",
		updatedAt: DISCOVERY_TEST_NOW,
	};
	const childOcc = {
		id: "c-work-occ",
		workId: "c-work",
		parentOccurrenceId: parent.id,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch" as const, branchId: childBranch.id },
	};
	await store.createWorkBundle(childWork, childBranch, childCopy, childOcc);

	const operations = new DiscoveryOperations(store);
	const result = await operations.runRuleQuery("?- link(FROM, A, B).");
	assertEquals(result.rows, [["FROM", parent.id, childOcc.id]]);
});

Deno.test("rule-query contract: invalid source and missing saved query fail without persistence", async () => {
	const store = new MemoryGraphStore();
	const operations = new DiscoveryOperations(store);

	await assertRejects(
		() => operations.saveRuleQuery({ name: "bad", source: "item(A)" }),
		SyntaxError,
	);
	assertEquals(await store.listSavedRuleQueries(), []);
	await assertRejects(
		() => operations.buildQueryProjectionNodes("missing"),
		Error,
		"Saved Rule Query not found",
	);
	assertEquals(await store.listSavedRuleQueries(), []);
});

Deno.test("rule-query contract: representative occurrence order selects first occurrence of work", async () => {
	const store = new MemoryGraphStore();
	const multiFirst = await addDiscoveryTestWork(store, "work-multi", "Multi First");
	// Add second occurrence for the same work
	await store.createOccurrence({
		id: "work-multi-occ-second",
		workId: "work-multi",
		parentOccurrenceId: null,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "work-multi-main" },
	});
	const target = await addDiscoveryTestWork(store, "work-target", "Target");
	await addDiscoveryTestLink(store, "work-multi", "work-target", "RELATED");

	const operations = new DiscoveryOperations(store);
	const result = await operations.runRuleQuery("?- link(RELATED, From, To).");
	// Must select the first occurrence id of work-multi, not the second
	assertEquals(result.rows, [["RELATED", multiFirst.id, target.id]]);
});

Deno.test("rule-query contract: links referencing missing works are safely omitted", async () => {
	const store = new MemoryGraphStore();
	const validA = await addDiscoveryTestWork(store, "valid-a", "Valid A");
	const validB = await addDiscoveryTestWork(store, "valid-b", "Valid B");
	await addDiscoveryTestLink(store, "valid-a", "valid-b", "RELATED");
	// Link with a non-existent work endpoint
	await addDiscoveryTestLink(store, "valid-a", "ghost-work", "RELATED");
	await addDiscoveryTestLink(store, "ghost-work", "valid-b", "RELATED");

	const operations = new DiscoveryOperations(store);
	const result = await operations.runRuleQuery("?- link(RELATED, From, To).");
	assertEquals(result.rows, [["RELATED", validA.id, validB.id]]);
});

Deno.test("rule-query contract: limit parameter clamps result rows and clamps non-positive to 1", async () => {
	const store = new MemoryGraphStore();
	await addDiscoveryTestWork(store, "node-a", "A");
	await addDiscoveryTestWork(store, "node-b", "B");
	await addDiscoveryTestWork(store, "node-c", "C");
	await addDiscoveryTestLink(store, "node-a", "node-b", "RELATED");
	await addDiscoveryTestLink(store, "node-b", "node-c", "RELATED");

	const operations = new DiscoveryOperations(store);
	const resultAll = await operations.runRuleQuery("?- link(RELATED, X, Y).", 10);
	assertEquals(resultAll.rows.length, 2);

	const resultLimit1 = await operations.runRuleQuery("?- link(RELATED, X, Y).", 1);
	assertEquals(resultLimit1.rows.length, 1);

	// Limit <= 0 is clamped to 1
	const resultLimitZero = await operations.runRuleQuery("?- link(RELATED, X, Y).", 0);
	assertEquals(resultLimitZero.rows.length, 1);
});

Deno.test("rule-query contract: deductive rules and built-in predicates evaluate transitive relationships", async () => {
	const store = new MemoryGraphStore();
	const node1 = await addDiscoveryTestWork(store, "n1", "Node 1");
	const node2 = await addDiscoveryTestWork(store, "n2", "Node 2");
	const node3 = await addDiscoveryTestWork(store, "n3", "Node 3");
	await addDiscoveryTestLink(store, "n1", "n2", "RELATED");
	await addDiscoveryTestLink(store, "n2", "n3", "RELATED");

	const operations = new DiscoveryOperations(store);
	// Multi-hop transitive deduction and title_prefix built-in
	const querySource = `
		path(X, Y) :- link(RELATED, X, Y).
		path(X, Z) :- link(RELATED, X, Y), path(Y, Z).
		?- path(A, C), title_prefix(A, "Node 1").
	`;
	const result = await operations.runRuleQuery(querySource);
	assertEquals(result.columns, ["A", "C"]);
	// Should derive path from n1 to n2, and transitive path from n1 to n3
	assertEquals(result.rows, [
		[node1.id, node2.id],
		[node1.id, node3.id],
	]);
});

Deno.test("rule-query contract: saveRuleQuery normalizes names and preserves creation timestamp on update", async () => {
	const store = new MemoryGraphStore();
	await addDiscoveryTestWork(store, "w1", "Work 1");
	const operations = new DiscoveryOperations(store);

	// Empty name falls back to "名称未設定"
	const emptyNamed = await operations.saveRuleQuery({
		name: "   ",
		source: "?- item(A).",
	});
	assertEquals(emptyNamed.name, "名称未設定");
	assertEquals(emptyNamed.createdAt, emptyNamed.updatedAt);

	// Whitespace trimming
	const trimmed = await operations.saveRuleQuery({
		name: "  Trimmed Query  ",
		source: "?- item(A).",
	});
	assertEquals(trimmed.name, "Trimmed Query");

	// Update preserves original createdAt
	const originalCreatedAt = trimmed.createdAt;
	const updated = await operations.saveRuleQuery({
		id: trimmed.id,
		name: "Updated Query",
		source: "?- item(A).",
	});
	assertEquals(updated.id, trimmed.id);
	assertEquals(updated.name, "Updated Query");
	assertEquals(updated.createdAt, originalCreatedAt);
	assert(updated.updatedAt >= originalCreatedAt);
});

Deno.test("rule-query contract: deleteRuleQuery removes query and is idempotent for missing ids", async () => {
	const store = new MemoryGraphStore();
	await addDiscoveryTestWork(store, "w1", "Work 1");
	const operations = new DiscoveryOperations(store);

	const saved = await operations.saveRuleQuery({
		name: "To Delete",
		source: "?- item(A).",
	});
	assertEquals((await operations.listSavedRuleQueries()).length, 1);

	await operations.deleteRuleQuery(saved.id);
	assertEquals(await operations.listSavedRuleQueries(), []);

	// Deleting a non-existent id should not throw
	await operations.deleteRuleQuery("non-existent-id");
	assertEquals(await operations.listSavedRuleQueries(), []);
});

Deno.test("rule-query contract: buildQueryProjectionNodes deduplicates cells, ignores unresolvable items, and applies limits", async () => {
	const store = new MemoryGraphStore();
	const root = await addDiscoveryTestWork(store, "root", "Root Work");
	// Create child under root
	const childWork = { id: "child", createdAt: DISCOVERY_TEST_NOW, updatedAt: DISCOVERY_TEST_NOW };
	const childBranch = {
		id: "child-main",
		workId: "child",
		name: "main",
		headRevisionId: null,
		createdAt: DISCOVERY_TEST_NOW,
	};
	const childCopy = {
		branchId: childBranch.id,
		workId: "child",
		text: "Child Work",
		updatedAt: DISCOVERY_TEST_NOW,
	};
	const childOcc = {
		id: "child-occ",
		workId: "child",
		parentOccurrenceId: root.id,
		orderKey: 2048,
		collapsed: false,
		revisionSelector: { mode: "branch" as const, branchId: childBranch.id },
	};
	await store.createWorkBundle(childWork, childBranch, childCopy, childOcc);

	const operations = new DiscoveryOperations(store);
	// Query returning same occurrence in multiple columns or constants that don't match items
	const saved = await operations.saveRuleQuery({
		name: "Duplicate and Constant Cells",
		source: "?- link(FROM, A, B).",
	});

	const itemsBefore = await store.listItems();
	const linksBefore = await store.listLinks();

	const projection = await operations.buildQueryProjectionNodes(saved.id, 50);
	// Result contains parent and child
	assertEquals(projection.result.rows, [["FROM", root.id, childOcc.id]]);
	// Nodes should contain projected occurrences without duplicate node entries
	const occurrenceIds = projection.nodes.map((n) => n.occurrenceId);
	const uniqueOccurrenceIds = new Set(occurrenceIds);
	assertEquals(occurrenceIds.length, uniqueOccurrenceIds.size);

	// Verify zero side-effects on store
	assertEquals(await store.listItems(), itemsBefore);
	assertEquals(await store.listLinks(), linksBefore);
});
