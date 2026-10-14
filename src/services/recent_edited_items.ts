import type { OutlineItem } from "../domain/models.ts";

export const DEFAULT_RECENT_EDITED_LIMIT = 6;

export interface RankRecentEditedItemsOptions {
	readonly items: readonly OutlineItem[];
	readonly stashItemIds?: readonly string[];
	readonly limit?: number;
}

function normalizeLimit(rawLimit?: number): number {
	if (rawLimit === undefined) return DEFAULT_RECENT_EDITED_LIMIT;
	if (Number.isNaN(rawLimit) || rawLimit <= 0) return 0;
	if (!Number.isFinite(rawLimit)) return Number.MAX_SAFE_INTEGER;
	return Math.floor(rawLimit);
}

export function rankRecentEditedItems(options: RankRecentEditedItemsOptions): OutlineItem[] {
	const stashedIds = new Set(options.stashItemIds ?? []);
	const seenWorkIds = new Set<string>();
	const limit = normalizeLimit(options.limit);
	if (limit === 0) return [];

	return [...options.items]
		.filter((item) => !stashedIds.has(item.id))
		.sort((left, right) => {
			const leftTime = Date.parse(left.updatedAt);
			const rightTime = Date.parse(right.updatedAt);
			return (
				(Number.isNaN(rightTime) ? 0 : rightTime) -
					(Number.isNaN(leftTime) ? 0 : leftTime) ||
				left.id.localeCompare(right.id)
			);
		})
		.filter((item) => {
			if (seenWorkIds.has(item.workId)) return false;
			seenWorkIds.add(item.workId);
			return true;
		})
		.slice(0, limit);
}
