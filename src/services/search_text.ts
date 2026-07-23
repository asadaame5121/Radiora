import type { OutlineItem } from "../domain/models.ts";

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

export function normalizeSearchText(value: string): string {
	return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function titleFromText(value: string): string {
	return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

export function searchTerms(value: string): string {
	return [...segmenter.segment(normalizeSearchText(value))]
		.filter((part) => part.isWordLike)
		.map((part) => part.segment)
		.join(" ");
}

export function titleOf(item: OutlineItem): string {
	return titleFromText(item.text);
}

export function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while ((offset = haystack.indexOf(needle, offset)) >= 0) {
		count++;
		offset += Math.max(1, needle.length);
	}
	return count;
}
