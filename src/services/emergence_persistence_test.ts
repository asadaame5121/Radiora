import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { EmergenceSuggestion } from "../domain/models.ts";
import { MemoryGraphStore } from "../storage/memory_store.ts";
import { EmergencePersistence } from "./emergence_persistence.ts";
import { emergenceSuggestionFingerprint } from "./emergence_suggestion_calculator.ts";

function candidate(
	overrides: Partial<EmergenceSuggestion> = {},
): EmergenceSuggestion {
	const kind = overrides.kind ?? "latent-relation";
	const contextWorkId = overrides.contextWorkId ?? "z-context";
	const targetWorkId = overrides.targetWorkId ?? "a-target";
	return {
		id: emergenceSuggestionFingerprint(`${kind}:${contextWorkId}:${targetWorkId}`),
		kind,
		contextWorkId,
		targetWorkId,
		contextItemId: "context-occ",
		targetItemId: "target-occ",
		proposedLinkType: "LIKE",
		title: "潜在的な関係",
		explanation: "共通リンクがあります。",
		evidence: [],
		score: 0.8,
		persistenceStatus: "pending",
		createdAt: "",
		updatedAt: "",
		...overrides,
	};
}

Deno.test("emergence persistence materializes legacy feedback and resolves through its interface", async () => {
	const store = new MemoryGraphStore();
	const persistence = new EmergencePersistence(store);
	const input = candidate();
	await store.setEmergenceFeedback(
		emergenceSuggestionFingerprint(`${input.kind}:${input.contextItemId}:${input.targetItemId}`),
		"pin",
	);

	const [held] = await persistence.materialize([input]);
	assertEquals(held.persistenceStatus, "held");
	assertEquals(held.status, "pinned");

	await new EmergencePersistence(store).resolve(held.id, "accept", "確認済み");
	const [link] = await store.listLinks();
	assertEquals([link.from.workId, link.to.workId], ["a-target", "z-context"]);
	assertEquals(link.reason, input.explanation);
	assertEquals(
		(await store.listEmergenceSuggestions())[0].persistenceStatus,
		"accepted",
	);
});

Deno.test("emergence persistence dismisses a persisted suggestion after recreation", async () => {
	const store = new MemoryGraphStore();
	const [pending] = await new EmergencePersistence(store).materialize([candidate()]);

	await new EmergencePersistence(store).resolve(pending.id, "dismiss", "不要");
	assertEquals((await store.listEmergenceSuggestions())[0].persistenceStatus, "dismissed");
});

Deno.test("emergence persistence rejects stale resolutions before touching the store", async () => {
	const persistence = new EmergencePersistence(new MemoryGraphStore());

	await assertRejects(
		() => persistence.resolve("stale", "dismiss", "不要"),
		Error,
		"提案が古くなりました。再読み込みしてください。",
	);
});
