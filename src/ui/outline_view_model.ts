import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { BrowsingOutlineProjection } from "../services/browsing_navigation_state.ts";

export type VisibleRow = {
	item: OutlineItem;
	depth: number;
	hasChildren: boolean;
	stash: boolean;
};

function buildNormalHierarchy(normalItems: readonly OutlineItem[]): {
	itemById: Map<string, OutlineItem>;
	children: Map<string | null, OutlineItem[]>;
} {
	const itemById = new Map<string, OutlineItem>();
	const children = new Map<string | null, OutlineItem[]>();
	const normalIds = new Set(normalItems.map((item) => item.id));
	for (const item of normalItems) {
		itemById.set(item.id, item);
		const parent = item.parentId && normalIds.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parent) ?? [];
		bucket.push(item);
		children.set(parent, bucket);
	}
	for (const bucket of children.values()) bucket.sort((a, b) => a.orderKey - b.orderKey);
	return { itemById, children };
}

function rootItems(
	rootOccurrenceIds: readonly string[],
	itemById: ReadonlyMap<string, OutlineItem>,
): OutlineItem[] {
	return rootOccurrenceIds
		.map((id) => itemById.get(id))
		.filter((item): item is OutlineItem => Boolean(item))
		.sort((a, b) => a.orderKey - b.orderKey);
}

function normalVisibleRows(
	roots: readonly OutlineItem[],
	children: ReadonlyMap<string | null, OutlineItem[]>,
	transientExpandedIds: readonly string[],
): VisibleRow[] {
	const transientExpandedSet = new Set(transientExpandedIds);
	const rows: VisibleRow[] = [];
	const stack: { item: OutlineItem; depth: number }[] = [];
	for (let i = roots.length - 1; i >= 0; i--) stack.push({ item: roots[i], depth: 0 });
	while (stack.length > 0) {
		const entry = stack.pop();
		if (!entry) continue;
		const { item, depth } = entry;
		const descendants = item.referenceStub ? [] : (children.get(item.id) ?? []);
		rows.push({ item, depth, hasChildren: descendants.length > 0, stash: false });
		if (!item.collapsed || transientExpandedSet.has(item.id)) {
			for (let i = descendants.length - 1; i >= 0; i--) {
				stack.push({ item: descendants[i], depth: depth + 1 });
			}
		}
	}
	return rows;
}

export function buildVisibleRows(
	snapshot: OutlineSnapshot,
	projection: BrowsingOutlineProjection,
	transientExpandedIds: readonly string[],
	showStash: boolean,
): VisibleRow[] {
	const stash = new Set(snapshot.stashItemIds);
	const normalItems = projection.items.filter((item) => !stash.has(item.id));
	const hierarchy = buildNormalHierarchy(normalItems);
	const roots = rootItems(projection.rootOccurrenceIds, hierarchy.itemById);
	const rows = normalVisibleRows(roots, hierarchy.children, transientExpandedIds);
	if (showStash) {
		const stashItems = snapshot.items
			.filter((item) => stash.has(item.id))
			.sort((a, b) => a.orderKey - b.orderKey);
		for (const item of stashItems) rows.push({ item, depth: 0, hasChildren: false, stash: true });
	}
	return rows;
}
