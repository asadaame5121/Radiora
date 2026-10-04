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

interface RawEdge {
	sourceId: string;
	targetId: string;
	type: TreeLinkType;
}

const OVERVIEW_CELL_WIDTH = 48;
const OVERVIEW_CELL_HEIGHT = 36;
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

/**
 * Decides the LOD from screen-space collisions instead of a density proxy.
 * A 48x36px spatial hash finds nodes that can collide; their actual screen
 * distance determines the collision fraction used by the shared
 * Chronology/Lineage LOD scale.
 *
 * Cells are indexed relative to the bounding-box origin so a pure pan never
 * changes collision groups (only zoom does).
 */
export function lodForScreenCollisions(
	screenPositions: ReadonlyArray<{ x: number; y: number }>,
): TreeLod {
	if (screenPositions.length === 0) return "detail";
	const minX = Math.min(...screenPositions.map((position) => position.x));
	const minY = Math.min(...screenPositions.map((position) => position.y));
	const cells = new Map<string, Array<{ x: number; y: number }>>();
	for (const position of screenPositions) {
		const key = cellKey(position.x - minX, position.y - minY);
		const bucket = cells.get(key) ?? [];
		bucket.push(position);
		cells.set(key, bucket);
	}
	const colliding = new Set<{ x: number; y: number }>();
	for (const [key, bucket] of cells) {
		forEachNeighboringBucket(cells, key, (neighbor) => {
			for (const position of bucket) {
				for (const candidate of neighbor) {
					if (position === candidate || !positionsCollide(position, candidate)) continue;
					colliding.add(position);
					colliding.add(candidate);
				}
			}
		});
	}
	const fraction = colliding.size / screenPositions.length;
	if (fraction >= .5) return "overview";
	if (fraction > 0) return "context";
	return "detail";
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

function aggregateScreenCells(
	nodes: TreeLayoutNode[],
	edges: RawEdge[],
	lod: TreeLod,
	contentHeight: number,
): TreeLayout {
	const minX = Math.min(...nodes.map((node) => node.x));
	const minY = Math.min(...nodes.map((node) => node.y));
	const buckets = new Map<string, TreeLayoutNode[]>();
	for (const node of nodes) {
		const key = cellKey(node.x - minX, node.y - minY);
		const bucket = buckets.get(key) ?? [];
		bucket.push(node);
		buckets.set(key, bucket);
	}

	const collidingNodeIds = new Set<string>();
	const adjacentNodeIds = new Map<string, Set<string>>();
	for (const [key, bucket] of buckets) {
		forEachNeighboringBucket(buckets, key, (neighbor) => {
			for (const node of bucket) {
				for (const candidate of neighbor) {
					if (node === candidate || !positionsCollide(node, candidate)) continue;
					collidingNodeIds.add(node.id);
					collidingNodeIds.add(candidate.id);
					(adjacentNodeIds.get(node.id) ?? adjacentNodeIds.set(node.id, new Set()).get(node.id)!)
						.add(candidate.id);
					(adjacentNodeIds.get(candidate.id) ??
						adjacentNodeIds.set(candidate.id, new Set()).get(candidate.id)!).add(node.id);
				}
			}
		});
	}

	const components: TreeLayoutNode[][] = [];
	const visited = new Set<string>();
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	for (const id of [...collidingNodeIds].sort()) {
		if (visited.has(id)) continue;
		const component: TreeLayoutNode[] = [];
		const pending = [id];
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (visited.has(current)) continue;
			visited.add(current);
			component.push(nodeById.get(current)!);
			for (const neighbor of adjacentNodeIds.get(current) ?? []) {
				if (!visited.has(neighbor)) pending.push(neighbor);
			}
		}
		components.push(component);
	}
	components.push(...nodes.filter((node) => !collidingNodeIds.has(node.id)).map((node) => [node]));

	const aggregatedNodes: TreeLayoutNode[] = [];
	const nodeByItemId = new Map<string, TreeLayoutNode>();
	for (const bucket of components) {
		if (bucket.length === 1) {
			const single = bucket[0];
			aggregatedNodes.push(single);
			nodeByItemId.set(single.id, single);
			continue;
		}
		const members = [...bucket].sort((a, b) =>
			a.item.updatedAt.localeCompare(b.item.updatedAt) || a.id.localeCompare(b.id)
		);
		const itemIds = members.map((node) => node.id).sort();
		// The cluster id derives from sorted constituent item ids so panning or
		// input reordering can never change it.
		const cluster: TreeLayoutNode = {
			id: `cluster:${itemIds.join(":")}`,
			item: members[members.length - 1].item,
			itemIds,
			x: members.reduce((total, node) => total + node.x, 0) / members.length,
			y: members.reduce((total, node) => total + node.y, 0) / members.length,
			worldX: members.reduce((total, node) => total + node.worldX, 0) / members.length,
			worldY: members.reduce((total, node) => total + node.worldY, 0) / members.length,
			lane: Math.min(...members.map((node) => node.lane)),
			label: String(members.length),
			labelLines: [String(members.length)],
			labelWidth: 0,
			radius: Math.min(16, 8 + Math.log2(members.length) * 2),
			count: members.length,
			aggregate: true,
			isKnot: members.some((node) => node.isKnot),
			isLineageKnot: members.some((node) => node.isLineageKnot),
			bounds: {
				minX: Math.min(...members.map((node) => node.worldX)),
				minY: Math.min(...members.map((node) => node.worldY)),
				maxX: Math.max(...members.map((node) => node.worldX)),
				maxY: Math.max(...members.map((node) => node.worldY)),
			},
		};
		aggregatedNodes.push(cluster);
		for (const node of members) nodeByItemId.set(node.id, cluster);
	}

	aggregatedNodes.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
	return {
		lod,
		nodes: aggregatedNodes,
		edges: materializeEdges(edges, nodeByItemId),
		contentHeight,
	};
}

function cellKey(relativeX: number, relativeY: number): string {
	return `${Math.floor(relativeX / OVERVIEW_CELL_WIDTH)}:${
		Math.floor(relativeY / OVERVIEW_CELL_HEIGHT)
	}`;
}

function forEachNeighboringBucket<T>(
	buckets: ReadonlyMap<string, T[]>,
	key: string,
	callback: (bucket: T[]) => void,
): void {
	const [x, y] = key.split(":").map(Number);
	for (let offsetX = -1; offsetX <= 1; offsetX++) {
		for (let offsetY = -1; offsetY <= 1; offsetY++) {
			const bucket = buckets.get(`${x + offsetX}:${y + offsetY}`);
			if (bucket) callback(bucket);
		}
	}
}

function positionsCollide(
	left: { x: number; y: number },
	right: { x: number; y: number },
): boolean {
	return Math.abs(left.x - right.x) < OVERVIEW_CELL_WIDTH &&
		Math.abs(left.y - right.y) < OVERVIEW_CELL_HEIGHT;
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

function materializeEdges(
	edges: RawEdge[],
	nodeByItemId: Map<string, TreeLayoutNode>,
): TreeLayoutEdge[] {
	const grouped = new Map<string, TreeLayoutEdge>();
	for (const edge of edges) {
		const source = nodeByItemId.get(edge.sourceId);
		const target = nodeByItemId.get(edge.targetId);
		if (!source || !target || source.id === target.id) continue;
		const key = `${source.id}:${target.id}:${edge.type}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.count++;
		} else {
			grouped.set(key, {
				id: key,
				source,
				target,
				type: edge.type,
				count: 1,
			});
		}
	}
	return [...grouped.values()];
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
