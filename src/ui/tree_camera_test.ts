// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { fitTreeBounds, fitTreeNodes, treeNodeBounds } from "./tree_camera.ts";
import type { TreeLayoutNode } from "./tree_layout.ts";

Deno.test("fitTreeBounds centers world bounds inside the padded viewport", () => {
	assertEquals(
		fitTreeBounds(
			{ minX: 0, minY: 0, maxX: 200, maxY: 100 },
			{ width: 400, height: 300 },
		),
		{ k: 1.4, x: 60, y: 80 },
	);
});

Deno.test("fitTreeBounds clamps extreme zoom levels", () => {
	assertEquals(
		fitTreeBounds(
			{ minX: 0, minY: 0, maxX: 1, maxY: 1 },
			{ width: 1_000, height: 1_000 },
		).k,
		24,
	);
	assertEquals(
		fitTreeBounds(
			{ minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 },
			{ width: 100, height: 100 },
		).k,
		.05,
	);
});

Deno.test("treeNodeBounds uses aggregate world bounds and regular node world coordinates", () => {
	const aggregateNode = {
		aggregate: true,
		bounds: { minX: -10, minY: -20, maxX: 30, maxY: 40 },
		worldX: 5,
		worldY: 5,
	} as TreeLayoutNode;
	assertEquals(treeNodeBounds([aggregateNode]), aggregateNode.bounds);

	const regularNode = {
		worldX: 50,
		worldY: 80,
	} as TreeLayoutNode;
	assertEquals(treeNodeBounds([regularNode]), {
		minX: 50,
		minY: 80,
		maxX: 50,
		maxY: 80,
	});

	assertEquals(treeNodeBounds([]), null);
});

Deno.test("fitTreeNodes fits nodes within viewport or falls back to identity", () => {
	const viewport = { width: 400, height: 300 };
	assertEquals(fitTreeNodes([], viewport), { k: 1, x: 0, y: 0 });

	const node = {
		aggregate: true,
		bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
		worldX: 0,
		worldY: 0,
	} as TreeLayoutNode;
	assertEquals(fitTreeNodes([node], viewport), { k: 1.4, x: 60, y: 80 });
});
