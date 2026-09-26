import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import fc from "fast-check";
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

Deno.test("Advanced Link parser accepts allowed custom link types and rejects unregistered types by default", () => {
	const allowed = ["FROM", "SUPPORT", "CUSTOM_DIR", "CUSTOM_SYM"] as const;

	assertEquals(parseAdvancedLinkInput("source :: custom_dir :: target", allowed), {
		source: "source",
		type: "CUSTOM_DIR",
		target: "target",
	});

	assertEquals(parseAdvancedLinkInput('source :: CUSTOM_SYM("理由") :: target', allowed), {
		source: "source",
		type: "CUSTOM_SYM",
		target: "target",
		reason: "理由",
	});

	const error = assertThrows(
		() => parseAdvancedLinkInput("source :: custom_dir :: target"),
		AdvancedLinkParseError,
	);
	assertEquals(error.code, "UNKNOWN_LINK_TYPE");
});

const validFieldArbitrary = fc.tuple(
	fc.array(fc.constantFrom("a", "b", "日本語"), { minLength: 1, maxLength: 12 }),
	fc.array(fc.constantFrom("c", "d", " ", "資料"), { maxLength: 12 }),
).map(([required, suffix]) => [...required, ...suffix].join(""));
const validInputArbitrary = fc.tuple(
	validFieldArbitrary,
	fc.constantFrom("FROM", "SUPPORT", "DEF", "RELATED"),
	validFieldArbitrary,
).map(([source, type, target]) => source + " :: " + type + " :: " + target);
const parserInputArbitrary = fc.oneof(
	fc.string({ maxLength: 160 }).map((input) => ({ input, guaranteedValid: false })),
	validInputArbitrary.map((input) => ({ input, guaranteedValid: true })),
);

Deno.test(
	"Property: Advanced Link parser returns a value or a bounded structured parse error",
	() => {
		void fc.assert(
			fc.property(parserInputArbitrary, ({ input, guaranteedValid }) => {
				try {
					const parsed = parseAdvancedLinkInput(input);
					assertEquals(typeof parsed.source, "string");
					assertEquals(typeof parsed.type, "string");
					assertEquals(typeof parsed.target, "string");
				} catch (error) {
					if (!(error instanceof AdvancedLinkParseError)) throw error;
					assertEquals(guaranteedValid, false);
					assertEquals(Number.isInteger(error.position), true);
					assertEquals(error.position >= 0 && error.position <= input.length, true);
				}
			}),
			{ numRuns: 100 },
		);
	},
);
