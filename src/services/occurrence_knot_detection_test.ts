// biome-ignore-all lint/style/noMagicNumbers: Three hops per node is the explicit linear-work bound.
import { assertEquals } from "jsr:@std/assert@1";
import type { OutlineItem } from "../domain/models.ts";
import { markRecursivePlacements } from "./occurrence_knot_detection.ts";
import { computeShapeLayout } from "../../scripts/performance_fixture/acceptance_shapes.ts";

/**
 * Legacy reference oracle implementation from PR #334 (walks parent chain for every unvisited node).
 * Kept exclusively in test for behavioral parity verification.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keep the parity oracle independent from the refactored traversal.
function legacyMarkRecursivePlacementsOracle(items: OutlineItem[]): OutlineItem[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const children = new Map<string | null, OutlineItem[]>();
	const recursiveItemIds = new Set<string>();

	for (const item of items) {
		const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parent) ?? [];
		bucket.push(item);
		children.set(parent, bucket);
	}

	const visited = new Set<string>();
	const workCounts = new Map<string, number>();

	const roots = children.get(null) ?? [];
	type Frame = { item: OutlineItem; entered: boolean };
	const stack: Frame[] = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({ item: roots[i], entered: false });
	}

	while (stack.length > 0) {
		const frame = stack.pop();
		if (!frame) continue;
		if (frame.entered) {
			const currentCount = workCounts.get(frame.item.workId) ?? 1;
			if (currentCount <= 1) {
				workCounts.delete(frame.item.workId);
			} else {
				workCounts.set(frame.item.workId, currentCount - 1);
			}
			continue;
		}

		if (visited.has(frame.item.id)) continue;
		visited.add(frame.item.id);

		if ((workCounts.get(frame.item.workId) ?? 0) > 0) {
			recursiveItemIds.add(frame.item.id);
		}

		workCounts.set(frame.item.workId, (workCounts.get(frame.item.workId) ?? 0) + 1);
		stack.push({ item: frame.item, entered: true });

		const itemChildren = children.get(frame.item.id) ?? [];
		for (let i = itemChildren.length - 1; i >= 0; i--) {
			if (!visited.has(itemChildren[i].id)) {
				stack.push({ item: itemChildren[i], entered: false });
			}
		}
	}

	if (visited.size < items.length) {
		for (const item of items) {
			if (!visited.has(item.id)) {
				const pathVisited = new Set<string>();
				let parentId = item.parentId;
				while (parentId) {
					if (pathVisited.has(parentId)) break;
					pathVisited.add(parentId);
					const parent = byId.get(parentId);
					if (!parent) break;
					if (parent.workId === item.workId) {
						recursiveItemIds.add(item.id);
						break;
					}
					parentId = parent.parentId;
				}
				visited.add(item.id);
			}
		}
	}

	if (recursiveItemIds.size === 0) return items;
	return items.map((item) =>
		recursiveItemIds.has(item.id) ? { ...item, referenceStub: true } : item
	);
}

function makeTestItem(id: string, workId: string, parentId: string | null): OutlineItem {
	return {
		id,
		workId,
		text: `Topic ${id}`,
		parentId,
		orderKey: 1024,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${workId}` },
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		referenceStub: false,
	};
}

Deno.test("markRecursivePlacements matches legacy oracle across small cycle and tree topologies", () => {
	const testCases: Array<{ name: string; items: OutlineItem[] }> = [
		{
			name: "normal tree without cycles",
			items: [
				makeTestItem("root", "w0", null),
				makeTestItem("child1", "w1", "root"),
				makeTestItem("child2", "w2", "child1"),
			],
		},
		{
			name: "normal tree with duplicate work on path",
			items: [
				makeTestItem("root", "w0", null),
				makeTestItem("child1", "w1", "root"),
				makeTestItem("child2", "w0", "child1"),
			],
		},
		{
			name: "self-cycle (A -> A)",
			items: [
				makeTestItem("c0", "w0", "c0"),
			],
		},
		{
			name: "cycle of 3 with all distinct works (A -> B -> C -> A)",
			items: [
				makeTestItem("c0", "w0", "c2"),
				makeTestItem("c1", "w1", "c0"),
				makeTestItem("c2", "w2", "c1"),
			],
		},
		{
			name: "cycle of 3 with duplicate work in cycle",
			items: [
				makeTestItem("c0", "w0", "c2"),
				makeTestItem("c1", "w1", "c0"),
				makeTestItem("c2", "w0", "c1"),
			],
		},
		{
			name: "cycle with attached branch of same work",
			items: [
				makeTestItem("c0", "w0", "c1"),
				makeTestItem("c1", "w1", "c0"),
				makeTestItem("b0", "w0", "c1"), // branch child of c1, has same work as c0
			],
		},
		{
			name: "cycle with attached branch of different work",
			items: [
				makeTestItem("c0", "w0", "c1"),
				makeTestItem("c1", "w1", "c0"),
				makeTestItem("b0", "w2", "c1"), // branch child of c1, distinct work
				makeTestItem("b1", "w3", "b0"),
			],
		},
		{
			name: "cycle with branch that duplicates a branch ancestor work",
			items: [
				makeTestItem("c0", "w0", "c1"),
				makeTestItem("c1", "w1", "c0"),
				makeTestItem("b0", "w2", "c1"),
				makeTestItem("b1", "w3", "b0"),
				makeTestItem("b2", "w2", "b1"), // duplicate w2 from b0
			],
		},
		{
			name: "orphan items with missing or invalid parent",
			items: [
				makeTestItem("o1", "w1", "missing-parent-1"),
				makeTestItem("o2", "w2", "missing-parent-2"),
				makeTestItem("o3", "w1", "o1"),
			],
		},
	];

	for (const { name, items } of testCases) {
		const expected = legacyMarkRecursivePlacementsOracle(items);
		const actual = markRecursivePlacements(items);
		assertEquals(actual, expected, `Topology '${name}' failed to match oracle`);
	}
});

Deno.test("markRecursivePlacements scales linearly on 10,000-node cycle without quadratic traversal", () => {
	const n = 10_000;
	const layout = computeShapeLayout(n, "deep-cycle");
	const items: OutlineItem[] = Array.from({ length: n }, (_, i) => {
		const parentIndex = layout.parentIndices[i];
		const parentId = parentIndex === null ? null : `item-${parentIndex}`;
		return makeTestItem(`item-${i}`, `work-${i}`, parentId);
	});

	let hopCount = 0;
	const result = markRecursivePlacements(items, {
		onHop: () => {
			hopCount++;
		},
	});

	assertEquals(result.length, n);
	// All nodes in cycle should be marked as recursive stub
	for (const item of result) {
		assertEquals(item.referenceStub, true);
	}

	// In quadratic parent walk: 10,000 * 9,999 / 2 ≈ 50,000,000 hops
	// In linear shared exploration: hops should be <= 3 * n = 30,000
	assertEquals(hopCount <= 3 * n, true, `Hop count ${hopCount} exceeded linear bound 3*N`);
});
