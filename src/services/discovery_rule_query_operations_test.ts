import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DiscoveryOperations } from "./discovery_operations.ts";
import { addDiscoveryTestLink, addDiscoveryTestWork } from "./discovery_operations_test_support.ts";

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
