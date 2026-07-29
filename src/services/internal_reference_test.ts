import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	canonicalInternalReferenceMarkdown,
	findInternalReferenceTrigger,
	replaceInternalReferenceTrigger,
} from "./internal_reference.ts";
import { parseMarkdownCandidates } from "./markdown_parser.ts";

Deno.test("canonical internal reference insertion escapes Markdown labels and preserves IDs", () => {
	assertEquals(
		canonicalInternalReferenceMarkdown("A [draft] \\ note", "work", "work-stable-id"),
		"[A \\[draft\\] \\\\ note](radiora://work/work-stable-id)",
	);
	assertThrows(() => canonicalInternalReferenceMarkdown("bad", "revision", "id)with-paren"));
	const markdown = canonicalInternalReferenceMarkdown("表示 [名]", "revision", "rev._~A-09");
	assertEquals(
		parseMarkdownCandidates(markdown).internalReferences.map(({ scope, id }) => ({
			scope,
			id,
		})),
		[{ scope: "revision", id: "rev._~A-09" }],
	);
});

Deno.test("[[ completion trigger tracks and replaces the caret range", () => {
	const source = "before [[検 after";
	const trigger = findInternalReferenceTrigger(source, 10, 11);
	assertEquals(trigger, { query: "検", range: { start: 7, end: 11 } });
	assertEquals(
		replaceInternalReferenceTrigger(
			source,
			trigger!.range,
			"[検討](radiora://work/work-1)",
		),
		{
			text: "before [検討](radiora://work/work-1)after",
			caretOffset: 34,
		},
	);
	assertEquals(findInternalReferenceTrigger("closed [[x]]", 12), null);
});
