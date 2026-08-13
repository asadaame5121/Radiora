import type { LexicalHit, OutlineItem } from "../domain/models.ts";
import {
	countOccurrences,
	normalizeSearchText,
	searchTerms,
	titleOf,
} from "../services/search_text.ts";

export function suggestMemoryItems(
	items: readonly OutlineItem[],
	prefix: string,
	limit: number,
): OutlineItem[] {
	const normalized = normalizeSearchText(prefix);
	if (!normalized) return [];
	return items
		.filter((item) => normalizeSearchText(titleOf(item)).startsWith(normalized))
		.sort((a, b) => titleOf(a).length - titleOf(b).length || b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, limit);
}

export function searchMemoryItems(
	items: readonly OutlineItem[],
	query: string,
	limit: number,
): LexicalHit[] {
	const normalized = normalizeSearchText(query);
	const tokenized = searchTerms(query).split(" ").filter(Boolean);
	if (!normalized) return [];
	return items.map((item) => {
		const title = normalizeSearchText(titleOf(item));
		const body = normalizeSearchText(item.text);
		const titleCount = countOccurrences(title, normalized) +
			tokenized.reduce((score, token) => score + countOccurrences(title, token), 0);
		const bodyCount = countOccurrences(body, normalized) +
			tokenized.reduce((score, token) => score + countOccurrences(body, token), 0);
		return {
			item,
			titleScore: title === normalized ? 3 : title.startsWith(normalized) ? 2 : titleCount,
			bodyScore: bodyCount,
		};
	}).filter((hit) => hit.titleScore > 0 || hit.bodyScore > 0)
		.sort((a, b) => (b.titleScore * 2 + b.bodyScore) - (a.titleScore * 2 + a.bodyScore))
		.slice(0, limit);
}
