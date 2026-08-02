import { assertEquals } from "jsr:@std/assert@1";
import { EMPTY_OUTLINE_FILTER, matchesOutlineFilter, parseFilterTags } from "./outline_filter.ts";

Deno.test("outline filter supports free text and exact AND/NOT tags", () => {
	const filter = { freeText: "設計", tagsAll: "#ui, 保存", tagsNone: "#除外" };
	assertEquals(matchesOutlineFilter("設計メモ #ui #保存", filter), true);
	assertEquals(matchesOutlineFilter("設計メモ #ui #保存 #除外", filter), false);
	assertEquals(matchesOutlineFilter("設計メモ #uis #保存", filter), false);
	assertEquals(matchesOutlineFilter("実装メモ #ui #保存", filter), false);
});

Deno.test("outline filter parses Japanese separators and empty conditions", () => {
	assertEquals(parseFilterTags(" #A, #b、c  "), ["a", "b", "c"]);
	assertEquals(matchesOutlineFilter("任意の本文", EMPTY_OUTLINE_FILTER), true);
});
