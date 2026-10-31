import { expect, test } from "vitest";
import { fitTreeBounds, fitTreeNodes, treeNodeBounds } from "../../../../src/ui/tree_camera.ts";
import type { TreeLayoutNode } from "../../../../src/ui/tree_layout.ts";

test("fitTreeBounds centers world bounds inside the padded viewport", () => {
	expect(
		fitTreeBounds({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 400, height: 300 }),
	).toEqual({ k: 1.4, x: 60, y: 80 });
});

test("fitTreeBounds clamps extreme zoom levels", () => {
	expect(
		fitTreeBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { width: 1_000, height: 1_000 }).k,
	).toEqual(24);
	expect(
		fitTreeBounds({ minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, { width: 100, height: 100 })
			.k,
	).toEqual(0.05);
});

test("treeNodeBounds uses aggregate world bounds and regular node world coordinates", () => {
	const aggregateNode = {
		aggregate: true,
		bounds: { minX: -10, minY: -20, maxX: 30, maxY: 40 },
		worldX: 5,
		worldY: 5,
	} as TreeLayoutNode;
	expect(treeNodeBounds([aggregateNode])).toEqual(aggregateNode.bounds);

	const regularNode = {
		worldX: 50,
		worldY: 80,
	} as TreeLayoutNode;
	expect(treeNodeBounds([regularNode])).toEqual({
		minX: 50,
		minY: 80,
		maxX: 50,
		maxY: 80,
	});

	expect(treeNodeBounds([])).toEqual(null);
});

test("fitTreeNodes fits nodes within viewport or falls back to identity", () => {
	const viewport = { width: 400, height: 300 };
	expect(fitTreeNodes([], viewport)).toEqual({ k: 1, x: 0, y: 0 });

	const node = {
		aggregate: true,
		bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
		worldX: 0,
		worldY: 0,
	} as TreeLayoutNode;
	expect(fitTreeNodes([node], viewport)).toEqual({ k: 1.4, x: 60, y: 80 });
});
