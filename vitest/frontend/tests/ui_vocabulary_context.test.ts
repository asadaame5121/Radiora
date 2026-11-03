import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("App receives UiVocabulary from Svelte Context without design-term literals", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const entry = await readFile(new URL("../../../src/ui/main.ts", import.meta.url), "utf8");

	expect(app.includes("useUiVocabulary()")).toBeTruthy();
	expect(entry.includes("UI_VOCABULARY_CONTEXT")).toBeTruthy();
	expect(entry.includes("DEFAULT_UI_VOCABULARY_DEFINITION")).toBeTruthy();
	expect(/実身|化身|項目|リンク/.test(app)).toBe(false);
});
