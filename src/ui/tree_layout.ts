import type {
	LinkType,
	OutlineItem,
	OutlineSnapshot,
	RelationTypeDefinition,
} from "../domain/models.ts";
import { calculateLineageProjection } from "./tree_lineage_projection.ts";
import { buildLaneOrder } from "./tree_lane_order.ts";
export { calculateLineageProjection, type LineageProjection } from "./tree_lineage_projection.ts";
export { buildLaneOrder } from "./tree_lane_order.ts";

import {
	aggregateScreenCells,
	lodForScreenCollisions,
	materializeEdges,
} from "./tree_spatial_aggregation.ts";
export { lodForScreenCollisions } from "./tree_spatial_aggregation.ts";

export type TreeLod = "detail" | "context" | "overview";
export type TreeLinkType = LinkType;
export type TreeProjection = "chronology" | "lineage";

/**
 * D3-independent 2D camera. World coordinates become screen coordinates via
 * `x * k + camera.x` and `y * k + camera.y`; zoom therefore stretches both axes
 * while node and label sizes stay constant on screen.
 */
export interface TreeCamera {
	k: number;
	x: number;
	y: number;
}

export const IDENTITY_CAMERA: TreeCamera = { k: 1, x: 0, y: 0 };

export interface TreeLayoutNode {
	id: string;
	item: OutlineItem;
	itemIds: string[];
	/** Screen-space position produced by the camera transform. */
	x: number;
	y: number;
	/** Layout-space position; the camera is applied afterwards. */
	worldX: number;
	worldY: number;
	lane: number;
	label: string;
	labelLines: string[];
	labelWidth: number;
	radius: number;
	count: number;
	aggregate: boolean;
	isKnot: boolean;
	isLineageKnot: boolean;
	/** World-space bounds of the constituent nodes; present on cluster nodes. */
	bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface TreeLayoutEdge {
	id: string;
	source: TreeLayoutNode;
	target: TreeLayoutNode;
	type: TreeLinkType;
	count: number;
}

export interface TreeLayout {
	lod: TreeLod;
	nodes: TreeLayoutNode[];
	edges: TreeLayoutEdge[];
	/** Total occupied height in world units. */
	contentHeight: number;
}

export interface TreeLayoutOptions {
	width: number;
	height: number;
	/** World-space X for a Chronology timestamp. */
	projectX: (timestamp: number) => number;
	projection?: TreeProjection;
	/** World-space X for a Lineage generation. */
	projectGeneration?: (generation: number) => number;
	/** Applied to the layout to produce screen coordinates; defaults to identity. */
	camera?: TreeCamera;
	relationTypeDefinitions?: readonly RelationTypeDefinition[];
}

export interface RawEdge {
	sourceId: string;
	targetId: string;
	type: TreeLinkType;
}

const NODE_GAP = 12;
const LANE_SPACING = 44;

export function calculateTreeLayout(
	snapshot: OutlineSnapshot,
	options: TreeLayoutOptions,
): TreeLayout {
	if (snapshot.items.length === 0) {
		return {
			lod: "detail",
			nodes: [],
			edges: [],
			contentHeight: options.height,
		};
	}

	const camera = options.camera ?? IDENTITY_CAMERA;
	const lineage = options.projection === "lineage"
		? calculateLineageProjection(snapshot, options.relationTypeDefinitions)
		: null;
	const projected = snapshot.items.map((item) => ({
		item,
		worldX: lineage
			? (options.projectGeneration ?? options.projectX)(
				lineage.knotWorkIds.has(item.workId)
					? lineage.knotGeneration ?? 0
					: lineage.generationByWorkId.get(item.workId) ?? 0,
			)
			: options.projectX(parseTimestamp(item.createdAt)),
	}));
	const laidOut = assignLanes(
		projected,
		snapshot,
		options.height,
		camera,
		lineage?.knotWorkIds,
	);
	const screenNodes = laidOut.nodes.map((node) => ({
		...node,
		x: node.worldX * camera.k + camera.x,
		y: node.worldY * camera.k + camera.y,
	}));
	const lod = lodForScreenCollisions(screenNodes);

	if (lod === "detail") {
		return {
			lod,
			nodes: screenNodes,
			edges: materializeEdges(
				rawEdges(snapshot),
				new Map(screenNodes.map((node) => [node.id, node])),
			),
			contentHeight: laidOut.contentHeight,
		};
	}

	return aggregateScreenCells(screenNodes, rawEdges(snapshot), lod, laidOut.contentHeight);
}

export function labelForItem(text: string): { label: string; lines: string[] } {
	const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "(空の項目)";
	const graphemes = splitGraphemes(firstLine);
	const clipped = graphemes.length > 32 ? [...graphemes.slice(0, 31), "…"] : graphemes;
	const lines = clipped.length > 16
		? [clipped.slice(0, 16).join(""), clipped.slice(16).join("")]
		: [clipped.join("")];
	return { label: clipped.join(""), lines };
}

export function buildDirectNeighborSet(snapshot: OutlineSnapshot, id: string): Set<string> {
	const result = new Set([id]);
	const selected = snapshot.items.find((item) => item.id === id);
	for (const item of snapshot.items) {
		if (item.id === id && item.parentId) result.add(item.parentId);
		if (item.parentId === id) result.add(item.id);
	}
	if (!selected) return result;
	const neighborWorkIds = new Set<string>();
	for (const link of snapshot.links) {
		if (link.fromId === selected.workId) neighborWorkIds.add(link.toId);
		if (link.toId === selected.workId) neighborWorkIds.add(link.fromId);
	}
	for (const item of snapshot.items) {
		if (neighborWorkIds.has(item.workId)) result.add(item.id);
	}
	return result;
}

function assignLanes(
	projected: Array<{ item: OutlineItem; worldX: number }>,
	snapshot: OutlineSnapshot,
	height: number,
	camera: TreeCamera,
	lineageKnotWorkIds: Set<string> = new Set(),
): { nodes: Array<Omit<TreeLayoutNode, "x" | "y">>; contentHeight: number } {
	const knotIds = new Set(snapshot.stashItemIds);
	const order = buildLaneOrder(snapshot);
	const sorted = [...projected].sort((a, b) =>
		a.worldX - b.worldX ||
		(order.get(a.item.id) ?? Number.MAX_SAFE_INTEGER) -
			(order.get(b.item.id) ?? Number.MAX_SAFE_INTEGER) ||
		a.item.orderKey - b.item.orderKey ||
		a.item.id.localeCompare(b.item.id)
	);
	const baseLaneCount = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
	const laneEnds: number[] = Array.from(
		{ length: baseLaneCount },
		() => Number.NEGATIVE_INFINITY,
	);
	const pending: Array<Omit<TreeLayoutNode, "x" | "y" | "worldY">> = [];
	// Nodes and labels retain their screen-pixel dimensions as the camera zooms,
	// so reserve their horizontal footprint in layout (world) coordinates.
	const screenToWorld = 1 / camera.k;

	for (const { item, worldX } of sorted) {
		const { label, lines } = labelForItem(item.text);
		const labelWidth = Math.min(
			180,
			Math.max(48, Math.max(...lines.map((line) => splitGraphemes(line).length)) * 13),
		);
		const radius = knotIds.has(item.id) ? 10 : 6;
		const intervalStart = worldX - (radius + 5) * screenToWorld;
		// Labels are rendered to the right of the node. Reserve their full
		// horizontal extent here, otherwise nearby Chronology nodes can share a
		// lane even though their text overlaps.
		const intervalEnd = worldX + (radius + 12 + labelWidth) * screenToWorld;
		let lane = -1;
		for (let candidate = 0; candidate < laneEnds.length; candidate++) {
			if (laneEnds[candidate] + NODE_GAP * screenToWorld <= intervalStart) {
				lane = candidate;
				break;
			}
		}
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(Number.NEGATIVE_INFINITY);
		}
		laneEnds[lane] = intervalEnd;
		pending.push({
			id: item.id,
			item,
			itemIds: [item.id],
			worldX,
			lane,
			label,
			labelLines: lines,
			labelWidth,
			radius,
			count: 1,
			aggregate: false,
			isKnot: knotIds.has(item.id) || lineageKnotWorkIds.has(item.workId),
			isLineageKnot: lineageKnotWorkIds.has(item.workId),
		});
	}

	const occupiedHeight = Math.max(0, laneEnds.length - 1) * LANE_SPACING;
	const top = Math.max(60, (height - occupiedHeight) / 2);
	const contentHeight = Math.max(height, top + occupiedHeight + 60);
	return {
		nodes: pending.map((node) => ({ ...node, worldY: top + node.lane * LANE_SPACING })),
		contentHeight,
	};
}

function rawEdges(snapshot: OutlineSnapshot): RawEdge[] {
	const occurrenceByWork = new Map<string, string>();
	// A semantic link belongs to Works, not to the outline placement hierarchy.
	// Pick one stable visible Occurrence for each Work so reordering or moving an
	// Occurrence cannot change the link projection.
	for (const item of [...snapshot.items].sort(compareProjectionOccurrence)) {
		if (!occurrenceByWork.has(item.workId)) occurrenceByWork.set(item.workId, item.id);
	}
	const result: RawEdge[] = [];
	for (const link of snapshot.links) {
		const storedFrom = occurrenceByWork.get(link.fromId);
		const storedTo = occurrenceByWork.get(link.toId);
		if (!storedFrom || !storedTo) continue;
		result.push(
			link.type === "FROM"
				? { sourceId: storedTo, targetId: storedFrom, type: link.type }
				: { sourceId: storedFrom, targetId: storedTo, type: link.type },
		);
	}
	return result;
}

function compareProjectionOccurrence(a: OutlineItem, b: OutlineItem): number {
	return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function parseTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function splitGraphemes(value: string): string[] {
	if (typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
		return [...segmenter.segment(value)].map((part) => part.segment);
	}
	return Array.from(value);
}
