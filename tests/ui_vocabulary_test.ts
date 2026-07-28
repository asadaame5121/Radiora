import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import { DEFAULT_UI_VOCABULARY, type UiEntityCode } from "../src/shared/ui_vocabulary.ts";

Deno.test("default UI vocabulary covers every semantic entity code with neutral labels", () => {
	const codes: UiEntityCode[] = ["work", "occurrence", "semanticLink"];
	assertEquals(Object.keys(DEFAULT_UI_VOCABULARY).sort(), [...codes].sort());
	assertFalse(Object.values(DEFAULT_UI_VOCABULARY).some((label) => /実身|化身/.test(label)));
	assertEquals(DEFAULT_UI_VOCABULARY, {
		work: "項目",
		occurrence: "配置",
		semanticLink: "リンク",
	});
});
