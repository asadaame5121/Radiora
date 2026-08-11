import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("emergence decisions stay explicit and use injected vocabulary", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const controller = await Deno.readTextFile(
		new URL("../src/ui/emergence_controller.svelte.ts", import.meta.url),
	);
	const section = app.match(
		/<div class="discoveries">[\s\S]*?<\/div>\s*\{:else if asideMode === "history"\}/,
	)?.[0] ?? "";

	assert(section.length > 0, "emergence suggestion section not found");
	for (
		const code of [
			"emergenceLoading",
			"emergenceAccept",
			"emergenceHold",
			"emergenceDismiss",
			"emergenceResolutionReason",
			"noEmergenceSuggestion",
		]
	) {
		assert(section.includes(`vocabulary.${code}`), `missing vocabulary.${code}`);
	}
	assert(section.includes('resolveEmergence(suggestion, "accept")'));
	assert(section.includes('resolveEmergence(suggestion, "pin")'));
	assert(section.includes('resolveEmergence(suggestion, "dismiss")'));
	assertFalse(section.includes("{#if suggestion.proposedLinkType}"));
	assert(section.includes("disabled={!emergenceResolutionReasons[suggestion.id]?.trim()}"));
	assertFalse(/>採用<|>保留<|>ピン<|>却下<|関係を探索中|新しい関係候補はありません/.test(section));
	assert(app.includes("createEmergenceController"));
	assert(app.includes("<Toast"));
	assertFalse(app.includes("new Notification("));
	assert(controller.includes("notifiedIds"));
	assert(controller.includes('suggestion.persistenceStatus === "pending"'));
	assert(controller.includes("request !== loadRequest"));
});
