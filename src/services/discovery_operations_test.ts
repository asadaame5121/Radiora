import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { Branch, Occurrence, OutlineLink, Work, WorkingCopy } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { DiscoveryOperations } from "./discovery_operations.ts";

const NOW = "2026-07-30T12:00:00.000Z";

async function addWork(store: MemoryGraphStore, id: string, text: string) {
	const work: Work = { id, createdAt: NOW, updatedAt: NOW };
	const branch: Branch = {
		id: `${id}-main`,
		workId: id,
		name: "main",
		headRevisionId: null,
		createdAt: NOW,
	};
	const copy: WorkingCopy = { branchId: branch.id, workId: id, text, updatedAt: NOW };
	const occurrence: Occurrence = {
		id: `${id}-occ`,
		workId: id,
		parentOccurrenceId: null,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: branch.id },
	};
	await store.createWorkBundle(work, branch, copy, occurrence);
	return occurrence;
}

async function addLink(
	store: MemoryGraphStore,
	fromId: string,
	toId: string,
	type: OutlineLink["type"],
): Promise<void> {
	await store.createLink({
		id: `${fromId}-${toId}-${type}`,
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type,
		status: "asserted",
		origin: "human",
		createdAt: NOW,
	});
}

Deno.test("DiscoveryOperations searches aliases without exposing reserved tag aliases", async () => {
	const store = new MemoryGraphStore();
	await addWork(store, "alpha", "Alpha\n\n本文");
	await addWork(store, "beta", "Beta\n\n別名の本文");
	const operations = new DiscoveryOperations(store);
	await operations.saveSearchAlias({ canonical: "alpha", variants: ["別名"] });
	await store.upsertAlias({
		id: "tag",
		canonical: "#tag",
		variants: ["#タグ"],
		createdAt: NOW,
		updatedAt: NOW,
	});

	const results = await operations.searchItems("alpha");
	assert(
		results.some((result) =>
			result.item.workId === "beta" && result.reasons.some((reason) => reason.kind === "alias")
		),
	);
	assertEquals((await operations.listSearchAliases()).map((alias) => alias.id).length, 1);
	await assertRejects(
		() => operations.saveSearchAlias({ canonical: "#tag", variants: ["#タグ"] }),
		Error,
		"タグの改名・統合にはタグ管理を使用してください。",
	);
});

Deno.test("DiscoveryOperations materializes and accepts an emergence suggestion through its own cache", async () => {
	const store = new MemoryGraphStore();
	const context = await addWork(store, "context", "Context");
	await addWork(store, "target", "Target");
	await addWork(store, "middle-a", "Middle A");
	await addWork(store, "middle-b", "Middle B");
	await addLink(store, "context", "middle-a", "LIKE");
	await addLink(store, "context", "middle-b", "LIKE");
	await addLink(store, "target", "middle-a", "LIKE");
	await addLink(store, "target", "middle-b", "LIKE");
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

Deno.test("DiscoveryOperations accepts productive tension as a conservative RELATED link", async () => {
	const store = new MemoryGraphStore();
	const context = await addWork(store, "context", "Context");
	await addWork(store, "middle", "Middle");
	await addWork(store, "target", "Target");
	await addLink(store, "context", "middle", "LIKE");
	await addLink(store, "middle", "target", "VS");
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

Deno.test("DiscoveryOperations validates, saves, and projects rule-query results without persistence", async () => {
	const store = new MemoryGraphStore();
	const alpha = await addWork(store, "alpha", "Alpha");
	const beta = await addWork(store, "beta", "Beta");
	await addLink(store, "alpha", "beta", "RELATED");
	const operations = new DiscoveryOperations(store);
	const saved = await operations.saveRuleQuery({
		name: " 関係 ",
		source: "?- link(RELATED, A, B).",
	});

	const projection = await operations.buildQueryProjectionNodes(saved.id);
	assertEquals(saved.name, "関係");
	assertEquals(projection.result.rows, [["RELATED", alpha.id, beta.id]]);
	assert(projection.nodes.some((node) => node.occurrenceId === alpha.id));
	assert(projection.nodes.some((node) => node.occurrenceId === beta.id));
	await assertRejects(
		() => operations.saveRuleQuery({ name: "bad", source: "item(A)" }),
		SyntaxError,
	);
});
