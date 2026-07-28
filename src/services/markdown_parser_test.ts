import { assertEquals } from "jsr:@std/assert@1";
import { parseMarkdownCandidates } from "./markdown_parser.ts";

Deno.test("Markdown parser extracts Japanese tags at valid boundaries with source ranges", () => {
	const source = "#先頭、#句読点 \n#連続 #alpha-2/β _#下線 -#ハイフン";
	const result = parseMarkdownCandidates(source);

	assertEquals(result.tags.map(({ name, range }) => ({ name, range })), [
		{ name: "先頭", range: { start: 0, end: 3 } },
		{ name: "句読点", range: { start: 4, end: 8 } },
		{ name: "連続", range: { start: 10, end: 13 } },
		{ name: "alpha-2/β", range: { start: 14, end: 24 } },
		{ name: "下線", range: { start: 26, end: 29 } },
		{ name: "ハイフン", range: { start: 31, end: 36 } },
	]);
});

Deno.test("Markdown parser rejects invalid, escaped, code, and URL-contained tags", () => {
	const source = [
		"語中#無効 #123 \\#escaped #有効",
		"`#inline` [#label](https://example.test/#url) <https://example.test/#auto> https://example.test/#plain、#URL後",
		"```md",
		"#fenced [x](radiora://work/fenced)",
		"```",
		"~~~md `valid info string`",
		"#tilde-fenced [x](radiora://work/tilde-fenced)",
		"~~~",
	].join("\n");

	assertEquals(parseMarkdownCandidates(source).tags.map((tag) => tag.name), [
		"有効",
		"label",
		"URL後",
	]);
});

Deno.test("Markdown parser extracts canonical Radiora links and URI fragments", () => {
	const source = "[自由意志](radiora://work/work-01#節) と [初稿](radiora://revision/rev_02)";
	const result = parseMarkdownCandidates(source);

	assertEquals(result.internalReferences, [
		{
			scope: "work",
			id: "work-01",
			fragment: "節",
			range: { start: 0, end: 32 },
			destinationRange: { start: 7, end: 31 },
		},
		{
			scope: "revision",
			id: "rev_02",
			range: { start: 35, end: 66 },
			destinationRange: { start: 40, end: 65 },
		},
	]);
});

Deno.test("Markdown parser extracts tags from ordinary and Radiora link labels", () => {
	const source =
		"[説明 #外部](https://host.test/x#fragment) [参照 #内部](radiora://work/work-01#fragment)";
	const result = parseMarkdownCandidates(source);

	assertEquals(result.tags.map(({ name, range }) => ({ name, range })), [
		{ name: "外部", range: { start: 4, end: 7 } },
		{ name: "内部", range: { start: 43, end: 46 } },
	]);
	assertEquals(
		result.internalReferences.map(({ scope, id, fragment }) => ({ scope, id, fragment })),
		[
			{ scope: "work", id: "work-01", fragment: "fragment" },
		],
	);
});

Deno.test("Markdown parser does not treat plain URLs, autolinks, or escaped links as internal references", () => {
	const source = "radiora://work/plain <radiora://work/auto> \\[no](radiora://work/escaped)";

	assertEquals(parseMarkdownCandidates(source).internalReferences, []);
});
