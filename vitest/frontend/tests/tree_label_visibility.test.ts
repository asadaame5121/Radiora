import { expect, test } from "vitest";
import { visibleContextLabels } from "../../../src/ui/tree_label_visibility.ts";

const viewport = { width: 400, height: 200 };
function node(id: string, x: number, y: number) {
	return { id, itemIds: [id], x, y, radius: 6, labelWidth: 60, labelLines: [id] };
}

test("context labels prioritize emphasized labels when text rectangles overlap", () => {
	const nodes = [node("left", 40, 50), node("right", 40, 55)];
	expect(visibleContextLabels(nodes, new Set(), viewport)).toEqual(new Set(["left"]));
	expect(visibleContextLabels(nodes, new Set(["right"]), viewport)).toEqual(new Set(["right"]));
	expect(nodes.map(({ id }) => id)).toEqual(["left", "right"]);
});

test("context label hit tests reject nodes, viewport margins, and multi-line axis collisions", () => {
	const nodes = [node("label", 40, 50), node("obstacle", 80, 50)];
	expect(visibleContextLabels(nodes, new Set(["label"]), viewport)).toEqual(new Set(["obstacle"]));
	expect(visibleContextLabels([node("right-edge", 350, 50)], new Set(), viewport)).toEqual(
		new Set(),
	);
	expect(
		visibleContextLabels(
			[{ ...node("axis", 40, 145), labelLines: ["one", "two"] }],
			new Set(),
			viewport,
		),
	).toEqual(new Set());
});
