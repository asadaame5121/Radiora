import type {
	TreeCamera,
	TreeLayout,
	TreeLayoutEdge,
	TreeLayoutNode,
	TreeWorldLayout,
} from "./tree_layout.ts";
import {
	aggregateScreenCells,
	lodForScreenCollisions,
	materializeEdges,
} from "./tree_spatial_aggregation.ts";

/**
 * Camera-independent part of the screen layout: LOD, clusters and edges for one
 * zoom. Node `x`/`y` are `world * zoom` without translation, because the
 * collision grid is anchored to the bounding box and a pure pan never changes it.
 */
export interface TreeZoomLayout extends TreeLayout {
	zoom: number;
}

/** Zoom levels per doubling at which the view recomputes lanes and clusters. */
const ZOOM_STEPS_PER_DOUBLING = 4;
// log2 of an exact step (e.g. 2 ** 0.25) can land just below the integer.
const ZOOM_STEP_EPSILON = 1e-9;

/**
 * Rounds a zoom down to its step. Lanes and clusters computed at a lower zoom
 * reserve at least the screen spacing they need at the actual zoom, so a
 * gesture only recomputes layout when it crosses a step.
 */
export function quantizeTreeZoom(zoom: number): number {
	const step =
		Math.floor(Math.log2(zoom) * ZOOM_STEPS_PER_DOUBLING + ZOOM_STEP_EPSILON) /
		ZOOM_STEPS_PER_DOUBLING;
	return 2 ** step;
}

export function aggregateTreeAtZoom(worldLayout: TreeWorldLayout, zoom: number): TreeZoomLayout {
	const scaledNodes: TreeLayoutNode[] = worldLayout.nodes.map((node) => ({
		...node,
		x: node.worldX * zoom,
		y: node.worldY * zoom,
	}));
	const lod = lodForScreenCollisions(scaledNodes);
	if (lod === "detail") {
		return {
			zoom,
			lod,
			nodes: scaledNodes,
			edges: materializeEdges(
				worldLayout.rawEdges,
				new Map(scaledNodes.map((node) => [node.id, node])),
			),
			contentHeight: worldLayout.contentHeight,
		};
	}
	return {
		zoom,
		...aggregateScreenCells(scaledNodes, worldLayout.rawEdges, lod, worldLayout.contentHeight),
	};
}

/** O(nodes + edges): places an aggregated layout under the current camera. */
export function projectTreeLayout(zoomLayout: TreeZoomLayout, camera: TreeCamera): TreeLayout {
	const nodeById = new Map<string, TreeLayoutNode>();
	const nodes = zoomLayout.nodes.map((node) => {
		const projected = {
			...node,
			x: node.worldX * camera.k + camera.x,
			y: node.worldY * camera.k + camera.y,
		};
		nodeById.set(node.id, projected);
		return projected;
	});
	const edges = zoomLayout.edges.map(
		(edge): TreeLayoutEdge => ({
			...edge,
			source: nodeById.get(edge.source.id) ?? edge.source,
			target: nodeById.get(edge.target.id) ?? edge.target,
		}),
	);
	return { lod: zoomLayout.lod, nodes, edges, contentHeight: zoomLayout.contentHeight };
}
