import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { SearchOperations } from "./search_operations.ts";
import { addDiscoveryTestWork, DISCOVERY_TEST_NOW } from "./discovery_operations_test_support.ts";

Deno.test("search contract: aliases expand results while reserved tag aliases stay isolated", async () => {
	const store = new MemoryGraphStore();
	await addDiscoveryTestWork(store, "alpha", "Alpha\n\n本文");
	await addDiscoveryTestWork(store, "beta", "Beta\n\n別名の本文");
	const operations = new SearchOperations(store);
	await operations.saveSearchAlias({ canonical: "alpha", variants: ["別名"] });
	await store.upsertAlias({
		id: "tag",
		canonical: "#tag",
		variants: ["#タグ"],
		createdAt: DISCOVERY_TEST_NOW,
		updatedAt: DISCOVERY_TEST_NOW,
	});

	const results = await operations.searchItems("alpha");
	assert(
		results.some((result) =>
			result.item.workId === "beta" && result.reasons.some((reason) => reason.kind === "alias")
		),
	);
	assertEquals((await operations.listSearchAliases()).map((alias) => alias.id).length, 1);
});

Deno.test("search contract: invalid and empty alias input has no persistence side effect", async () => {
	const store = new MemoryGraphStore();
	const operations = new SearchOperations(store);

	assertEquals(await operations.searchItems(" \n "), []);
	await assertRejects(
		() => operations.saveSearchAlias({ canonical: "#tag", variants: ["#タグ"] }),
		Error,
		"タグの改名・統合にはタグ管理を使用してください。",
	);
	await assertRejects(
		() => operations.saveSearchAlias({ canonical: "same", variants: [" same "] }),
		Error,
		"別名には基準語と1件以上の異なる表記が必要です。",
	);
	assertEquals(await store.listAliases(), []);
});
