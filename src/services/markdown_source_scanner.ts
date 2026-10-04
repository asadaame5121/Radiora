/**
 * Lexical scanning for Radiora's Markdown subset, using UTF-16 source offsets.
 * These helpers recognize source regions; they do not resolve metadata or parse
 * semantic-link fields. Callers retain their own link-label traversal policy.
 */
export interface MarkdownFence {
	marker: "`" | "~";
	length: number;
}

export function isLineStart(source: string, index: number): boolean {
	return index === 0 || source[index - 1] === "\n" || source[index - 1] === "\r";
}

export function findLineEnd(source: string, start: number): number {
	const lineFeed = source.indexOf("\n", start);
	const carriageReturn = source.indexOf("\r", start);
	if (lineFeed < 0) return carriageReturn < 0 ? source.length : carriageReturn;
	if (carriageReturn < 0) return lineFeed;
	return Math.min(lineFeed, carriageReturn);
}

export function advancePastLineBreak(source: string, lineEnd: number): number {
	if (lineEnd >= source.length) return lineEnd;
	if (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n") return lineEnd + 2;
	return lineEnd + 1;
}

export function parseFence(line: string): MarkdownFence | null {
	const match = /^(?: {0,3})(?:(`{3,})[^`]*|(~{3,})[^~]*)$/.exec(line);
	if (!match) return null;
	const run = match[1] ?? match[2];
	return { marker: run[0] as "`" | "~", length: run.length };
}

export function isFenceClosing(line: string, fence: MarkdownFence): boolean {
	const match = /^(?: {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
	return match?.[1][0] === fence.marker && match[1].length >= fence.length;
}

export function findInlineCodeEnd(source: string, start: number): number | null {
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

export function findAutolinkEnd(source: string, start: number): number | null {
	const end = source.indexOf(">", start + 1);
	if (end < 0) return null;
	return /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^ <>]*$/i.test(source.slice(start + 1, end))
		? end + 1
		: null;
}

export function parseMarkdownLink(
	source: string,
	start: number,
): {
	range: { start: number; end: number };
	labelEnd: number;
	destinationStart: number;
	destinationEnd: number;
} | null {
	const labelEnd = findLinkLabelEnd(source, start);
	if (labelEnd === null) return null;
	let destinationStart = labelEnd + 1;
	while (source[destinationStart] === " " || source[destinationStart] === "\t") destinationStart++;
	if (source[destinationStart] !== "(") return null;
	destinationStart++;
	if (source[destinationStart] === "<") destinationStart++;
	let destinationEnd = findLinkDestinationEnd(source, destinationStart);
	if (destinationEnd === null) return null;
	const hasAngleDestination = source[destinationStart - 1] === "<";
	if (hasAngleDestination) {
		if (source[destinationEnd - 1] !== ">") return null;
		destinationEnd--;
	}
	return {
		range: { start, end: destinationEnd + (hasAngleDestination ? 2 : 1) },
		labelEnd,
		destinationStart,
		destinationEnd,
	};
}

export function isUrlStart(source: string, index: number): boolean {
	if (index > 0 && !isUrlBoundary(source[index - 1])) return false;
	return /^(?:https?|ftp|radiora):\/\//i.test(source.slice(index));
}

export function isUrlBoundary(character: string): boolean {
	return /[\s\p{P}]/u.test(character);
}

export function findUrlEnd(source: string, start: number): number {
	let end = start;
	while (end < source.length && !/[\s<>、。！？「」]/u.test(source[end])) end++;
	return end;
}

export function isEscaped(source: string, index: number): boolean {
	let count = 0;
	for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--) count++;
	return count % 2 === 1;
}

/** Stateful exclusion scan for semantic links. Call in source order. */
export class MarkdownExclusionScanner {
	private fence: MarkdownFence | null = null;

	constructor(private readonly source: string) {}

	/** Skip fenced lines before attempting any inline grammar. */
	skipFencedRegion(index: number): number | null {
		const source = this.source;
		if (isLineStart(source, index)) {
			const lineEnd = findLineEnd(source, index);
			const line = source.slice(index, lineEnd);
			if (this.fence) {
				if (isFenceClosing(line, this.fence)) this.fence = null;
				return advancePastLineBreak(source, lineEnd);
			}
			const opening = parseFence(line);
			if (opening) {
				this.fence = opening;
				return advancePastLineBreak(source, lineEnd);
			}
		}
		return this.fence ? advancePastLineBreak(source, findLineEnd(source, index)) : null;
	}

	/**
	 * Skip code, autolinks, complete Markdown links (including labels), and URLs.
	 * The caller tries its semantic opening first; `[[` is left to that grammar.
	 * Unclosed Markdown constructs remain ordinary text.
	 */
	skipInlineRegion(index: number): number | null {
		const source = this.source;
		if (source[index] === "`") return findInlineCodeEnd(source, index);
		if (source[index] === "<") return findAutolinkEnd(source, index);
		if (source[index] === "[" && !source.startsWith("[[", index) && !isEscaped(source, index)) {
			return parseMarkdownLink(source, index)?.range.end ?? null;
		}
		return isUrlStart(source, index) ? findUrlEnd(source, index) : null;
	}
}

function findLinkLabelEnd(source: string, start: number): number | null {
	let depth = 1;
	let labelEnd = start + 1;
	for (; labelEnd < source.length; labelEnd++) {
		if (isEscaped(source, labelEnd)) continue;
		if (source[labelEnd] === "[") depth++;
		if (source[labelEnd] === "]" && --depth === 0) break;
	}
	return depth === 0 ? labelEnd : null;
}

function findLinkDestinationEnd(source: string, destinationStart: number): number | null {
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
	return destinationEnd === source.length ? null : destinationEnd;
}
