import type { OutlineItem } from "../domain/models.ts";

export const DEFAULT_RECENT_EDITED_LIMIT = 6;

export interface RankRecentEditedItemsOptions {
	readonly items: readonly OutlineItem[];
	readonly stashItemIds?: readonly string[];
	readonly limit?: number;
}

export function rankRecentEditedItems(options: RankRecentEditedItemsOptions): OutlineItem[] {
	const limit = options.limit ?? DEFAULT_RECENT_EDITED_LIMIT;
	if (limit <= 0) return [];

	const stashedIds = new Set(options.stashItemIds ?? []);
	const bestByWork = new Map<string, { item: OutlineItem; time: number }>();

	for (const item of options.items) {
		if (stashedIds.has(item.id)) continue;
		const parsed = Date.parse(item.updatedAt);
		const time = Number.isNaN(parsed) ? 0 : parsed;
		const existing = bestByWork.get(item.workId);
		if (!existing) {
			bestByWork.set(item.workId, { item, time });
		} else {
			if (
				time > existing.time ||
				(time === existing.time && item.id.localeCompare(existing.item.id) < 0)
			) {
				bestByWork.set(item.workId, { item, time });
			}
		}
	}

	const top: Array<{ item: OutlineItem; time: number }> = [];

	for (const candidate of bestByWork.values()) {
		if (top.length < limit) {
			top.push(candidate);
			top.sort((a, b) => b.time - a.time || a.item.id.localeCompare(b.item.id));
		} else {
			const worst = top[top.length - 1];
			const isBetter = candidate.time > worst.time ||
				(candidate.time === worst.time && candidate.item.id.localeCompare(worst.item.id) < 0);
			if (isBetter) {
				top[top.length - 1] = candidate;
				top.sort((a, b) => b.time - a.time || a.item.id.localeCompare(b.item.id));
			}
		}
	}

	return top.map((entry) => entry.item);
}
