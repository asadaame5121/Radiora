import type { OutlineItem } from "../domain/models.ts";

export const DEFAULT_RECENT_EDITED_LIMIT = 6;

export interface RankRecentEditedItemsOptions {
	readonly items: readonly OutlineItem[];
	readonly stashItemIds?: readonly string[];
	readonly limit?: number;
}

interface TopEntry {
	item: OutlineItem;
	time: number;
	inputIndex: number;
}

function compareEntries(a: TopEntry, b: TopEntry): number {
	return (
		b.time - a.time ||
		a.item.id.localeCompare(b.item.id) ||
		a.inputIndex - b.inputIndex
	);
}

function normalizeLimit(rawLimit?: number): number {
	if (rawLimit === undefined) return DEFAULT_RECENT_EDITED_LIMIT;
	if (Number.isNaN(rawLimit) || rawLimit <= 0) return 0;
	if (!Number.isFinite(rawLimit)) return Number.MAX_SAFE_INTEGER;
	return Math.floor(rawLimit);
}

function insertSorted(top: TopEntry[], candidate: TopEntry): void {
	const index = top.findIndex((entry) => compareEntries(candidate, entry) < 0);
	if (index < 0) top.push(candidate);
	else top.splice(index, 0, candidate);
}

function retainCandidate(top: TopEntry[], candidate: TopEntry, limit: number): void {
	const existingIndex = top.findIndex((entry) => entry.item.workId === candidate.item.workId);
	if (existingIndex >= 0) {
		if (compareEntries(candidate, top[existingIndex]) < 0) {
			top.splice(existingIndex, 1);
			insertSorted(top, candidate);
		}
		return;
	}
	if (top.length < limit) {
		insertSorted(top, candidate);
		return;
	}
	if (compareEntries(candidate, top[top.length - 1]) < 0) {
		insertSorted(top, candidate);
		top.pop();
	}
}

export function rankRecentEditedItems(options: RankRecentEditedItemsOptions): OutlineItem[] {
	const limit = normalizeLimit(options.limit);
	if (limit <= 0) return [];

	const stashedIds = options.stashItemIds && options.stashItemIds.length > 0
		? new Set(options.stashItemIds)
		: null;

	const top: TopEntry[] = [];

	for (let i = 0; i < options.items.length; i++) {
		const item = options.items[i];
		if (stashedIds?.has(item.id)) continue;

		const parsed = Date.parse(item.updatedAt);
		const time = Number.isNaN(parsed) ? 0 : parsed;
		const candidate: TopEntry = { item, time, inputIndex: i };
		retainCandidate(top, candidate, limit);
	}

	return top.map((entry) => entry.item);
}
