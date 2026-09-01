import { assertEquals } from "jsr:@std/assert@1";
import { LINK_TYPES } from "../domain/models.ts";
import { parseInlineSemanticLinks } from "./inline_semantic_link.ts";

Deno.test("inline semantic links parse Japanese fields, reason, and source ranges", () => {
	const source = '前置き [[自由意志::RELATED("理由：相互に影響する")::"従来の概念"]] 後置き';
	const start = source.indexOf("[[");
	const end = source.indexOf("]]", start) + 2;

	assertEquals(parseInlineSemanticLinks(source), {
		candidates: [
			{
				start,
				end,
				range: { start, end },
				raw: source.slice(start, end),
				source: "自由意志",
				type: "RELATED",
				target: "従来の概念",
				reason: "理由：相互に影響する",
			},
		],
		diagnostics: [],
	});
});

Deno.test("inline semantic links allow horizontal space around field delimiters", () => {
	const result = parseInlineSemanticLinks('[[  Source  ::  RELATED  ::  "Target Name"  ]]');

	assertEquals(result.diagnostics, []);
	assertEquals(result.candidates.map(({ source, type, target }) => ({ source, type, target })), [
		{ source: "Source", type: "RELATED", target: "Target Name" },
	]);
});

Deno.test("inline semantic links parse multiple same-line candidates and normalize type case", () => {
	const source = '[[A::support::B]] と [["C D"::VS::E]] と [[F::CITE::"G H"]]';
	const result = parseInlineSemanticLinks(source);

	assertEquals(result.diagnostics, []);
	assertEquals(
		result.candidates.map(({ source, type, target, reason, raw, range }) => ({
			source,
			type,
			target,
			reason,
			raw,
			range,
		})),
		[
			{
				source: "A",
				type: "SUPPORT",
				target: "B",
				reason: undefined,
				raw: "[[A::support::B]]",
				range: { start: 0, end: 17 },
			},
			{
				source: "C D",
				type: "VS",
				target: "E",
				reason: undefined,
				raw: '[["C D"::VS::E]]',
				range: { start: 20, end: 36 },
			},
			{
				source: "F",
				type: "CITE",
				target: "G H",
				reason: undefined,
				raw: '[[F::CITE::"G H"]]',
				range: { start: 39, end: 57 },
			},
		],
	);
});

Deno.test("inline semantic links accept the definition relation", () => {
	const result = parseInlineSemanticLinks("[[Definition::Def::Concept]]");

	assertEquals(result.diagnostics, []);
	assertEquals(result.candidates.map(({ source, type, target }) => ({ source, type, target })), [
		{ source: "Definition", type: "DEF", target: "Concept" },
	]);
});

Deno.test("inline semantic links decode escaped quotes, backslashes, and delimiters", () => {
	const source = String.raw`[["A :: \\ C \"D"::RELATED("理由 \"引用\" と \\")::"対象 :: 名"]]`;
	const result = parseInlineSemanticLinks(source);

	assertEquals(result.diagnostics, []);
	assertEquals(result.candidates[0], {
		start: 0,
		end: source.length,
		range: { start: 0, end: source.length },
		raw: source,
		source: 'A :: \\ C "D',
		type: "RELATED",
		target: "対象 :: 名",
		reason: '理由 "引用" と ' + "\\",
	});
});

Deno.test("inline semantic links coexist with Markdown, Radiora references, URLs, and ordinary text", () => {
	const source = [
		"通常テキスト [参照](radiora://work/work-1) **強調**",
		"`[[Code::RELATED::Ignored]]` https://example.test/[[Url::RELATED::Ignored]]",
		"\\[[Escaped::RELATED::Ignored]] [[実在::RELATED::対象]]",
		"```md",
		"[[Fence::RELATED::Ignored]]",
		"```",
		"[ラベル [[Nested::RELATED::Ignored]]](https://example.test)",
	].join("\n");

	assertEquals(
		parseInlineSemanticLinks(source).candidates.map(({ source, type, target }) => ({
			source,
			type,
			target,
		})),
		[{ source: "実在", type: "RELATED", target: "対象" }],
	);
	assertEquals(parseInlineSemanticLinks(source).diagnostics, []);
});

Deno.test("inline semantic links diagnose syntax errors without producing candidates", () => {
	const source = [
		"[[空白を含む Source::RELATED::Target]]",
		"[[Source::NOPE::Target]]",
		"[[Source::RELATED(foo)::Target]]",
		"[[Source::RELATED::Target::Extra]]",
	].join(" ");
	const result = parseInlineSemanticLinks(source);

	assertEquals(result.candidates, []);
	assertEquals(result.diagnostics.map(({ code, field }) => ({ code, field })), [
		{ code: "SYNTAX_ERROR", field: "source" },
		{ code: "UNKNOWN_TYPE", field: "type" },
		{ code: "SYNTAX_ERROR", field: "reason" },
		{ code: "SYNTAX_ERROR", field: "target" },
	]);
});

Deno.test("inline semantic links diagnose an unclosed opening marker", () => {
	const source = '前 [[Source::RELATED("理由")::Target';
	const result = parseInlineSemanticLinks(source);

	assertEquals(result.candidates, []);
	assertEquals(result.diagnostics, [
		{
			code: "UNTERMINATED_LINK",
			field: "link",
			message: "Inline semantic link is missing its closing `]]`",
			start: 2,
			end: source.length,
			range: { start: 2, end: source.length },
		},
	]);
});

Deno.test("inline semantic links parse custom relation types when explicitly allowed and report UNKNOWN_TYPE otherwise", () => {
	const source = "[[A::causes::B]] と [[C::unknown::D]]";
	const customAllowed = [...LINK_TYPES, "CAUSES"] as const;

	// 1. allowedTypes=[...LINK_TYPES, 'CAUSES'] で causes が候補 type: "CAUSES" になる
	const customResult = parseInlineSemanticLinks(source, customAllowed);
	assertEquals(customResult.candidates.length, 1);
	assertEquals(customResult.candidates[0].type, "CAUSES");
	assertEquals(customResult.candidates[0].source, "A");
	assertEquals(customResult.candidates[0].target, "B");
	assertEquals(customResult.diagnostics.length, 1);
	assertEquals(customResult.diagnostics[0].code, "UNKNOWN_TYPE");

	// 2. デフォルト（未許可型）では causes も unknown も UNKNOWN_TYPE
	const defaultResult = parseInlineSemanticLinks(source);
	assertEquals(defaultResult.candidates, []);
	assertEquals(defaultResult.diagnostics.map((d) => d.code), ["UNKNOWN_TYPE", "UNKNOWN_TYPE"]);
});
