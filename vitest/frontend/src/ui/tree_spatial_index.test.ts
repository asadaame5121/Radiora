import { expect, test } from "vitest";
import {
	buildTreeSpatialIndex,
	nodesNearRectangle,
	screenRectanglesOverlap,
} from "../../../../src/ui/tree_spatial_index.ts";

test("tree spatial index returns nodes across cell boundaries", () => {
	const nodes = [
		{ id: "left", x: 95, y: 95 },
		{ id: "right", x: 96, y: 96 },
		{ id: "far", x: 400, y: 400 },
	];
	const index = buildTreeSpatialIndex(nodes);
	expect(
		nodesNearRectangle(index, { x1: 90, y1: 90, x2: 100, y2: 100 }).map((node) => node.id),
	).toEqual(["left", "right"]);
});

test("screen rectangle overlap excludes touching edges", () => {
	expect(
		screenRectanglesOverlap({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 10, y1: 0, x2: 20, y2: 10 }),
	).toEqual(false);
	expect(
		screenRectanglesOverlap({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 9, y1: 9, x2: 20, y2: 20 }),
	).toEqual(true);
});
