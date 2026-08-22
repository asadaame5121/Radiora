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
