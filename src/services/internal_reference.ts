import type { MarkdownSourceRange, RadioraReferenceScope } from "./markdown_parser.ts";

export interface InternalReferenceTrigger {
	query: string;
	range: MarkdownSourceRange;
}

export function canonicalInternalReferenceMarkdown(
	label: string,
	scope: RadioraReferenceScope,
	id: string,
): string {
	if (!/^[-._~A-Za-z0-9]+$/u.test(id)) throw new Error(`Invalid Radiora reference ID: ${id}`);
	const escapedLabel = label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
	return `[${escapedLabel}](radiora://${scope}/${id})`;
}

export function findInternalReferenceTrigger(
	source: string,
	selectionStart: number,
	selectionEnd = selectionStart,
): InternalReferenceTrigger | null {
	if (
		!Number.isSafeInteger(selectionStart) || !Number.isSafeInteger(selectionEnd) ||
		selectionStart < 0 || selectionEnd < selectionStart || selectionEnd > source.length
	) return null;
	const opening = source.lastIndexOf("[[", selectionStart);
	if (opening < 0) return null;
	const between = source.slice(opening + 2, selectionStart);
	if (/[\]\r\n]/u.test(between)) return null;
	return {
		query: between.trim(),
		range: { start: opening, end: selectionEnd },
	};
}

export function replaceInternalReferenceTrigger(
	source: string,
	range: MarkdownSourceRange,
	markdown: string,
): { text: string; caretOffset: number } {
	if (
		!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
		range.start < 0 || range.end < range.start || range.end > source.length
	) throw new Error("Invalid internal reference replacement range");
	return {
		text: source.slice(0, range.start) + markdown + source.slice(range.end),
		caretOffset: range.start + markdown.length,
	};
}
