import type {
	OutlineItem,
	OutlineLink,
	SearchReason,
	SearchResult,
	TransientProjectionNode,
	TransientProjectionSource,
} from "../domain/models.ts";

interface SparseEntry {
	item: OutlineItem;
	isMatched: boolean;
	breadcrumb?: string[];
	reasons?: SearchReason[];
	score?: number;
}

export function buildSparseOutline(
	results: SearchResult[],
	items: OutlineItem[],
	links: OutlineLink[],
	sourceType: TransientProjectionSource = "search",
): TransientProjectionNode[] {
	const itemsById = new Map(items.map((i) => [i.id, i]));
	const itemsByWorkId = new Map<string, OutlineItem>();
	for (const item of items) {
		if (!itemsByWorkId.has(item.workId)) {
			itemsByWorkId.set(item.workId, item);
		}
	}

	const included = new Map<string, SparseEntry>();

	for (const result of results) {
		for (const ancestorId of result.ancestorIds) {
			const ancestor = itemsById.get(ancestorId);
			if (ancestor && !included.has(ancestorId)) {
				included.set(ancestorId, { item: ancestor, isMatched: false });
			}
		}
	}

	for (const result of results) {
		included.set(result.item.id, {
			item: result.item,
			isMatched: true,
			breadcrumb: result.ancestorIds,
			reasons: result.reasons,
			score: result.score,
		});
	}

	const linkTargetParent = new Map<string, string>();
	for (const result of results) {
		for (const link of links) {
			if (link.fromId === result.item.workId || link.toId === result.item.workId) {
				const otherWorkId = link.fromId === result.item.workId ? link.toId : link.fromId;
				const otherItem = itemsByWorkId.get(otherWorkId);
				if (otherItem && !included.has(otherItem.id)) {
					included.set(otherItem.id, { item: otherItem, isMatched: false });
					linkTargetParent.set(otherItem.id, result.item.id);
				}
			}
		}
	}

	const nodeEntries = [...included.values()];

	const parentMap = new Map<string, string | null>();
	for (const entry of nodeEntries) {
		const linkParent = linkTargetParent.get(entry.item.id);
		if (linkParent) {
			parentMap.set(entry.item.id, linkParent);
		} else if (entry.item.parentId && included.has(entry.item.parentId)) {
			parentMap.set(entry.item.id, entry.item.parentId);
		} else {
			parentMap.set(entry.item.id, null);
		}
	}

	const depth = new Map<string, number>();
	const visiting = new Set<string>();
	function getDepth(id: string): number {
		if (depth.has(id)) return depth.get(id)!;
		if (visiting.has(id)) {
			depth.set(id, 0);
			return 0;
		}
		visiting.add(id);
		const p = parentMap.get(id);
		const d = p ? getDepth(p) + 1 : 0;
		visiting.delete(id);
		depth.set(id, d);
		return d;
	}
	for (const entry of nodeEntries) {
		getDepth(entry.item.id);
	}

	nodeEntries.sort((a, b) => {
		const d = (depth.get(a.item.id) ?? 0) - (depth.get(b.item.id) ?? 0);
		if (d !== 0) return d;
		return a.item.orderKey - b.item.orderKey;
	});

	const itemIdToIndex = new Map<string, number>();
	const nodes: TransientProjectionNode[] = nodeEntries.map((entry, index) => {
		itemIdToIndex.set(entry.item.id, index);
		return {
			workId: entry.item.workId,
			occurrenceId: entry.item.id,
			text: entry.item.text,
			sourceType,
			breadcrumb: entry.breadcrumb,
			reasons: entry.reasons,
			score: entry.score,
		};
	});

	for (let i = 0; i < nodes.length; i++) {
		const parentId = parentMap.get(nodeEntries[i].item.id);
		if (parentId) {
			const parentIndex = itemIdToIndex.get(parentId);
			if (parentIndex !== undefined) {
				nodes[i] = { ...nodes[i], parentNodeIndex: parentIndex };
			}
		}
	}

	return nodes;
}
