import type { TreeLayoutNode } from "./tree_layout.ts";

export interface TreeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface TreeViewport {
	width: number;
	height: number;
}

export interface TreeCameraTransform {
	k: number;
	x: number;
	y: number;
}

export interface TreeFitOptions {
	padding?: number;
	minZoom?: number;
	maxZoom?: number;
}

const DEFAULT_PADDING = 60;
const DEFAULT_MIN_ZOOM = .05;
const DEFAULT_MAX_ZOOM = 24;

export function fitTreeNodes(
	nodes: readonly TreeLayoutNode[],
	viewport: TreeViewport,
	options: TreeFitOptions = {},
): TreeCameraTransform {
	const bounds = treeNodeBounds(nodes);
	return bounds ? fitTreeBounds(bounds, viewport, options) : { k: 1, x: 0, y: 0 };
}

export function treeNodeBounds(nodes: readonly TreeLayoutNode[]): TreeBounds | null {
	if (nodes.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const node of nodes) {
		const bounds = node.aggregate && node.bounds ? node.bounds : {
			minX: node.worldX,
			minY: node.worldY,
			maxX: node.worldX,
			maxY: node.worldY,
		};
		minX = Math.min(minX, bounds.minX);
		minY = Math.min(minY, bounds.minY);
		maxX = Math.max(maxX, bounds.maxX);
		maxY = Math.max(maxY, bounds.maxY);
	}

	return { minX, minY, maxX, maxY };
}

export function fitTreeBounds(
	bounds: TreeBounds,
	viewport: TreeViewport,
	options: TreeFitOptions = {},
): TreeCameraTransform {
	const padding = options.padding ?? DEFAULT_PADDING;
	const minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
	const maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
	const spanX = Math.max(1, bounds.maxX - bounds.minX);
	const spanY = Math.max(1, bounds.maxY - bounds.minY);
	const availableWidth = Math.max(1, viewport.width - padding * 2);
	const availableHeight = Math.max(1, viewport.height - padding * 2);
	const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
	const k = Math.max(minZoom, Math.min(maxZoom, scale));
	const centerX = (bounds.minX + bounds.maxX) / 2;
	const centerY = (bounds.minY + bounds.maxY) / 2;

	return {
		k,
		x: viewport.width / 2 - centerX * k,
		y: viewport.height / 2 - centerY * k,
	};
}
