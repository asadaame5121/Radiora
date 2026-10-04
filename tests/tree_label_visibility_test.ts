import { assertEquals } from "jsr:@std/assert@1";
import { visibleContextLabels } from "../src/ui/tree_label_visibility.ts";

const viewport = { width: 400, height: 200 };
function node(id: string, x: number, y: number) {
	return { id, itemIds: [id], x, y, radius: 6, labelWidth: 60, labelLines: [id] };
}

Deno.test("context labels prioritize emphasized labels when text rectangles overlap", () => {
	const nodes = [node("left", 40, 50), node("right", 40, 55)];
	assertEquals(visibleContextLabels(nodes, new Set(), viewport), new Set(["left"]));
	assertEquals(visibleContextLabels(nodes, new Set(["right"]), viewport), new Set(["right"]));
	assertEquals(nodes.map(({ id }) => id), ["left", "right"]);
});

Deno.test("context label hit tests reject nodes, viewport margins, and multi-line axis collisions", () => {
	const nodes = [node("label", 40, 50), node("obstacle", 80, 50)];
	assertEquals(visibleContextLabels(nodes, new Set(["label"]), viewport), new Set(["obstacle"]));
	assertEquals(visibleContextLabels([node("right-edge", 350, 50)], new Set(), viewport), new Set());
	assertEquals(
		visibleContextLabels(
			[{ ...node("axis", 40, 145), labelLines: ["one", "two"] }],
			new Set(),
			viewport,
		),
		new Set(),
	);
});
