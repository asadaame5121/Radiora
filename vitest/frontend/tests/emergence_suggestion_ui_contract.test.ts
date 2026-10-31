import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("emergence decisions stay explicit and use injected vocabulary", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const inspector = await readFile(
		new URL("../../../src/ui/InspectorView.svelte", import.meta.url),
		"utf8",
	);
	const relationTab = await readFile(
		new URL("../../../src/ui/InspectorRelationTab.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/emergence_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const sectionStart = relationTab.indexOf('<div class="discoveries">');
	const section = sectionStart >= 0 ? relationTab.slice(sectionStart) : "";

	expect(
		inspector.includes("InspectorRelationTab"),
		"renders relation tab in inspector",
	).toBeTruthy();

	expect(section.length > 0, "emergence suggestion section not found").toBeTruthy();
	for (const code of [
		"emergenceLoading",
		"emergenceAccept",
		"emergenceHold",
		"emergenceDismiss",
		"emergenceResolutionReason",
		"noEmergenceSuggestion",
	]) {
		expect(section.includes(`vocabulary.${code}`), `missing vocabulary.${code}`).toBeTruthy();
	}
	expect(section.includes('onResolveEmergence(suggestion, "accept")')).toBeTruthy();
	expect(section.includes('onResolveEmergence(suggestion, "pin")')).toBeTruthy();
	expect(section.includes('onResolveEmergence(suggestion, "dismiss")')).toBeTruthy();
	expect(section.includes("{#if suggestion.proposedLinkType}")).toBe(false);
	expect(section.includes("disabled={!emergenceResolutionReasons[suggestion.id]?.trim()}")).toBe(
		false,
	);
	expect(/>採用<|>保留<|>ピン<|>却下<|関係を探索中|新しい関係候補はありません/.test(section)).toBe(
		false,
	);
	expect(app.includes("createEmergenceController")).toBeTruthy();
	expect(app.includes("<Toast")).toBeTruthy();
	expect(app.includes("new Notification(")).toBe(false);
	expect(controller.includes("notifiedIds")).toBeTruthy();
	expect(controller.includes('suggestion.persistenceStatus === "pending"')).toBeTruthy();
	expect(controller.includes("request !== loadRequest")).toBeTruthy();
});
