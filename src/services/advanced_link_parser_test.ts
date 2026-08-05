import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
	AdvancedLinkParseError,
	type AdvancedLinkParseErrorCode,
	parseAdvancedLinkInput,
} from "./advanced_link_parser.ts";

Deno.test("Advanced Link parser trims outer spaces and normalizes link types", () => {
	assertEquals(parseAdvancedLinkInput(" \tsource  ::  sUpPoRt\t:: target\t "), {
		source: "source",
		type: "SUPPORT",
		target: "target",
	});
	assertEquals(parseAdvancedLinkInput("source :: Def :: target"), {
		source: "source",
		type: "DEF",
		target: "target",
	});
});

Deno.test("Advanced Link parser preserves internal whitespace and Japanese names", () => {
	assertEquals(parseAdvancedLinkInput(" \t自由\t意志  :: from ::  従来 の自由意志 概念\t "), {
		source: "自由\t意志",
		type: "FROM",
		target: "従来 の自由意志 概念",
	});
});

Deno.test("Advanced Link parser accepts delimiters and supported escapes in quoted fields", () => {
	assertEquals(parseAdvancedLinkInput(' "A :: B\\\\C\\"D" :: related :: "対象 :: 名" '), {
		source: 'A :: B\\C"D',
		type: "RELATED",
		target: "対象 :: 名",
	});
});

Deno.test("Advanced Link parser extracts optional reason from type field", () => {
	assertEquals(parseAdvancedLinkInput('source :: RELATED("説明文") :: target'), {
		source: "source",
		type: "RELATED",
		target: "target",
		reason: "説明文",
	});
});

Deno.test("Advanced Link parser preserves reason with escaped quotes", () => {
	assertEquals(
		parseAdvancedLinkInput('source :: RELATED("夫婦\\"だった") :: target'),
		{
			source: "source",
			type: "RELATED",
			target: "target",
			reason: '夫婦"だった',
		},
	);
});

Deno.test("Advanced Link parser accepts type without reason for backward compatibility", () => {
	assertEquals(parseAdvancedLinkInput("source :: RELATED :: target"), {
		source: "source",
		type: "RELATED",
		target: "target",
	});
});

for (
	const [name, input, code, field] of [
		["missing first delimiter", "source", "MISSING_DELIMITER", "source"],
		["missing second delimiter", "source :: RELATED", "MISSING_DELIMITER", "type"],
		["extra delimiter", "source :: RELATED :: target :: extra", "EXTRA_DELIMITER", "target"],
		["empty source", " :: RELATED :: target", "EMPTY_FIELD", "source"],
		["empty type", "source :: \t :: target", "EMPTY_FIELD", "type"],
		["empty target", "source :: RELATED :: \t", "EMPTY_FIELD", "target"],
		["unterminated quote", '"source :: RELATED :: target', "UNTERMINATED_QUOTE", "source"],
		["invalid quoted escape", '"source\\n" :: RELATED :: target', "INVALID_ESCAPE", "source"],
		[
			"content after quoted field",
			'"source" extra :: RELATED :: target',
			"TRAILING_QUOTED_FIELD_CONTENT",
			"source",
		],
		[
			"quote in unquoted field",
			'source"name :: RELATED :: target',
			"QUOTE_IN_UNQUOTED_FIELD",
			"source",
		],
		["unknown link type", "source :: unknown :: target", "UNKNOWN_LINK_TYPE", "type"],
	] as const
) {
	Deno.test(`Advanced Link parser rejects ${name} with structured error`, () => {
		const error = assertThrows(() => parseAdvancedLinkInput(input), AdvancedLinkParseError);
		assertEquals(error.code, code as AdvancedLinkParseErrorCode);
		assertEquals(error.field, field);
		assertEquals(typeof error.position, "number");
	});
}
