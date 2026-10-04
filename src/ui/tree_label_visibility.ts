import type { TreeLayoutNode } from "./tree_layout.ts";
import {
	buildTreeSpatialIndex,
	nodesNearRectangle,
	type ScreenRectangle,
	screenRectanglesOverlap,
} from "./tree_spatial_index.ts";
import type { TreeViewport } from "./tree_camera.ts";

type LabelNode = Pick<
	TreeLayoutNode,
	"id" | "itemIds" | "x" | "y" | "radius" | "labelWidth" | "labelLines"
>;
const LABEL_GAP = 8;
const LABEL_OFFSET = 12;
const LABEL_HALF_HEIGHT = 10;
const LABEL_LINE_HEIGHT = 14;
const NODE_PADDING = 6;
const VIEW_MARGIN = 4;
const RIGHT_MARGIN = 8;
const AXIS_HEIGHT = 44;

/** Screen-space hit tests; emphasized labels win, then left-to-right order. */
export function visibleContextLabels(
	nodes: readonly LabelNode[],
	highlightedIds: ReadonlySet<string>,
	viewport: TreeViewport,
): Set<string> {
	const visible = new Set<string>();
	const accepted: ScreenRectangle[] = [];
	const grid = buildTreeSpatialIndex(nodes);
	const emphasized = (node: LabelNode) => node.itemIds.some((id) => highlightedIds.has(id)) ? 0 : 1;
	const candidates = [...nodes].sort((a, b) => emphasized(a) - emphasized(b) || a.x - b.x);
	for (const node of candidates) {
		const rectangle = labelRectangle(node);
		if (!insideViewport(rectangle, viewport)) continue;
		const hitsNode = nodesNearRectangle(grid, rectangle).some((other) =>
			other.id !== node.id && screenRectanglesOverlap(rectangle, nodeRectangle(other))
		);
		if (hitsNode || accepted.some((other) => screenRectanglesOverlap(rectangle, other))) continue;
		visible.add(node.id);
		accepted.push(rectangle);
	}
	return visible;
}

function labelRectangle(node: LabelNode): ScreenRectangle {
	return {
		x1: node.x + node.radius + LABEL_GAP,
		x2: node.x + node.radius + LABEL_OFFSET + node.labelWidth,
		y1: node.y - LABEL_HALF_HEIGHT,
		y2: node.y + LABEL_HALF_HEIGHT + Math.max(0, node.labelLines.length - 1) * LABEL_LINE_HEIGHT,
	};
}

function nodeRectangle(node: LabelNode): ScreenRectangle {
	const padding = node.radius + NODE_PADDING;
	return { x1: node.x - padding, x2: node.x + padding, y1: node.y - padding, y2: node.y + padding };
}

function insideViewport(rect: ScreenRectangle, { width, height }: TreeViewport): boolean {
	return rect.x1 >= VIEW_MARGIN && rect.x2 <= width - RIGHT_MARGIN &&
		rect.y1 >= VIEW_MARGIN && rect.y2 <= height - AXIS_HEIGHT;
}
