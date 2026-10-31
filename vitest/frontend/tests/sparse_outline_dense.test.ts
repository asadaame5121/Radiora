import { expect, test } from "vitest";
import { buildSparseOutline } from "../../../src/services/sparse_outline.ts";
import {
	createHighDensityGraphFixture,
	HIGH_DENSITY_LINK_COUNT,
	HIGH_DENSITY_WORK_COUNT,
} from "../../../tests/support/high_density_graph_fixture.ts";

test("sparse outline preserves dense search context within its performance budget", async () => {
	const { items, links, projectionResults: results } = await createHighDensityGraphFixture();
	expect(items.length).toEqual(HIGH_DENSITY_WORK_COUNT);
	expect(links.length).toEqual(HIGH_DENSITY_LINK_COUNT);

	const itemsBefore = structuredClone(items);
	const linksBefore = structuredClone(links);
	const resultsBefore = structuredClone(results);
	const started = performance.now();
	const nodes = buildSparseOutline(results, items, links);
	const elapsedMs = performance.now() - started;

	expect(elapsedMs, `Sparse Outline took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(2_500);
	expect(items).toEqual(itemsBefore);
	expect(links).toEqual(linksBefore);
	expect(results).toEqual(resultsBefore);

	const nodeByOccurrenceId = new Map(
		nodes.map((node, index) => [node.occurrenceId, { node, index }]),
	);
	for (const result of results) {
		const found = nodeByOccurrenceId.get(result.item.id);
		if (!found) throw new Error(`missing matched occurrence ${result.item.id}`);
		expect(found.node.workId).toEqual(result.item.workId);
		expect(found.node.occurrenceId).toEqual(result.item.id);
		expect(found.node.score).toEqual(result.score);
		expect(found.node.reasons).toEqual(result.reasons);
		expect(found.node.breadcrumb).toEqual(result.ancestorIds);

		const [rootId, groupId] = result.ancestorIds;
		const root = nodeByOccurrenceId.get(rootId);
		const group = nodeByOccurrenceId.get(groupId);
		if (!root) throw new Error(`missing root ancestor ${rootId}`);
		if (!group) throw new Error(`missing group ancestor ${groupId}`);
		expect(group.node.parentNodeIndex).toEqual(root.index);
		expect(found.node.parentNodeIndex).toEqual(group.index);

		const directTargetId = result.item.id.replace("match-", "direct-");
		const directTarget = nodeByOccurrenceId.get(directTargetId);
		if (!directTarget) throw new Error(`missing direct link target ${directTargetId}`);
		expect(directTarget.node.parentNodeIndex).toEqual(found.index);
		expect(directTarget.node.reasons).toEqual(undefined);
		expect(directTarget.node.score).toEqual(undefined);
	}

	for (const root of items.filter((item) => item.id.startsWith("root-"))) {
		expect(nodes.filter((node) => node.occurrenceId === root.id).length).toEqual(1);
	}
	for (const group of items.filter((item) => item.id.startsWith("group-"))) {
		expect(nodes.filter((node) => node.occurrenceId === group.id).length).toEqual(1);
	}
});
