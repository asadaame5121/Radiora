import { assert, assertEquals, assertLess } from "jsr:@std/assert@1";
import { buildSparseOutline } from "../src/services/sparse_outline.ts";
import {
	createHighDensityGraphFixture,
	HIGH_DENSITY_LINK_COUNT,
	HIGH_DENSITY_WORK_COUNT,
} from "./support/high_density_graph_fixture.ts";

Deno.test("sparse outline preserves dense search context within its performance budget", async () => {
	const { items, links, projectionResults: results } = await createHighDensityGraphFixture();
	assertEquals(items.length, HIGH_DENSITY_WORK_COUNT);
	assertEquals(links.length, HIGH_DENSITY_LINK_COUNT);

	const itemsBefore = structuredClone(items);
	const linksBefore = structuredClone(links);
	const resultsBefore = structuredClone(results);
	const started = performance.now();
	const nodes = buildSparseOutline(results, items, links);
	const elapsedMs = performance.now() - started;

	assertLess(elapsedMs, 2_500, `Sparse Outline took ${elapsedMs.toFixed(1)}ms`);
	assertEquals(items, itemsBefore);
	assertEquals(links, linksBefore);
	assertEquals(results, resultsBefore);

	const nodeByOccurrenceId = new Map(
		nodes.map((node, index) => [node.occurrenceId, { node, index }]),
	);
	for (const result of results) {
		const found = nodeByOccurrenceId.get(result.item.id);
		assert(found, `missing matched occurrence ${result.item.id}`);
		assertEquals(found.node.workId, result.item.workId);
		assertEquals(found.node.occurrenceId, result.item.id);
		assertEquals(found.node.score, result.score);
		assertEquals(found.node.reasons, result.reasons);
		assertEquals(found.node.breadcrumb, result.ancestorIds);

		const [rootId, groupId] = result.ancestorIds;
		const root = nodeByOccurrenceId.get(rootId);
		const group = nodeByOccurrenceId.get(groupId);
		assert(root, `missing root ancestor ${rootId}`);
		assert(group, `missing group ancestor ${groupId}`);
		assertEquals(group.node.parentNodeIndex, root.index);
		assertEquals(found.node.parentNodeIndex, group.index);

		const directTargetId = result.item.id.replace("match-", "direct-");
		const directTarget = nodeByOccurrenceId.get(directTargetId);
		assert(directTarget, `missing direct link target ${directTargetId}`);
		assertEquals(directTarget.node.parentNodeIndex, found.index);
		assertEquals(directTarget.node.reasons, undefined);
		assertEquals(directTarget.node.score, undefined);
	}

	for (const root of items.filter((item) => item.id.startsWith("root-"))) {
		assertEquals(nodes.filter((node) => node.occurrenceId === root.id).length, 1);
	}
	for (const group of items.filter((item) => item.id.startsWith("group-"))) {
		assertEquals(nodes.filter((node) => node.occurrenceId === group.id).length, 1);
	}
});
