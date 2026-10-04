import { assertEquals } from "jsr:@std/assert@1";
import {
	findAutolinkEnd,
	findInlineCodeEnd,
	isEscaped,
	MarkdownExclusionScanner,
	parseMarkdownLink,
} from "./markdown_source_scanner.ts";

Deno.test("Markdown scanner skips fences through matching closings for every newline form", () => {
	for (const newline of ["\n", "\r", "\r\n"]) {
		const lines = ["   ~~~~md", "hidden", "~~~", "````", "~~~~ trailing", "~~~~~\t", "visible"];
		const source = lines.join(newline);
		const scanner = new MarkdownExclusionScanner(source);
		let index = 0;
		for (const line of lines.slice(0, -1)) {
			const end = index + line.length + newline.length;
			assertEquals(scanner.skipFencedRegion(index), end);
			index = end;
		}
		assertEquals(scanner.skipFencedRegion(index), null);
	}
});

Deno.test("Markdown scanner keeps unterminated fences excluded through EOF", () => {
	const source = "```md\n[[unfinished";
	const scanner = new MarkdownExclusionScanner(source);
	const openingEnd = source.indexOf("\n") + 1;
	assertEquals(scanner.skipFencedRegion(0), openingEnd);
	assertEquals(scanner.skipFencedRegion(openingEnd), source.length);
});

Deno.test("Markdown code spans require an equal backtick run and may span lines", () => {
	const source = "``a ` b\r\nc`` tail";
	assertEquals(findInlineCodeEnd(source, 0), source.indexOf(" tail"));
	assertEquals(findInlineCodeEnd("``a```", 0), null);
});

Deno.test("Markdown scanner recognizes autolinks without treating ordinary angle text as a link", () => {
	for (
		const source of ["<https://host.test/path>", "<mailto:name@host.test>", "<radiora://work/id>"]
	) {
		assertEquals(findAutolinkEnd(source, 0), source.length);
	}
	for (const source of ["<ordinary text>", "<https://host.test", "<https://host.test/a b>"]) {
		assertEquals(findAutolinkEnd(source, 0), null);
	}
});

Deno.test("Markdown link scanner preserves label and angle destination UTF-16 ranges", () => {
	const source = "😀 [a [b] \\] c]\t(<radiora://work/id(a)>) tail";
	const start = source.indexOf("[");
	const destinationStart = source.indexOf("radiora:");
	const destinationEnd = source.indexOf(">");
	assertEquals(parseMarkdownLink(source, start), {
		range: { start, end: destinationEnd + 2 },
		labelEnd: source.indexOf("]\t"),
		destinationStart,
		destinationEnd,
	});
});

Deno.test("Markdown exclusion scan leaves escaped links, semantic openings, and unfinished syntax to its caller", () => {
	for (
		const source of [
			"[[A::RELATED::B]]",
			String.raw`\[label](url)`,
			"[label](unclosed",
			"[label](<url)",
			"`unclosed",
		]
	) {
		const index = source.indexOf("[") >= 0 ? source.indexOf("[") : 0;
		assertEquals(new MarkdownExclusionScanner(source).skipInlineRegion(index), null);
	}
	const source = String.raw`\\[label](url)`;
	assertEquals(isEscaped(source, 2), false);
	assertEquals(new MarkdownExclusionScanner(source).skipInlineRegion(2), source.length);
});

Deno.test("Markdown exclusion scan skips complete links including semantic spellings in their labels", () => {
	const source = "[label [[A::RELATED::B]]](https://host.test/a(b)) tail";
	assertEquals(new MarkdownExclusionScanner(source).skipInlineRegion(0), source.indexOf(" tail"));
});

Deno.test("Markdown URL exclusion retains scheme, boundary, and Japanese punctuation rules", () => {
	for (const scheme of ["HTTPS", "http", "ftp", "radiora"]) {
		const source = `(${scheme}://host/path[[hidden]]、visible`;
		assertEquals(new MarkdownExclusionScanner(source).skipInlineRegion(1), source.indexOf("、"));
	}
	assertEquals(new MarkdownExclusionScanner("xhttps://host").skipInlineRegion(1), null);
});
