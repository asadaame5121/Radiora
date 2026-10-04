import { LINK_TYPES, type LinkType } from "../domain/models.ts";
import type {
	InlineSemanticLinkDiagnosticCode,
	InlineSemanticLinkDiagnosticField,
} from "./inline_semantic_link.ts";

interface ParseFailure {
	code: Exclude<InlineSemanticLinkDiagnosticCode, "UNTERMINATED_LINK">;
	field: InlineSemanticLinkDiagnosticField;
	message: string;
	start: number;
	end: number;
}

type ParseResult<T> =
	| { kind: "success"; value: T }
	| { kind: "failure"; failure: ParseFailure };

interface ScannedField {
	value: string;
	next: number;
}

interface ParsedType {
	value: LinkType;
	reason?: string;
	next: number;
}

export type InlineSemanticLinkBodyResult =
	| { kind: "success"; source: string; type: LinkType; target: string; reason?: string }
	| { kind: "failure"; failure: ParseFailure };

/**
 * Parse Source :: TYPE ("reason")? :: Target, without the surrounding [[ / ]].
 * Only horizontal whitespace separates fields. `offset` locates diagnostics in
 * the original UTF-16 source. Syntax in TYPE/reason precedes unknown-type lookup,
 * which in turn precedes Target validation.
 */
export function parseInlineSemanticLinkBody(
	body: string,
	offset: number,
	allowedTypes: readonly string[] = LINK_TYPES,
): InlineSemanticLinkBodyResult {
	const source = readEndpoint(body, 0, offset, "source");
	if (source.kind === "failure") return source;
	const type = readType(body, source.value.next, offset, allowedTypes);
	if (type.kind === "failure") return type;
	const target = readEndpoint(body, type.value.next, offset, "target");
	if (target.kind === "failure") return target;
	return {
		kind: "success",
		source: source.value.value,
		type: type.value.value,
		target: target.value.value,
		...(type.value.reason === undefined ? {} : { reason: type.value.reason }),
	};
}

function readEndpoint(
	input: string,
	cursor: number,
	offset: number,
	field: "source" | "target",
): ParseResult<ScannedField> {
	cursor = skipHorizontalWhitespace(input, cursor);
	const token = input[cursor] === '"'
		? readQuoted(input, cursor, offset, field)
		: readEndpointToken(input, cursor, offset, field);
	if (token.kind === "failure") return token;
	cursor = skipHorizontalWhitespace(input, token.value.next);
	if (field === "source") {
		const delimiter = readDelimiter(input, cursor, offset, field);
		if (delimiter.kind === "failure") return delimiter;
		return { kind: "success", value: { value: token.value.value, next: delimiter.value } };
	}
	if (cursor !== input.length) {
		return syntaxFailure(
			field,
			offset + cursor,
			offset + Math.min(cursor + 2, input.length),
			"Target must be the final field of an inline semantic link",
		);
	}
	return { kind: "success", value: { value: token.value.value, next: cursor } };
}

function readEndpointToken(
	input: string,
	start: number,
	offset: number,
	field: "source" | "target",
): ParseResult<ScannedField> {
	let cursor = start;
	while (cursor < input.length && !isTokenBoundary(input, cursor)) {
		if (input[cursor] === '"') {
			return syntaxFailure(
				field,
				offset + cursor,
				offset + cursor + 1,
				"A quote must enclose the complete Source or Target token",
			);
		}
		cursor++;
	}
	if (cursor === start) {
		return syntaxFailure(
			field,
			offset + start,
			offset + Math.min(start + 1, input.length),
			`${field} must be a quoted string or a non-whitespace token`,
		);
	}
	return { kind: "success", value: { value: input.slice(start, cursor), next: cursor } };
}

function readType(
	input: string,
	cursor: number,
	offset: number,
	allowedTypes: readonly string[],
): ParseResult<ParsedType> {
	cursor = skipHorizontalWhitespace(input, cursor);
	const typeStart = cursor;
	while (cursor < input.length && !isTokenBoundary(input, cursor) && input[cursor] !== "(") {
		cursor++;
	}
	const typeEnd = cursor;
	if (typeStart === typeEnd) {
		return syntaxFailure(
			"type",
			offset + typeStart,
			offset + Math.min(typeStart + 1, input.length),
			"TYPE must be a link type name",
		);
	}
	const reason = readReason(input, cursor, offset);
	if (reason.kind === "failure") return reason;
	const delimiter = readDelimiter(input, reason.value.next, offset, "type");
	if (delimiter.kind === "failure") return delimiter;
	const spelling = input.slice(typeStart, typeEnd);
	const normalized = spelling.toUpperCase();
	const value = allowedTypes.find((candidate) => candidate === normalized) as LinkType | undefined;
	if (!value) {
		return {
			kind: "failure",
			failure: {
				code: "UNKNOWN_TYPE",
				field: "type",
				message: `Unknown inline semantic link type: ${spelling}`,
				start: offset + typeStart,
				end: offset + typeEnd,
			},
		};
	}
	return { kind: "success", value: { value, reason: reason.value.value, next: delimiter.value } };
}

function readReason(
	input: string,
	cursor: number,
	offset: number,
): ParseResult<{ value: string | undefined; next: number }> {
	cursor = skipHorizontalWhitespace(input, cursor);
	if (input[cursor] !== "(") {
		return { kind: "success", value: { value: undefined, next: cursor } };
	}
	cursor = skipHorizontalWhitespace(input, cursor + 1);
	if (input[cursor] !== '"') {
		return syntaxFailure(
			"reason",
			offset + cursor,
			offset + Math.min(cursor + 1, input.length),
			"reason must be a quoted string",
		);
	}
	const reason = readQuoted(input, cursor, offset, "reason");
	if (reason.kind === "failure") return reason;
	cursor = reason.value.next;
	if (input[cursor] !== ")") {
		return syntaxFailure(
			"reason",
			offset + cursor,
			offset + Math.min(cursor + 1, input.length),
			"reason is missing its closing parenthesis",
		);
	}
	return {
		kind: "success",
		value: { value: reason.value.value, next: skipHorizontalWhitespace(input, cursor + 1) },
	};
}

function readDelimiter(
	input: string,
	cursor: number,
	offset: number,
	field: "source" | "type",
): ParseResult<number> {
	if (input.startsWith("::", cursor)) return { kind: "success", value: cursor + 2 };
	return syntaxFailure(
		field,
		offset + cursor,
		offset + Math.min(cursor + 1, input.length),
		`Expected the :: delimiter after ${field === "type" ? "TYPE" : field}`,
	);
}

/** Decode only escaped quotes/backslashes; empty strings are allowed for reason. */
function readQuoted(
	input: string,
	start: number,
	offset: number,
	field: "source" | "target" | "reason",
): ParseResult<ScannedField> {
	let cursor = start + 1;
	let value = "";
	while (cursor < input.length) {
		const character = input[cursor];
		if (character === '"') {
			cursor = skipHorizontalWhitespace(input, cursor + 1);
			if (field !== "reason" && !value) {
				return syntaxFailure(field, offset + start, offset + cursor, `${field} must not be empty`);
			}
			return { kind: "success", value: { value, next: cursor } };
		}
		if (character === "\r" || character === "\n") {
			return syntaxFailure(
				field,
				offset + cursor,
				offset + cursor + 1,
				"Quoted inline semantic-link fields cannot contain a line break",
			);
		}
		if (character !== "\\") {
			value += character;
			cursor++;
			continue;
		}
		if (input[cursor + 1] !== '"' && input[cursor + 1] !== "\\") {
			return syntaxFailure(
				field,
				offset + cursor,
				offset + Math.min(cursor + 2, input.length),
				"Only escaped quotes and backslashes are allowed in quoted fields",
			);
		}
		value += input[cursor + 1];
		cursor += 2;
	}
	return syntaxFailure(
		field,
		offset + start,
		offset + input.length,
		"Quoted field is missing its closing quote",
	);
}

function syntaxFailure(
	field: InlineSemanticLinkDiagnosticField,
	start: number,
	end: number,
	message: string,
): { kind: "failure"; failure: ParseFailure } {
	return { kind: "failure", failure: { code: "SYNTAX_ERROR", field, message, start, end } };
}

function isTokenBoundary(input: string, cursor: number): boolean {
	const character = input[cursor];
	return character === " " || character === "\t" || character === "\r" || character === "\n" ||
		character === "[" || character === "]" || input.startsWith("::", cursor);
}

function skipHorizontalWhitespace(input: string, cursor: number): number {
	while (input[cursor] === " " || input[cursor] === "\t") cursor++;
	return cursor;
}
