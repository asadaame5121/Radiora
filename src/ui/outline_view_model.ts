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
	const children = new Map<string | null, OutlineItem[]>();
	for (const item of normalItems) {
		const parent = item.parentId && normalIds.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parent) ?? [];
		bucket.push(item);
		children.set(parent, bucket);
	}
	for (const bucket of children.values()) bucket.sort((a, b) => a.orderKey - b.orderKey);
	const rows: VisibleRow[] = [];
	const visit = (item: OutlineItem, depth: number) => {
		const descendants = item.referenceStub ? [] : children.get(item.id) ?? [];
		rows.push({ item, depth, hasChildren: descendants.length > 0, stash: false });
		if (!item.collapsed || transientExpandedIds.includes(item.id)) {
			descendants.forEach((child) => visit(child, depth + 1));
		}
	};
	projection.rootOccurrenceIds
		.map((id) => normalItems.find((item) => item.id === id))
		.filter((item): item is OutlineItem => Boolean(item))
		.forEach((root) => visit(root, 0));
	if (showStash) {
		snapshot.items.filter((item) => stash.has(item.id)).sort((a, b) => a.orderKey - b.orderKey)
			.forEach((item) => rows.push({ item, depth: 0, hasChildren: false, stash: true }));
	}
	return rows;
}
