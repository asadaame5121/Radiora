import { assertEquals } from "jsr:@std/assert@1";
import { LINK_TYPES } from "../domain/models.ts";
import { parseInlineSemanticLinkBody } from "./inline_semantic_link_grammar.ts";

Deno.test("semantic body grammar parses endpoints, optional reason, and horizontal space", () => {
	const offset = 7;
	const cases = [
		{ body: "A::related::B", source: "A", target: "B" },
		{
			body: ' \t"A :: 名" \t:: related ( "" \t) :: "B ] 名" \t',
			source: "A :: 名",
			target: "B ] 名",
			reason: "",
		},
		{
			body: String.raw`"A \"名\""::RELATED("理由 \\")::B`,
			source: 'A "名"',
			target: "B",
			reason: "理由 \\",
		},
	] as const;
	for (const { body, ...fields } of cases) {
		assertEquals(parseInlineSemanticLinkBody(body, offset), {
			kind: "success",
			type: "RELATED",
			...fields,
		});
	}
});

Deno.test("semantic body grammar normalizes requested types without changing the allowlist", () => {
	const offset = 7;
	const allowed = [...LINK_TYPES, "CAUSES"];
	assertEquals(parseInlineSemanticLinkBody("A::causes::B", 0, allowed), {
		kind: "success",
		source: "A",
		type: "CAUSES",
		target: "B",
	});
	assertEquals(allowed, [...LINK_TYPES, "CAUSES"]);
	for (const types of [LINK_TYPES, [], ["causes"]]) {
		assertEquals(parseInlineSemanticLinkBody("A::causes::B", offset, types), {
			kind: "failure",
			failure: {
				code: "UNKNOWN_TYPE",
				field: "type",
				message: "Unknown inline semantic link type: causes",
				start: 10,
				end: 16,
			},
		});
	}
});

Deno.test("semantic body grammar preserves UTF-16 diagnostic positions and validation order", () => {
	const offset = 9;
	const cases = [
		{
			body: '"😀"::NOPE(foo)::',
			field: "reason",
			code: "SYNTAX_ERROR",
			start: 11,
			end: 12,
			message: "reason must be a quoted string",
		},
		{
			body: '"😀"::NOPE("理由"::',
			field: "reason",
			code: "SYNTAX_ERROR",
			start: 15,
			end: 16,
			message: "reason is missing its closing parenthesis",
		},
		{
			body: '"😀"::NOPE("理由") Target',
			field: "type",
			code: "SYNTAX_ERROR",
			start: 17,
			end: 18,
			message: "Expected the :: delimiter after TYPE",
		},
		{
			body: '"😀"::NOPE::',
			field: "type",
			start: 6,
			end: 10,
			code: "UNKNOWN_TYPE",
			message: "Unknown inline semantic link type: NOPE",
		},
		{
			body: '"😀"::RELATED::B::Extra',
			field: "target",
			code: "SYNTAX_ERROR",
			start: 16,
			end: 18,
			message: "Target must be the final field of an inline semantic link",
		},
	] as const;
	for (const { body, start, end, code = "SYNTAX_ERROR", ...failure } of cases) {
		assertEquals(parseInlineSemanticLinkBody(body, offset), {
			kind: "failure",
			failure: { ...failure, code, start: start + offset, end: end + offset },
		}, body);
	}
});

Deno.test("semantic body grammar distinguishes empty endpoints from empty reason", () => {
	const offset = 3;
	for (
		const { body, field, start, end } of [
			{ body: '"" \t::RELATED::B', field: "source", start: 0, end: 4 },
			{ body: 'A::RELATED::"" \t', field: "target", start: 12, end: 16 },
		] as const
	) {
		assertEquals(parseInlineSemanticLinkBody(body, offset), {
			kind: "failure",
			failure: {
				code: "SYNTAX_ERROR",
				field,
				message: `${field} must not be empty`,
				start: start + offset,
				end: end + offset,
			},
		});
	}
});

Deno.test("semantic body grammar rejects endpoint boundaries and unfinished fields", () => {
	const cases = [
		{
			body: "::RELATED::B",
			field: "source",
			start: 0,
			end: 1,
			message: "source must be a quoted string or a non-whitespace token",
		},
		{
			body: "A::RELATED::",
			field: "target",
			start: 12,
			end: 12,
			message: "target must be a quoted string or a non-whitespace token",
		},
		{ body: "A::::B", field: "type", start: 3, end: 4, message: "TYPE must be a link type name" },
		{
			body: 'A"B::RELATED::C',
			field: "source",
			start: 1,
			end: 2,
			message: "A quote must enclose the complete Source or Target token",
		},
		{
			body: "A[B::RELATED::C",
			field: "source",
			start: 1,
			end: 2,
			message: "Expected the :: delimiter after source",
		},
		{
			body: "A\n::RELATED::B",
			field: "source",
			start: 1,
			end: 2,
			message: "Expected the :: delimiter after source",
		},
		{
			body: 'A::RELATED::"B',
			field: "target",
			start: 12,
			end: 14,
			message: "Quoted field is missing its closing quote",
		},
	] as const;
	for (const { body, ...failure } of cases) {
		assertEquals(parseInlineSemanticLinkBody(body, 0), {
			kind: "failure",
			failure: { code: "SYNTAX_ERROR", ...failure },
		}, body);
	}
});

Deno.test("semantic body grammar rejects invalid escapes and line breaks in every quoted field", () => {
	const offset = 5;
	for (
		const [prefix, suffix, field] of [
			["", "::RELATED::B", "source"],
			["A::RELATED(", ")::B", "reason"],
			["A::RELATED::", "", "target"],
		] as const
	) {
		for (
			const [contents, width, message] of [
				[String.raw`\q`, 2, "Only escaped quotes and backslashes are allowed in quoted fields"],
				["\r\n", 1, "Quoted inline semantic-link fields cannot contain a line break"],
				["\n", 1, "Quoted inline semantic-link fields cannot contain a line break"],
			] as const
		) {
			const start = prefix.length + 2;
			assertEquals(parseInlineSemanticLinkBody(`${prefix}"A${contents}"${suffix}`, offset), {
				kind: "failure",
				failure: {
					code: "SYNTAX_ERROR",
					field,
					message,
					start: start + offset,
					end: start + width + offset,
				},
			});
		}
	}
});
