// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import {
	buildTreeSpatialIndex,
	nodesNearRectangle,
	screenRectanglesOverlap,
} from "./tree_spatial_index.ts";

Deno.test("tree spatial index returns nodes across cell boundaries", () => {
	const nodes = [
		{ id: "left", x: 95, y: 95 },
		{ id: "right", x: 96, y: 96 },
		{ id: "far", x: 400, y: 400 },
	];
	const index = buildTreeSpatialIndex(nodes);
	assertEquals(
		nodesNearRectangle(index, { x1: 90, y1: 90, x2: 100, y2: 100 }).map((node) => node.id),
		["left", "right"],
	);
});

Deno.test("screen rectangle overlap excludes touching edges", () => {
	assertEquals(
		screenRectanglesOverlap(
			{ x1: 0, y1: 0, x2: 10, y2: 10 },
			{ x1: 10, y1: 0, x2: 20, y2: 10 },
		),
		false,
	);
	assertEquals(
		screenRectanglesOverlap(
			{ x1: 0, y1: 0, x2: 10, y2: 10 },
			{ x1: 9, y1: 9, x2: 20, y2: 20 },
		),
		true,
	);
});
