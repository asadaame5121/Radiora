import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { BrowsingOutlineProjection } from "../services/browsing_navigation_state.ts";

export type VisibleRow = {
	item: OutlineItem;
	depth: number;
	hasChildren: boolean;
	stash: boolean;
};

export function buildVisibleRows(
	snapshot: OutlineSnapshot,
	projection: BrowsingOutlineProjection,
	transientExpandedIds: readonly string[],
	showStash: boolean,
): VisibleRow[] {
	const stash = new Set(snapshot.stashItemIds);
	const normalItems = projection.items.filter((item) => !stash.has(item.id));
	const normalIds = new Set(normalItems.map((item) => item.id));
	const normalItemById = new Map<string, OutlineItem>();
	const children = new Map<string | null, OutlineItem[]>();
	for (const item of normalItems) {
		normalItemById.set(item.id, item);
		const parent = item.parentId && normalIds.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parent) ?? [];
		bucket.push(item);
		children.set(parent, bucket);
	}
	for (const bucket of children.values()) bucket.sort((a, b) => a.orderKey - b.orderKey);

	const transientExpandedSet = new Set(transientExpandedIds);
	const rows: VisibleRow[] = [];

	const roots = projection.rootOccurrenceIds
		.map((id) => normalItemById.get(id))
		.filter((item): item is OutlineItem => Boolean(item))
		.sort((a, b) => a.orderKey - b.orderKey);

	const stack: { item: OutlineItem; depth: number }[] = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({ item: roots[i], depth: 0 });
	}

	while (stack.length > 0) {
		const { item, depth } = stack.pop()!;
		const descendants = item.referenceStub ? [] : children.get(item.id) ?? [];
		rows.push({ item, depth, hasChildren: descendants.length > 0, stash: false });
		if (!item.collapsed || transientExpandedSet.has(item.id)) {
			for (let i = descendants.length - 1; i >= 0; i--) {
				stack.push({ item: descendants[i], depth: depth + 1 });
			}
		}
	}

	if (showStash) {
		snapshot.items.filter((item) => stash.has(item.id)).sort((a, b) => a.orderKey - b.orderKey)
			.forEach((item) => rows.push({ item, depth: 0, hasChildren: false, stash: true }));
	}
	return rows;
}
