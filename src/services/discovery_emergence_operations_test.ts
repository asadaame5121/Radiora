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

Deno.test("emergence contract: accepting suggestion with custom symmetric type canonicalizes endpoints", async () => {
	const store = new MemoryGraphStore();
	await store.createRelationTypeDefinition({
		name: "COLLABORATES",
		direction: "symmetric",
		builtIn: false,
		createdAt: "2026-09-01T00:00:00.000Z",
	});

	const operations = new DiscoveryOperations(store);
	const suggestion = {
		id: "sug-custom",
		kind: "latent-relation" as const,
		title: "共同執筆の可能性",
		contextItemId: "occ-z",
		contextWorkId: "z-work",
		targetItemId: "occ-a",
		targetWorkId: "a-work",
		proposedLinkType: "COLLABORATES" as const,
		score: 1,
		explanation: "共同執筆の可能性",
		evidence: [],
		persistenceStatus: "pending" as const,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
	await store.upsertEmergenceSuggestion(suggestion);
	await operations.resolveEmergenceSuggestion(suggestion.id, "accept", "承認");
	const links = await store.listLinks();
	const accepted = links.find((l) => l.origin === "suggestion");
	assert(accepted);
	assertEquals(accepted.fromId, "a-work");
	assertEquals(accepted.toId, "z-work");
});

Deno.test("emergence contract: listing respects limit parameter and ranks suggestions", async () => {
	const store = new MemoryGraphStore();
	const context = await addDiscoveryTestWork(store, "context", "Context Work");
	await addDiscoveryTestWork(store, "middle-a", "Bridge A");
	await addDiscoveryTestWork(store, "middle-b", "Bridge B");
	await addDiscoveryTestWork(store, "middle-c", "Bridge C");
	await addDiscoveryTestWork(store, "target-1", "Target 1");
	await addDiscoveryTestWork(store, "target-2", "Target 2");

	// Context connected to 3 bridges
	await addDiscoveryTestLink(store, "context", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "context", "middle-b", "LIKE");
	await addDiscoveryTestLink(store, "context", "middle-c", "LIKE");

	// Target-1 connected to 3 bridges (shared = 3, score = 1.0)
	await addDiscoveryTestLink(store, "target-1", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "target-1", "middle-b", "LIKE");
	await addDiscoveryTestLink(store, "target-1", "middle-c", "LIKE");

	// Target-2 connected to 2 bridges (shared = 2, score = 0.67)
	await addDiscoveryTestLink(store, "target-2", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "target-2", "middle-b", "LIKE");

	const operations = new DiscoveryOperations(store);
	const suggestionsAll = await operations.listEmergenceSuggestions(context.id, 10);
	assertEquals(suggestionsAll.length, 2);
	assertEquals(suggestionsAll[0].targetWorkId, "target-1");
	assertEquals(suggestionsAll[1].targetWorkId, "target-2");

	// Limit 1 returns only highest ranked
	const suggestionsLimit1 = await operations.listEmergenceSuggestions(context.id, 1);
	assertEquals(suggestionsLimit1.length, 1);
	assertEquals(suggestionsLimit1[0].targetWorkId, "target-1");
});

Deno.test("emergence contract: dismissed and accepted suggestions are excluded from subsequent listings while held remain visible", async () => {
	const store = new MemoryGraphStore();
	const context = await addDiscoveryTestWork(store, "context", "Alpha Context");
	await addDiscoveryTestWork(store, "middle-a", "Bridge One");
	await addDiscoveryTestWork(store, "middle-b", "Bridge Two");
	await addDiscoveryTestWork(store, "target", "Beta Target");
	await addDiscoveryTestLink(store, "context", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "context", "middle-b", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-b", "LIKE");

	const operations = new DiscoveryOperations(store);
	const initial = await operations.listEmergenceSuggestions(context.id);
	assertEquals(initial.length, 1);
	const suggestionId = initial[0].id;

	// Resolve as dismiss
	await operations.resolveEmergenceSuggestion(suggestionId, "dismiss", "今は不要");

	// Listing again should exclude the dismissed suggestion
	const afterDismiss = await operations.listEmergenceSuggestions(context.id);
	assertEquals(afterDismiss.find((s) => s.id === suggestionId), undefined);

	// In store, it persists with dismissed status
	const persisted = (await store.listEmergenceSuggestions()).find((s) => s.id === suggestionId);
	assertEquals(persisted?.persistenceStatus, "dismissed");
	assertEquals(persisted?.resolutionReason, "今は不要");
});

Deno.test("emergence contract: repeated listings preserve original createdAt and update timestamps idempotently", async () => {
	const store = new MemoryGraphStore();
	const context = await addDiscoveryTestWork(store, "context", "Alpha Context");
	await addDiscoveryTestWork(store, "middle-a", "Bridge One");
	await addDiscoveryTestWork(store, "middle-b", "Bridge Two");
	await addDiscoveryTestWork(store, "target", "Beta Target");
	await addDiscoveryTestLink(store, "context", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "context", "middle-b", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-a", "LIKE");
	await addDiscoveryTestLink(store, "target", "middle-b", "LIKE");

	const operations = new DiscoveryOperations(store);
	const firstRun = await operations.listEmergenceSuggestions(context.id);
	assertEquals(firstRun.length, 1);
	const originalCreatedAt = firstRun[0].createdAt;
	const countBefore = (await store.listEmergenceSuggestions()).length;

	const secondRun = await operations.listEmergenceSuggestions(context.id);
	assertEquals(secondRun.length, 1);
	assertEquals(secondRun[0].id, firstRun[0].id);
	assertEquals(secondRun[0].createdAt, originalCreatedAt);
	assert(secondRun[0].updatedAt >= originalCreatedAt);
	// No duplicate suggestions created in store
	assertEquals((await store.listEmergenceSuggestions()).length, countBefore);
});

Deno.test("emergence contract: pin action transitions suggestion to held state without creating links", async () => {
	const store = new MemoryGraphStore();
	const operations = new DiscoveryOperations(store);
	const suggestion = {
		id: "sug-pin-test",
		kind: "latent-relation" as const,
		title: "保留テスト",
		contextItemId: "occ-ctx",
		contextWorkId: "work-ctx",
		targetItemId: "occ-tgt",
		targetWorkId: "work-tgt",
		proposedLinkType: "RELATED" as const,
		score: 0.8,
		explanation: "保留理由の説明",
		evidence: [],
		persistenceStatus: "pending" as const,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
	await store.upsertEmergenceSuggestion(suggestion);
	const linksBefore = await store.listLinks();

	await operations.resolveEmergenceSuggestion(suggestion.id, "pin", "後で検討する");

	// Status updated to held
	const persisted = (await store.listEmergenceSuggestions()).find((s) => s.id === suggestion.id);
	assertEquals(persisted?.persistenceStatus, "held");
	assertEquals(persisted?.status, "pinned");
	assertEquals(persisted?.resolutionReason, "後で検討する");

	// Zero links created
	assertEquals(await store.listLinks(), linksBefore);
});

Deno.test("emergence contract: suggestions without proposed link type reject acceptance and do not mutate links", async () => {
	const store = new MemoryGraphStore();
	const operations = new DiscoveryOperations(store);
	const suggestion = {
		id: "sug-no-type",
		kind: "cross-branch-resonance" as const,
		title: "リンク種別なし",
		contextItemId: "occ-ctx",
		contextWorkId: "work-ctx",
		targetItemId: "occ-tgt",
		targetWorkId: "work-tgt",
		proposedLinkType: undefined,
		score: 0.5,
		explanation: "語彙共鳴",
		evidence: [],
		persistenceStatus: "pending" as const,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
	await store.upsertEmergenceSuggestion(suggestion);
	const linksBefore = await store.listLinks();

	await assertRejects(
		() => operations.resolveEmergenceSuggestion(suggestion.id, "accept"),
		Error,
		"リンク種別のない提案は採用できません。",
	);

	// Zero links created (side-effect free)
	assertEquals(await store.listLinks(), linksBefore);
});

Deno.test("emergence contract: resolving already resolved suggestions fails with stale error and leaves links unchanged", async () => {
	const store = new MemoryGraphStore();
	const operations = new DiscoveryOperations(store);
	const suggestion = {
		id: "sug-double-resolve",
		kind: "latent-relation" as const,
		title: "重複解決テスト",
		contextItemId: "occ-ctx",
		contextWorkId: "work-ctx",
		targetItemId: "occ-tgt",
		targetWorkId: "work-tgt",
		proposedLinkType: "RELATED" as const,
		score: 0.9,
		explanation: "重複テスト",
		evidence: [],
		persistenceStatus: "pending" as const,
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
	await store.upsertEmergenceSuggestion(suggestion);

	// First resolve succeeds
	await operations.resolveEmergenceSuggestion(suggestion.id, "accept", "初回到達");
	const linksAfterFirst = await store.listLinks();
	assertEquals(linksAfterFirst.length, 1);

	// Second resolve attempt fails with stale error
	await assertRejects(
		() => operations.resolveEmergenceSuggestion(suggestion.id, "accept", "再実行"),
		Error,
		"提案が古くなりました。再読み込みしてください。",
	);

	// No additional links created
	assertEquals(await store.listLinks(), linksAfterFirst);
});
