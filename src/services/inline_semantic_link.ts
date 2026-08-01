import { LINK_TYPES, type LinkType } from "../domain/models.ts";

/** A half-open UTF-16 range in the original outline body. */
export interface InlineSemanticLinkRange {
	start: number;
	end: number;
}

export type InlineSemanticLinkDiagnosticCode =
	| "SYNTAX_ERROR"
	| "UNKNOWN_TYPE"
	| "UNTERMINATED_LINK";

export type InlineSemanticLinkDiagnosticField =
	| "source"
	| "type"
	| "reason"
	| "target"
	| "link";

/** A syntactically valid inline semantic-link candidate. */
export interface InlineSemanticLinkCandidate {
	start: number;
	end: number;
	range: InlineSemanticLinkRange;
	/** The complete source spelling, including `[[` and `]]`. */
	raw: string;
	source: string;
	type: LinkType;
	target: string;
	reason?: string;
}

/** A machine-readable diagnostic for an inline semantic-link spelling. */
export interface InlineSemanticLinkDiagnostic {
	code: InlineSemanticLinkDiagnosticCode;
	field: InlineSemanticLinkDiagnosticField;
	message: string;
	start: number;
	end: number;
	range: InlineSemanticLinkRange;
}

export interface InlineSemanticLinkParseResult {
	candidates: InlineSemanticLinkCandidate[];
	diagnostics: InlineSemanticLinkDiagnostic[];
}

interface ParsedEndpoint {
	value: string;
	next: number;
}

interface ParsedType {
	value: LinkType | null;
	reason?: string;
	next: number;
	typeStart: number;
	typeEnd: number;
}

interface ParseFailure {
	code: Exclude<InlineSemanticLinkDiagnosticCode, "UNTERMINATED_LINK">;
	field: InlineSemanticLinkDiagnosticField;
	message: string;
	start: number;
	end: number;
}

type BodyParseResult =
	| {
		kind: "success";
		source: string;
		type: LinkType;
		target: string;
		reason?: string;
	}
	| { kind: "failure"; failure: ParseFailure };

/**
 * Parses inline semantic-link candidates from an outline body.
 *
 * The parser is deliberately read-only: it only recognizes syntax and reports
 * diagnostics. Endpoint resolution and any creation of Works, Stubs, or Links
 * belong to later layers.
 */
export function parseInlineSemanticLinks(source: string): InlineSemanticLinkParseResult {
	const candidates: InlineSemanticLinkCandidate[] = [];
	const diagnostics: InlineSemanticLinkDiagnostic[] = [];
	let index = 0;
	let fence: Fence | null = null;

	while (index < source.length) {
		if (isLineStart(source, index)) {
			const lineEnd = findLineEnd(source, index);
			const line = source.slice(index, lineEnd);
			if (fence) {
				if (isFenceClosing(line, fence)) fence = null;
				index = advancePastLineBreak(source, lineEnd);
				continue;
			}
			const lineFence = parseFence(line);
			if (lineFence) {
				fence = lineFence;
				index = advancePastLineBreak(source, lineEnd);
				continue;
			}
		}

		if (fence) {
			index = advancePastLineBreak(source, findLineEnd(source, index));
			continue;
		}

		if (source.startsWith("[[", index) && !isEscaped(source, index)) {
			const closings = findPossibleClosings(source, index);
			if (!closings.length) {
				diagnostics.push({
					code: "UNTERMINATED_LINK",
					field: "link",
					message: "Inline semantic link is missing its closing `]]`",
					start: index,
					end: source.length,
					range: { start: index, end: source.length },
				});
				break;
			}

			let parsed: BodyParseResult | null = null;
			let closing = closings[0];
			for (const possibleClosing of closings) {
				const attempt = parseBody(
					source.slice(index + 2, possibleClosing),
					index + 2,
				);
				if (attempt.kind === "success") {
					parsed = attempt;
					closing = possibleClosing;
					break;
				}
				if (parsed === null) parsed = attempt;
			}

			if (parsed?.kind === "success") {
				const end = closing + 2;
				const candidate: InlineSemanticLinkCandidate = {
					start: index,
					end,
					range: { start: index, end },
					raw: source.slice(index, end),
					source: parsed.source,
					type: parsed.type,
					target: parsed.target,
				};
				if (parsed.reason !== undefined) candidate.reason = parsed.reason;
				candidates.push(candidate);
				index = end;
				continue;
			}

			const failure = parsed?.kind === "failure"
				? parsed.failure
				: syntaxFailure("link", index, closing + 2, "Invalid inline semantic link syntax");
			diagnostics.push({
				code: failure.code,
				field: failure.field,
				message: failure.message,
				start: failure.start,
				end: failure.end,
				range: { start: failure.start, end: failure.end },
			});
			index = closing + 2;
			continue;
		}

		if (source[index] === "`") {
			const end = findInlineCodeEnd(source, index);
			if (end !== null) {
				index = end;
				continue;
			}
		}
		if (source[index] === "<") {
			const end = findAutolinkEnd(source, index);
			if (end !== null) {
				index = end;
				continue;
			}
		}
		if (source[index] === "[") {
			const end = findMarkdownLinkEnd(source, index);
			if (end !== null) {
				index = end;
				continue;
			}
		}
		if (isUrlStart(source, index)) {
			index = findUrlEnd(source, index);
			continue;
		}
		index++;
	}

	return { candidates, diagnostics };
}

/** Short alias for callers that prefer the candidate-oriented name. */
export const parseInlineSemanticLinkCandidates = parseInlineSemanticLinks;

function parseBody(body: string, offset: number): BodyParseResult {
	let cursor = 0;
	const source = readEndpoint(body, cursor, offset, "source", true);
	if (source.kind === "failure") return source;
	cursor = source.value.next;

	const type = readType(body, cursor, offset);
	if (type.kind === "failure") return type;
	cursor = type.value.next;
	if (!type.value.value) {
		return {
			kind: "failure",
			failure: {
				code: "UNKNOWN_TYPE",
				field: "type",
				message: `Unknown inline semantic link type: ${
					body.slice(type.value.typeStart, type.value.typeEnd)
				}`,
				start: offset + type.value.typeStart,
				end: offset + type.value.typeEnd,
			},
		};
	}

	const target = readEndpoint(body, cursor, offset, "target", false);
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
	requireDelimiter: boolean,
):
	| { kind: "success"; value: ParsedEndpoint }
	| { kind: "failure"; failure: ParseFailure } {
	cursor = skipHorizontalWhitespace(input, cursor);
	const fieldStart = cursor;
	let value: string;

	if (input[cursor] === '"') {
		const quoted = readQuoted(input, cursor, offset, field, false);
		if (quoted.kind === "failure") return quoted;
		value = quoted.value.value;
		cursor = quoted.value.next;
	} else {
		const tokenStart = cursor;
		while (cursor < input.length) {
			const character = input[cursor];
			if (isWhitespace(character) || input.startsWith("::", cursor)) break;
			if (character === "]" || character === "[") break;
			if (character === '"') {
				return {
					kind: "failure",
					failure: syntaxFailure(
						field,
						offset + cursor,
						offset + cursor + 1,
						"A quote must enclose the complete Source or Target token",
					),
				};
			}
			cursor++;
		}
		if (cursor === tokenStart) {
			return {
				kind: "failure",
				failure: syntaxFailure(
					field,
					offset + fieldStart,
					offset + Math.min(fieldStart + 1, input.length),
					`${field} must be a quoted string or a non-whitespace token`,
				),
			};
		}
		value = input.slice(tokenStart, cursor);
	}

	if (!value) {
		return {
			kind: "failure",
			failure: syntaxFailure(
				field,
				offset + fieldStart,
				offset + Math.max(fieldStart + 1, cursor),
				`${field} must not be empty`,
			),
		};
	}

	cursor = skipHorizontalWhitespace(input, cursor);
	if (requireDelimiter) {
		if (!input.startsWith("::", cursor)) {
			return {
				kind: "failure",
				failure: syntaxFailure(
					field,
					offset + cursor,
					offset + Math.min(cursor + 1, input.length),
					`Expected the :: delimiter after ${field}`,
				),
			};
		}
		return { kind: "success", value: { value, next: cursor + 2 } };
	}

	if (cursor !== input.length) {
		return {
			kind: "failure",
			failure: syntaxFailure(
				"target",
				offset + cursor,
				offset + Math.min(cursor + 2, input.length),
				"Target must be the final field of an inline semantic link",
			),
		};
	}
	return { kind: "success", value: { value, next: cursor } };
}

function readType(
	input: string,
	cursor: number,
	offset: number,
):
	| { kind: "success"; value: ParsedType }
	| { kind: "failure"; failure: ParseFailure } {
	cursor = skipHorizontalWhitespace(input, cursor);
	const typeStart = cursor;
	while (cursor < input.length) {
		const character = input[cursor];
		if (isWhitespace(character) || character === "(" || input.startsWith("::", cursor)) break;
		if (character === "]" || character === "[") break;
		cursor++;
	}
	const typeEnd = cursor;
	if (typeStart === typeEnd) {
		return {
			kind: "failure",
			failure: syntaxFailure(
				"type",
				offset + typeStart,
				offset + Math.min(typeStart + 1, input.length),
				"TYPE must be a link type name",
			),
		};
	}

	cursor = skipHorizontalWhitespace(input, cursor);
	let reason: string | undefined;
	if (input[cursor] === "(") {
		cursor++;
		cursor = skipHorizontalWhitespace(input, cursor);
		if (input[cursor] !== '"') {
			return {
				kind: "failure",
				failure: syntaxFailure(
					"reason",
					offset + cursor,
					offset + Math.min(cursor + 1, input.length),
					"reason must be a quoted string",
				),
			};
		}
		const parsedReason = readQuoted(input, cursor, offset, "reason", true);
		if (parsedReason.kind === "failure") return parsedReason;
		reason = parsedReason.value.value;
		cursor = parsedReason.value.next;
		if (input[cursor] !== ")") {
			return {
				kind: "failure",
				failure: syntaxFailure(
					"reason",
					offset + cursor,
					offset + Math.min(cursor + 1, input.length),
					"reason is missing its closing parenthesis",
				),
			};
		}
		cursor++;
		cursor = skipHorizontalWhitespace(input, cursor);
	}

	if (!input.startsWith("::", cursor)) {
		return {
			kind: "failure",
			failure: syntaxFailure(
				"type",
				offset + cursor,
				offset + Math.min(cursor + 1, input.length),
				"Expected the :: delimiter after TYPE",
			),
		};
	}

	const normalized = input.slice(typeStart, typeEnd).toUpperCase();
	const value = LINK_TYPES.find((candidate) => candidate === normalized) ?? null;
	return {
		kind: "success",
		value: {
			value,
			reason,
			next: cursor + 2,
			typeStart,
			typeEnd,
		},
	};
}

function readQuoted(
	input: string,
	start: number,
	offset: number,
	field: "source" | "target" | "reason",
	allowEmpty: boolean,
):
	| { kind: "success"; value: ParsedEndpoint }
	| { kind: "failure"; failure: ParseFailure } {
	let cursor = start + 1;
	let value = "";
	while (cursor < input.length) {
		const character = input[cursor];
		if (character === '"') {
			cursor++;
			cursor = skipHorizontalWhitespace(input, cursor);
			if (!allowEmpty && !value) {
				return {
					kind: "failure",
					failure: syntaxFailure(
						field,
						offset + start,
						offset + cursor,
						`${field} must not be empty`,
					),
				};
			}
			return { kind: "success", value: { value, next: cursor } };
		}
		if (character === "\r" || character === "\n") {
			return {
				kind: "failure",
				failure: syntaxFailure(
					field,
					offset + cursor,
					offset + cursor + 1,
					"Quoted inline semantic-link fields cannot contain a line break",
				),
			};
		}
		if (character !== "\\") {
			value += character;
			cursor++;
			continue;
		}
		if (cursor + 1 >= input.length || (input[cursor + 1] !== '"' && input[cursor + 1] !== "\\")) {
			return {
				kind: "failure",
				failure: syntaxFailure(
					field,
					offset + cursor,
					offset + Math.min(cursor + 2, input.length),
					"Only escaped quotes and backslashes are allowed in quoted fields",
				),
			};
		}
		value += input[cursor + 1];
		cursor += 2;
	}

	return {
		kind: "failure",
		failure: syntaxFailure(
			field,
			offset + start,
			offset + input.length,
			"Quoted field is missing its closing quote",
		),
	};
}

function syntaxFailure(
	field: InlineSemanticLinkDiagnosticField,
	start: number,
	end: number,
	message: string,
): ParseFailure {
	return { code: "SYNTAX_ERROR", field, message, start, end };
}

function findPossibleClosings(source: string, opening: number): number[] {
	const closings: number[] = [];
	for (let index = opening + 2; index < source.length - 1; index++) {
		if (!source.startsWith("]]", index) || isEscaped(source, index)) continue;
		closings.push(index);
	}
	return closings;
}

interface Fence {
	marker: "`" | "~";
	length: number;
}

function isLineStart(source: string, index: number): boolean {
	return index === 0 || source[index - 1] === "\n" || source[index - 1] === "\r";
}

function findLineEnd(source: string, start: number): number {
	const lineFeed = source.indexOf("\n", start);
	const carriageReturn = source.indexOf("\r", start);
	if (lineFeed < 0) return carriageReturn < 0 ? source.length : carriageReturn;
	if (carriageReturn < 0) return lineFeed;
	return Math.min(lineFeed, carriageReturn);
}

function advancePastLineBreak(source: string, lineEnd: number): number {
	if (lineEnd >= source.length) return lineEnd;
	if (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n") return lineEnd + 2;
	return lineEnd + 1;
}

function parseFence(line: string): Fence | null {
	const match = /^(?: {0,3})(?:(`{3,})[^`]*|(~{3,})[^~]*)$/.exec(line);
	if (!match) return null;
	const run = match[1] ?? match[2];
	return { marker: run[0] as "`" | "~", length: run.length };
}

function isFenceClosing(line: string, fence: Fence): boolean {
	const match = /^(?: {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
	return match?.[1][0] === fence.marker && match[1].length >= fence.length;
}

function findInlineCodeEnd(source: string, start: number): number | null {
	let length = 1;
	while (source[start + length] === "`") length++;
	for (let index = start + length; index < source.length; index++) {
		if (source[index] !== "`") continue;
		let closingLength = 1;
		while (source[index + closingLength] === "`") closingLength++;
		if (closingLength === length) return index + closingLength;
		index += closingLength - 1;
	}
	return null;
}

function findAutolinkEnd(source: string, start: number): number | null {
	const end = source.indexOf(">", start + 1);
	if (end < 0) return null;
	return /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^ <>]*$/i.test(source.slice(start + 1, end))
		? end + 1
		: null;
}

function findMarkdownLinkEnd(source: string, start: number): number | null {
	if (source.startsWith("[[", start) || isEscaped(source, start)) return null;
	let depth = 1;
	let labelEnd = start + 1;
	for (; labelEnd < source.length; labelEnd++) {
		if (isEscaped(source, labelEnd)) continue;
		if (source[labelEnd] === "[") depth++;
		if (source[labelEnd] === "]" && --depth === 0) break;
	}
	if (depth !== 0) return null;

	let destinationStart = labelEnd + 1;
	while (source[destinationStart] === " " || source[destinationStart] === "\t") destinationStart++;
	if (source[destinationStart] !== "(") return null;
	destinationStart++;
	if (source[destinationStart] === "<") destinationStart++;
	let destinationEnd = destinationStart;
	let parentheses = 0;
	for (; destinationEnd < source.length; destinationEnd++) {
		if (isEscaped(source, destinationEnd)) continue;
		const character = source[destinationEnd];
		if (character === "(") parentheses++;
		if (character === ")") {
			if (parentheses === 0) break;
			parentheses--;
		}
	}
	if (destinationEnd === source.length) return null;
	if (source[destinationStart - 1] === "<") {
		if (source[destinationEnd - 1] !== ">") return null;
	}
	return destinationEnd + 1;
}

function isUrlStart(source: string, index: number): boolean {
	if (index > 0 && !isUrlBoundary(source[index - 1])) return false;
	return /^(?:https?|ftp|radiora):\/\//i.test(source.slice(index));
}

function isUrlBoundary(character: string): boolean {
	return /[\s\p{P}]/u.test(character);
}

function findUrlEnd(source: string, start: number): number {
	let end = start;
	while (end < source.length && !/[\s<>、。！？「」]/u.test(source[end])) end++;
	return end;
}

function isWhitespace(character: string | undefined): boolean {
	return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function skipHorizontalWhitespace(source: string, start: number): number {
	let index = start;
	while (source[index] === " " || source[index] === "\t") index++;
	return index;
}

function isEscaped(source: string, index: number): boolean {
	let count = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) count++;
	return count % 2 === 1;
}
