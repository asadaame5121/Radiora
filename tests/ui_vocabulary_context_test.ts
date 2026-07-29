import { assert, assertFalse } from "jsr:@std/assert@1";

Deno.test("App receives UiVocabulary from Svelte Context without design-term literals", async () => {
	const app = await Deno.readTextFile(new URL("../src/ui/App.svelte", import.meta.url));
	const entry = await Deno.readTextFile(new URL("../src/ui/main.ts", import.meta.url));

	assert(app.includes("useUiVocabulary()"));
	assert(entry.includes("UI_VOCABULARY_CONTEXT"));
	assert(entry.includes("DEFAULT_UI_VOCABULARY"));
	assertFalse(/実身|化身|項目|リンク/.test(app));
});
