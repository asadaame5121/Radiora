import type { MarkdownSourceRange } from "./markdown_parser.ts";

export interface InlineLinkTrigger {
	query: string;
	range: MarkdownSourceRange;
}

/**
 * Finds an inline semantic-link mention immediately before the caret.
 *
 * The trigger is intentionally conservative: mentions in words, code, URLs,
 * Markdown destinations, fenced blocks, and escaped `@` characters are left
 * untouched. The caller can therefore use this helper on every input event.
 */
export function findInlineLinkTrigger(
	source: string,
	selectionStart: number,
	selectionEnd = selectionStart,
): InlineLinkTrigger | null {
	if (
		!Number.isSafeInteger(selectionStart) || !Number.isSafeInteger(selectionEnd) ||
		selectionStart < 0 || selectionEnd < selectionStart || selectionEnd > source.length
	) return null;

	const at = source.lastIndexOf("@", selectionStart);
	if (at < 0 || isEscaped(source, at) || !validBoundary(source, at)) return null;
	if (isInsideIgnoredMarkdown(source, at)) return null;

	const query = source.slice(at + 1, selectionStart);
	if (/[\r\n\[\]`]/u.test(query)) return null;
	return { query: query.trimStart(), range: { start: at, end: selectionEnd } };
}

export function replaceInlineLinkTrigger(
	source: string,
	range: MarkdownSourceRange,
	markdown: string,
): { text: string; caretOffset: number } {
	if (
		!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
		range.start < 0 || range.end < range.start || range.end > source.length
	) throw new Error("Invalid inline-link replacement range");
	return {
		text: source.slice(0, range.start) + markdown + source.slice(range.end),
		caretOffset: range.start + markdown.length,
	};
}

function validBoundary(source: string, at: number): boolean {
	if (at === 0) return true;
	const previous = source[at - 1];
	return /[\s\p{P}\p{S}]/u.test(previous) && previous !== "\\";
}

function isInsideIgnoredMarkdown(source: string, at: number): boolean {
	const codeLineStart = Math.max(
		source.lastIndexOf("\n", at - 1) + 1,
		source.lastIndexOf("\r", at - 1) + 1,
	);
	const beforeLine = source.slice(codeLineStart, at);
	if (isInsideInlineCode(beforeLine)) return true;
	if (isInsideFence(source, at)) return true;

	const linkStart = source.lastIndexOf("[", at);
	if (linkStart >= 0) {
		const linkLabelEnd = source.indexOf("](", linkStart);
		if (linkLabelEnd > linkStart && at <= linkLabelEnd) return true;
		if (linkLabelEnd >= 0 && linkLabelEnd < at) {
			const linkEnd = findClosingParenthesis(source, linkLabelEnd + 2);
			if (linkEnd >= at) return true;
		}
	}

	const urlLineStart =
		Math.max(source.lastIndexOf("\n", at - 1), source.lastIndexOf("\r", at - 1)) + 1;
	const linePrefix = source.slice(urlLineStart, at);
	return /(?:^|[\s([<{])(?:https?|ftp|radiora):\/\/[^\s]*$/iu.test(linePrefix);
}

function isInsideInlineCode(beforeLine: string): boolean {
	let fenceLength = 0;
	for (let index = 0; index < beforeLine.length; index++) {
		if (beforeLine[index] !== "`") continue;
		let length = 1;
		while (beforeLine[index + length] === "`") length++;
		if (fenceLength === 0) fenceLength = length;
		else if (length === fenceLength) fenceLength = 0;
		index += length - 1;
	}
	return fenceLength > 0;
}

function isInsideFence(source: string, at: number): boolean {
	let fenced = false;
	let cursor = 0;
	while (cursor < at) {
		const lineEnd = findLineEnd(source, cursor);
		const line = source.slice(cursor, lineEnd);
		if (/^\s{0,3}(?:`{3,}|~{3,})/u.test(line)) fenced = !fenced;
		cursor = lineEnd < source.length ? lineEnd + 1 : lineEnd;
	}
	return fenced;
}

function findLineEnd(source: string, start: number): number {
	const lineFeed = source.indexOf("\n", start);
	const carriageReturn = source.indexOf("\r", start);
	if (lineFeed < 0) return carriageReturn < 0 ? source.length : carriageReturn;
	if (carriageReturn < 0) return lineFeed;
	return Math.min(lineFeed, carriageReturn);
}

function findClosingParenthesis(source: string, start: number): number {
	let depth = 1;
	for (let index = start; index < source.length; index++) {
		if (isEscaped(source, index)) continue;
		if (source[index] === "(") depth++;
		if (source[index] === ")" && --depth === 0) return index + 1;
	}
	return source.length;
}

function isEscaped(source: string, index: number): boolean {
	let backslashes = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) backslashes++;
	return backslashes % 2 === 1;
}
