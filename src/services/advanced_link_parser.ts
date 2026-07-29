import { LINK_TYPES, type LinkType } from "../domain/models.ts";

export type AdvancedLinkField = "source" | "type" | "target";

export type AdvancedLinkParseErrorCode =
	| "MISSING_DELIMITER"
	| "EXTRA_DELIMITER"
	| "EMPTY_FIELD"
	| "UNTERMINATED_QUOTE"
	| "INVALID_ESCAPE"
	| "TRAILING_QUOTED_FIELD_CONTENT"
	| "QUOTE_IN_UNQUOTED_FIELD"
	| "UNKNOWN_LINK_TYPE";

/** A machine-readable syntax or validation error for Advanced Link input. */
export class AdvancedLinkParseError extends Error {
	override readonly name = "AdvancedLinkParseError";

	constructor(
		readonly code: AdvancedLinkParseErrorCode,
		message: string,
		readonly field: AdvancedLinkField,
		readonly position: number,
	) {
		super(message);
	}
}

export interface AdvancedLinkInput {
	source: string;
	type: LinkType;
	target: string;
}

/**
 * Parses the single-line syntax used by Advanced Link Editor.
 *
 * Only quoted fields may contain `::`. Inside quotes, `\"` and `\\` are the
 * only escapes, so input can be round-tripped without silently changing names.
 */
export function parseAdvancedLinkInput(input: string): AdvancedLinkInput {
	const source = readField(input, 0, "source");
	if (!source.hasDelimiter) throw missingDelimiter("source", source.end);

	const type = readField(input, source.end + 2, "type");
	if (!type.hasDelimiter) throw missingDelimiter("type", type.end);

	const target = readField(input, type.end + 2, "target");
	if (target.hasDelimiter) {
		throw new AdvancedLinkParseError(
			"EXTRA_DELIMITER",
			"Advanced Link input must contain exactly two top-level :: delimiters",
			"target",
			target.end,
		);
	}

	const normalizedType = LINK_TYPES.find((candidate) => candidate === type.value.toUpperCase());
	if (!normalizedType) {
		throw new AdvancedLinkParseError(
			"UNKNOWN_LINK_TYPE",
			`Unknown link type: ${type.value}`,
			"type",
			type.start,
		);
	}

	return { source: source.value, type: normalizedType, target: target.value };
}

/** Short alias for callers that do not need the UI-specific name. */
export const parseAdvancedLink = parseAdvancedLinkInput;

interface ParsedField {
	value: string;
	start: number;
	end: number;
	hasDelimiter: boolean;
}

function readField(input: string, start: number, field: AdvancedLinkField): ParsedField {
	let cursor = skipOuterWhitespace(input, start);
	const valueStart = cursor;
	if (input[cursor] === '"') return readQuotedField(input, cursor, field);

	const delimiter = input.indexOf("::", cursor);
	const rawEnd = delimiter < 0 ? input.length : delimiter;
	const quote = input.indexOf('"', cursor);
	if (quote >= 0 && quote < rawEnd) {
		throw new AdvancedLinkParseError(
			"QUOTE_IN_UNQUOTED_FIELD",
			"A quote is only valid when it encloses the entire field",
			field,
			quote,
		);
	}
	const value = trimOuterWhitespace(input.slice(cursor, rawEnd));
	if (!value) throw emptyField(field, valueStart);
	return { value, start: valueStart, end: rawEnd, hasDelimiter: delimiter >= 0 };
}

function readQuotedField(input: string, start: number, field: AdvancedLinkField): ParsedField {
	let value = "";
	let cursor = start + 1;
	for (; cursor < input.length; cursor++) {
		const character = input[cursor];
		if (character === '"') break;
		if (character !== "\\") {
			value += character;
			continue;
		}
		if (cursor + 1 >= input.length) {
			throw new AdvancedLinkParseError(
				"INVALID_ESCAPE",
				"Only escaped quotes and backslashes are allowed in quoted fields",
				field,
				cursor,
			);
		}
		const escaped = input[++cursor];
		if (escaped !== '"' && escaped !== "\\") {
			throw new AdvancedLinkParseError(
				"INVALID_ESCAPE",
				"Only escaped quotes and backslashes are allowed in quoted fields",
				field,
				cursor - 1,
			);
		}
		value += escaped;
	}
	if (cursor === input.length) {
		throw new AdvancedLinkParseError(
			"UNTERMINATED_QUOTE",
			"Quoted field is missing its closing quote",
			field,
			start,
		);
	}
	if (!value) throw emptyField(field, start);

	cursor++;
	cursor = skipOuterWhitespace(input, cursor);
	if (cursor < input.length && !input.startsWith("::", cursor)) {
		throw new AdvancedLinkParseError(
			"TRAILING_QUOTED_FIELD_CONTENT",
			"Only spaces or tabs may follow a quoted field before its delimiter",
			field,
			cursor,
		);
	}
	return {
		value,
		start,
		end: cursor,
		hasDelimiter: input.startsWith("::", cursor),
	};
}

function skipOuterWhitespace(input: string, start: number): number {
	let cursor = start;
	while (input[cursor] === " " || input[cursor] === "\t") cursor++;
	return cursor;
}

function trimOuterWhitespace(value: string): string {
	let start = 0;
	let end = value.length;
	while (value[start] === " " || value[start] === "\t") start++;
	while (end > start && (value[end - 1] === " " || value[end - 1] === "\t")) end--;
	return value.slice(start, end);
}

function missingDelimiter(field: AdvancedLinkField, position: number): AdvancedLinkParseError {
	return new AdvancedLinkParseError(
		"MISSING_DELIMITER",
		"Advanced Link input must contain exactly two top-level :: delimiters",
		field,
		position,
	);
}

function emptyField(field: AdvancedLinkField, position: number): AdvancedLinkParseError {
	return new AdvancedLinkParseError(
		"EMPTY_FIELD",
		"Advanced Link fields must not be empty",
		field,
		position,
	);
}
