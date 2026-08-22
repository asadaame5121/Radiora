import type { OutlineItem, OutlineLink } from "../domain/models.ts";
import type { OutlineStorePort, RelationStorePort } from "../storage/graph_store.ts";

function workPairKey(workA: string, workB: string): string {
	return JSON.stringify(workA <= workB ? [workA, workB] : [workB, workA]);
}

type ImplicitRelationReadPort =
	& Pick<OutlineStorePort, "listItems">
	& Pick<RelationStorePort, "listLinks">;

/**
 * Merges outline parent-child relationships as implicit FROM semantic links
 * when no explicit relation exists between the two Works.
 *
 * 1. Record active explicit Work pairs with orientation-independent JSON key.
 * 2. Map items by ID for O(1) parent lookup.
 * 3. Add implicit FROM links from parent Work to child Work if no explicit link exists.
 * 4. Deduplicate multiple parent-child placements of the same Work pair (undirected).
 */
export function mergeImplicitFromLinks(
	items: readonly OutlineItem[],
	explicitLinks: readonly OutlineLink[],
): OutlineLink[] {
	const explicitWorkPairs = new Set<string>();
	for (const link of explicitLinks) {
		if (link.status === "retracted") continue;
		explicitWorkPairs.add(workPairKey(link.from.workId, link.to.workId));
	}

	const itemsById = new Map<string, OutlineItem>();
	for (const item of items) {
		itemsById.set(item.id, item);
	}

	const implicitLinks: OutlineLink[] = [];
	const generatedWorkPairs = new Set<string>();

	for (const item of items) {
		if (!item.parentId) continue;
		const parent = itemsById.get(item.parentId);
		if (!parent) continue;

		const parentWorkId = parent.workId;
		const childWorkId = item.workId;

		if (parentWorkId === childWorkId) continue;
		const pairKey = workPairKey(parentWorkId, childWorkId);
		if (explicitWorkPairs.has(pairKey)) continue;
		if (generatedWorkPairs.has(pairKey)) continue;
		generatedWorkPairs.add(pairKey);

		implicitLinks.push({
			id: `implicit:from:${JSON.stringify([parentWorkId, childWorkId])}`,
			fromId: parentWorkId,
			toId: childWorkId,
			from: { scope: "work", workId: parentWorkId },
			to: { scope: "work", workId: childWorkId },
			type: "FROM",
			status: "asserted",
			origin: "derived",
			createdAt: item.createdAt,
		});
	}

	return [...explicitLinks, ...implicitLinks];
}

/**
 * Convenience store reader that retrieves active links merged with implicit FROM relations.
 */
export async function fetchActiveMergedLinks(
	store: ImplicitRelationReadPort,
	items?: readonly OutlineItem[],
): Promise<OutlineLink[]> {
	const [links, currentItems] = await Promise.all([
		store.listLinks(),
		items ? Promise.resolve(items) : store.listItems(),
	]);
	return mergeImplicitFromLinks(currentItems, links).filter((link) => link.status !== "retracted");
}
