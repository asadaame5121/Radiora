// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import { calculateTreeLayout } from "./tree_layout.ts";

Deno.test("an overview cluster can be expanded into readable individual nodes", () => {
	const snapshot = outline(["one", "two", "three", "four"]);
	const options = {
		width: 100,
		height: 300,
		projectX: () => 50,
	};
	const overview = calculateTreeLayout(snapshot, options);
	const cluster = overview.nodes.find((node) => node.aggregate);
	assert(cluster, "the dense items should be summarized first");

	const expanded = calculateTreeLayout(snapshot, {
		...options,
		expandedOverviewItemIds: new Set(cluster.itemIds),
	});
	const visibleIds = expanded.nodes.map((node) => node.id);

	assertEquals(expanded.expandedClusterCount, cluster.count);
	assertEquals(visibleIds.filter((id) => cluster.itemIds.includes(id)).length, cluster.count);
	for (const id of cluster.itemIds) assert(expanded.expandedItemIds.has(id));
	const expandedMembers = expanded.nodes.filter((node) => cluster.itemIds.includes(node.id));
	assert(new Set(expandedMembers.map((node) => node.y)).size > 1);
});

function outline(ids: string[]): OutlineSnapshot {
	return {
		items: ids.map((id, orderKey): OutlineItem => ({
			id,
			workId: id,
			text: `${id} の内容`,
			parentId: null,
			orderKey,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: `${id}-branch` },
			createdAt: "2026-08-05T00:00:00.000Z",
			updatedAt: "2026-08-05T00:00:00.000Z",
		})),
		links: [],
		knots: [],
		stashItemIds: [],
	};
}
