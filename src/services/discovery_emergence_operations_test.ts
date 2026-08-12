import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DiscoveryOperations } from "./discovery_operations.ts";
import { addDiscoveryTestLink, addDiscoveryTestWork } from "./discovery_operations_test_support.ts";

Deno.test("emergence contract: listing materializes a suggestion and acceptance asserts its link", async () => {
	const store = new MemoryGraphStore();
	const context = await addDiscoveryTestWork(store, "context", "Context");
	await addDiscoveryTestWork(store, "target", "Target");
	await addDiscoveryTestWork(store, "middle-a", "Middle A");
	await addDiscoveryTestWork(store, "middle-b", "Middle B");
	await addDiscoveryTestLink(store, "context", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "context", "middle-b", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-b", "LIKE");
	const operations = new DiscoveryOperations(store);

	const suggestion = (await operations.listEmergenceSuggestions(context.id)).find((entry) =>
		entry.targetWorkId === "target"
	);
	assert(suggestion);
	assertEquals(
		(await store.listEmergenceSuggestions()).some((entry) => entry.id === suggestion.id),
		true,
	);
	await operations.resolveEmergenceSuggestion(suggestion.id, "accept", "確認済み");
	const accepted = (await store.listLinks()).find((link) => link.origin === "suggestion");
	assertEquals(accepted?.status, "asserted");
	assertEquals(accepted?.reason, suggestion.explanation);
});

Deno.test("emergence contract: productive tension suggests a conservative RELATED link", async () => {
	const store = new MemoryGraphStore();
	const context = await addDiscoveryTestWork(store, "context", "Context");
	await addDiscoveryTestWork(store, "middle", "Middle");
	await addDiscoveryTestWork(store, "target", "Target");
	await addDiscoveryTestLink(store, "context", "middle", "LIKE");
	await addDiscoveryTestLink(store, "middle", "target", "VS");
	const operations = new DiscoveryOperations(store);

	const suggestion = (await operations.listEmergenceSuggestions(context.id)).find((entry) =>
		entry.kind === "productive-tension" && entry.targetWorkId === "target"
	);
	assert(suggestion);
	assertEquals(suggestion.proposedLinkType, "RELATED");

	await operations.resolveEmergenceSuggestion(suggestion.id, "accept", "関係を確認");
	const accepted = (await store.listLinks()).find((link) => link.origin === "suggestion");
	assertEquals(accepted?.type, "RELATED");
});

Deno.test("emergence contract: missing contexts and stale resolutions do not mutate persistence", async () => {
	const store = new MemoryGraphStore();
	const operations = new DiscoveryOperations(store);

	assertEquals(await operations.listEmergenceSuggestions("missing"), []);
	assertEquals(await store.listEmergenceSuggestions(), []);
	await assertRejects(
		() => operations.resolveEmergenceSuggestion("stale", "accept"),
		Error,
		"提案が古くなりました。再読み込みしてください。",
	);
	assertEquals(await store.listLinks(), []);
});
