import {
	findAutolinkEnd,
	findInlineCodeEnd,
	findLineEnd,
	findUrlEnd,
	isEscaped,
	isFenceClosing,
	isLineStart,
	isUrlStart,
	type MarkdownFence,
	parseFence,
	parseMarkdownLink,
} from "./markdown_source_scanner.ts";

/** A half-open UTF-16 range in the original Markdown source. */
export interface MarkdownSourceRange {
	start: number;
	end: number;
}

export interface MarkdownTagCandidate {
	/** Tag text without its leading `#`. */
	name: string;
	/** The complete source spelling, including `#`. */
	raw: string;
	range: MarkdownSourceRange;
}

export type RadioraReferenceScope = "work" | "revision";

export interface RadioraInternalReferenceCandidate {
	scope: RadioraReferenceScope;
	id: string;
	fragment?: string;
	/** The Markdown link, including its label and destination. */
	range: MarkdownSourceRange;
	/** The `radiora://` destination within `range`. */
	destinationRange: MarkdownSourceRange;
}

export interface MarkdownCandidates {
	tags: MarkdownTagCandidate[];
	internalReferences: RadioraInternalReferenceCandidate[];
}

export interface InternalReferenceRewriteContext {
	reference: RadioraInternalReferenceCandidate;
	/** Original Markdown label source, without its surrounding brackets. */
	label: string;
	/** Complete canonical Markdown link source. */
	raw: string;
}

/**
 * Extracts Radiora's inline Markdown metadata in one source-order scan.
 *
 * The parser deliberately recognizes only the canonical, ID-bearing Markdown
 * link form for internal references. It leaves resolution and validation of
 * those IDs to later layers.
 */
export function parseMarkdownCandidates(source: string): MarkdownCandidates {
	const tags: MarkdownTagCandidate[] = [];
	const internalReferences: RadioraInternalReferenceCandidate[] = [];
	let fence: MarkdownFence | null = null;
	let index = 0;

	while (index < source.length) {
		if (isLineStart(source, index)) {
			const lineEnd = findLineEnd(source, index);
			const line = source.slice(index, lineEnd);
			const lineFence = parseFence(line);
			if (fence) {
				if (isFenceClosing(line, fence)) fence = null;
				index = lineEnd;
				continue;
			}
			if (lineFence) {
				fence = lineFence;
				index = lineEnd;
				continue;
			}
		}

		const character = source[index];
		if (character === "`") {
			const end = findInlineCodeEnd(source, index);
			if (end !== null) {
				index = end;
				continue;
			}
		}
		if (character === "<") {
			const end = findAutolinkEnd(source, index);
			if (end !== null) {
				index = end;
				continue;
			}
		}
		if (character === "[" && !isEscaped(source, index)) {
			const link = parseMarkdownLink(source, index);
			if (link) {
				const reference = parseRadioraDestination(
					source,
					link.destinationStart,
					link.destinationEnd,
				);
				if (reference) internalReferences.push({ ...reference, range: link.range });
				// The label is ordinary Markdown text. Continue through it so a tag
				// in `[label #tag](destination)` is not lost; the destination itself
				// will be skipped as a plain URL below.
				index++;
				continue;
			}
		}
		if (isUrlStart(source, index)) {
			index = findUrlEnd(source, index);
			continue;
		}
		if (character === "#" && !isEscaped(source, index) && isTagBoundary(source, index)) {
			const tag = parseTag(source, index);
			if (tag) {
				tags.push(tag);
				index = tag.range.end;
				continue;
			}
		}
		index++;
	}

	return { tags, internalReferences };
}

/**
 * Rewrites parser-recognized canonical references without touching code, URLs,
 * escaped link spellings, or malformed Markdown.
 */
export function rewriteCanonicalInternalReferences(
	source: string,
	replacer: (context: InternalReferenceRewriteContext) => string | null,
): string {
	const references = parseMarkdownCandidates(source).internalReferences;
	let rewritten = source;
	for (const reference of [...references].reverse()) {
		const link = parseMarkdownLink(source, reference.range.start);
		if (!link || link.range.end !== reference.range.end) continue;
		const replacement = replacer({
			reference,
			label: source.slice(reference.range.start + 1, link.labelEnd),
			raw: source.slice(reference.range.start, reference.range.end),
		});
		if (replacement === null) continue;
		rewritten = rewritten.slice(0, reference.range.start) +
			replacement +
			rewritten.slice(reference.range.end);
	}
	return rewritten;
}

function parseRadioraDestination(
	source: string,
	start: number,
	end: number,
): Omit<RadioraInternalReferenceCandidate, "range"> | null {
	const destination = source.slice(start, end);
	const match = /^radiora:\/\/(work|revision)\/([^/?#\s]+)(?:#([^\s]*))?$/.exec(destination);
	if (!match) return null;
	return {
		scope: match[1] as RadioraReferenceScope,
		id: match[2],
		...(match[3] === undefined ? {} : { fragment: match[3] }),
		destinationRange: { start, end },
	};
}

function isTagBoundary(source: string, index: number): boolean {
	return index === 0 || /[\s\p{P}]/u.test(source[index - 1]);
}

function parseTag(source: string, start: number): MarkdownTagCandidate | null {
	const first = readCodePoint(source, start + 1);
	if (!first || !/[\p{L}_-]/u.test(first.value)) return null;
	let end = first.end;
	while (true) {
		const character = readCodePoint(source, end);
		if (!character || !/[\p{L}\p{N}_\-/]/u.test(character.value)) break;
		end = character.end;
	}
	return {
		name: source.slice(start + 1, end),
		raw: source.slice(start, end),
		range: { start, end },
	};
}

function readCodePoint(source: string, start: number): { value: string; end: number } | null {
	const value = source.codePointAt(start);
	if (value === undefined) return null;
	const character = String.fromCodePoint(value);
	return { value: character, end: start + character.length };
}
