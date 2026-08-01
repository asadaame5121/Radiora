import { assertEquals } from "jsr:@std/assert@1";
import { findInlineLinkTrigger, replaceInlineLinkTrigger } from "./inline_link.ts";

Deno.test("inline link trigger starts at @ and preserves the caret range", () => {
	const source = "本文から @自由意志";
	const trigger = findInlineLinkTrigger(source, source.length);
	assertEquals(trigger, {
		query: "自由意志",
		range: { start: 5, end: source.length },
	});
	assertEquals(
		replaceInlineLinkTrigger(source, trigger!.range, "[@自由意志](radiora://work/work-1)"),
		{
			text: "本文から [@自由意志](radiora://work/work-1)",
			caretOffset: 35,
		},
	);
});

Deno.test("inline link trigger accepts an empty query and rejects embedded word mentions", () => {
	assertEquals(findInlineLinkTrigger("@", 1), { query: "", range: { start: 0, end: 1 } });
	assertEquals(findInlineLinkTrigger("email@example.com", 13), null);
	assertEquals(findInlineLinkTrigger("\@literal", 9), null);
});

Deno.test("inline link trigger ignores code, URLs, Markdown destinations, and fenced blocks", () => {
	assertEquals(findInlineLinkTrigger("`@code`", 6), null);
	assertEquals(findInlineLinkTrigger("https://example.test/@node", 26), null);
	assertEquals(findInlineLinkTrigger("[label](https://example.test/@node)", 35), null);
	assertEquals(findInlineLinkTrigger("```md\n@node", 11), null);
});
