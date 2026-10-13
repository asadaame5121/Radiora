import type {
	RawEdge,
	TreeLayout,
	TreeLayoutEdge,
	TreeLayoutNode,
	TreeLod,
} from "./tree_layout.ts";

const OVERVIEW_CELL_WIDTH = 48;
const OVERVIEW_CELL_HEIGHT = 36;
const MIN_COLLIDING_BUCKET_SIZE = 2;
const OVERVIEW_COLLISION_THRESHOLD = 0.5;
const MAX_CLUSTER_RADIUS = 16;
const BASE_CLUSTER_RADIUS = 8;
const CLUSTER_RADIUS_LOG_SCALE = 2;

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
	onCollisionCheck?: () => void,
): TreeLod {
	if (screenPositions.length === 0) return "detail";
	const buckets = buildSpatialBuckets(screenPositions);
	const bucketsByCell = new Map(
		buckets.map((bucket) => [cellKey(bucket.cellX, bucket.cellY), bucket]),
	);
	const colliding = new Set<{ x: number; y: number }>();
	for (const bucket of buckets) {
		if (bucket.values.length >= MIN_COLLIDING_BUCKET_SIZE) {
			for (const position of bucket.values) {
				onCollisionCheck?.();
				colliding.add(position);
			}
		}
	}
	forEachNeighborBucketPair(buckets, bucketsByCell, (left, right, offsetX, offsetY) => {
		const bridge = findCollisionBridge(left, right, offsetX, offsetY, onCollisionCheck);
		if (bridge) {
			colliding.add(bridge[0]);
			colliding.add(bridge[1]);
		}
	});
	const fraction = colliding.size / screenPositions.length;
	if (fraction >= OVERVIEW_COLLISION_THRESHOLD) return "overview";
	if (fraction > 0) return "context";
	return "detail";
}

interface CollisionGraph {
	collidingNodeIds: Set<string>;
	adjacentNodeIds: Map<string, Set<string>>;
}

function addCollisionEdge(graph: CollisionGraph, leftId: string, rightId: string): void {
	graph.collidingNodeIds.add(leftId);
	graph.collidingNodeIds.add(rightId);
	const left = graph.adjacentNodeIds.get(leftId) ?? new Set<string>();
	const right = graph.adjacentNodeIds.get(rightId) ?? new Set<string>();
	left.add(rightId);
	right.add(leftId);
	graph.adjacentNodeIds.set(leftId, left);
	graph.adjacentNodeIds.set(rightId, right);
}

function connectBucketCollisions(
	buckets: ReadonlyArray<SpatialBucket<TreeLayoutNode>>,
	graph: CollisionGraph,
	onCollisionCheck?: () => void,
): void {
	for (const bucket of buckets) {
		if (bucket.values.length < MIN_COLLIDING_BUCKET_SIZE) continue;
		const firstId = bucket.values[0].id;
		for (let i = 1; i < bucket.values.length; i++) {
			onCollisionCheck?.();
			addCollisionEdge(graph, firstId, bucket.values[i].id);
		}
	}
}

function connectNeighborCollisions(
	buckets: ReadonlyArray<SpatialBucket<TreeLayoutNode>>,
	bucketsByCell: ReadonlyMap<string, SpatialBucket<TreeLayoutNode>>,
	graph: CollisionGraph,
	onCollisionCheck?: () => void,
): void {
	forEachNeighborBucketPair(buckets, bucketsByCell, (left, right, offsetX, offsetY) => {
		const bridge = findCollisionBridge(left, right, offsetX, offsetY, onCollisionCheck);
		if (bridge) addCollisionEdge(graph, bridge[0].id, bridge[1].id);
	});
}

function buildCollisionGraph(
	nodes: TreeLayoutNode[],
	onCollisionCheck?: () => void,
): CollisionGraph {
	const buckets = buildSpatialBuckets(nodes);
	const bucketsByCell = new Map(
		buckets.map((bucket) => [cellKey(bucket.cellX, bucket.cellY), bucket]),
	);
	const graph: CollisionGraph = {
		collidingNodeIds: new Set(),
		adjacentNodeIds: new Map(),
	};
	connectBucketCollisions(buckets, graph, onCollisionCheck);
	connectNeighborCollisions(buckets, bucketsByCell, graph, onCollisionCheck);
	return graph;
}

function collisionComponent(
	startId: string,
	visited: Set<string>,
	nodeById: ReadonlyMap<string, TreeLayoutNode>,
	adjacentNodeIds: ReadonlyMap<string, Set<string>>,
): TreeLayoutNode[] {
	const component: TreeLayoutNode[] = [];
	const pending = [startId];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined || visited.has(current)) continue;
		visited.add(current);
		const node = nodeById.get(current);
		if (!node) throw new Error(`Missing spatial node ${current}`);
		component.push(node);
		for (const neighbor of adjacentNodeIds.get(current) ?? []) {
			if (!visited.has(neighbor)) pending.push(neighbor);
		}
	}
	return component;
}

function buildCollisionComponents(
	nodes: TreeLayoutNode[],
	graph: CollisionGraph,
): TreeLayoutNode[][] {
	const components: TreeLayoutNode[][] = [];
	const visited = new Set<string>();
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	for (const id of [...graph.collidingNodeIds].sort()) {
		if (!visited.has(id)) {
			components.push(collisionComponent(id, visited, nodeById, graph.adjacentNodeIds));
		}
	}
	for (const node of nodes) {
		if (!graph.collidingNodeIds.has(node.id)) components.push([node]);
	}
	return components;
}

interface ClusterStats {
	sumX: number;
	sumY: number;
	sumWorldX: number;
	sumWorldY: number;
	minLane: number;
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	hasKnot: boolean;
	hasLineageKnot: boolean;
}

function includeClusterMember(stats: ClusterStats, node: TreeLayoutNode): void {
	stats.sumX += node.x;
	stats.sumY += node.y;
	stats.sumWorldX += node.worldX;
	stats.sumWorldY += node.worldY;
	if (node.lane < stats.minLane) stats.minLane = node.lane;
	if (node.worldX < stats.minX) stats.minX = node.worldX;
	if (node.worldY < stats.minY) stats.minY = node.worldY;
	if (node.worldX > stats.maxX) stats.maxX = node.worldX;
	if (node.worldY > stats.maxY) stats.maxY = node.worldY;
	if (node.isKnot) stats.hasKnot = true;
	if (node.isLineageKnot) stats.hasLineageKnot = true;
}

function makeCluster(bucket: TreeLayoutNode[]): TreeLayoutNode {
	const members = [...bucket].sort((a, b) =>
		a.item.updatedAt.localeCompare(b.item.updatedAt) || a.id.localeCompare(b.id)
	);
	const itemIds = members.map((node) => node.id).sort();
	const stats: ClusterStats = {
		sumX: 0,
		sumY: 0,
		sumWorldX: 0,
		sumWorldY: 0,
		minLane: Number.POSITIVE_INFINITY,
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY,
		hasKnot: false,
		hasLineageKnot: false,
	};
	for (const member of members) includeClusterMember(stats, member);
	const count = members.length;
	return {
		id: `cluster:${itemIds.join(":")}`,
		item: members[count - 1].item,
		itemIds,
		x: stats.sumX / count,
		y: stats.sumY / count,
		worldX: stats.sumWorldX / count,
		worldY: stats.sumWorldY / count,
		lane: stats.minLane,
		label: String(count),
		labelLines: [String(count)],
		labelWidth: 0,
		radius: Math.min(
			MAX_CLUSTER_RADIUS,
			BASE_CLUSTER_RADIUS + Math.log2(count) * CLUSTER_RADIUS_LOG_SCALE,
		),
		count,
		aggregate: true,
		isKnot: stats.hasKnot,
		isLineageKnot: stats.hasLineageKnot,
		bounds: { minX: stats.minX, minY: stats.minY, maxX: stats.maxX, maxY: stats.maxY },
	};
}

function aggregateComponents(
	components: TreeLayoutNode[][],
): { nodes: TreeLayoutNode[]; nodeByItemId: Map<string, TreeLayoutNode> } {
	const aggregated: TreeLayoutNode[] = [];
	const nodeByItemId = new Map<string, TreeLayoutNode>();
	for (const component of components) {
		const cluster = component.length === 1 ? component[0] : makeCluster(component);
		aggregated.push(cluster);
		for (const member of component) nodeByItemId.set(member.id, cluster);
	}
	return { nodes: aggregated, nodeByItemId };
}

export function aggregateScreenCells(
	nodes: TreeLayoutNode[],
	edges: RawEdge[],
	lod: TreeLod,
	contentHeight: number,
	onCollisionCheck?: () => void,
): TreeLayout {
	const graph = buildCollisionGraph(nodes, onCollisionCheck);
	const components = buildCollisionComponents(nodes, graph);
	const aggregate = aggregateComponents(components);
	aggregate.nodes.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
	return {
		lod,
		nodes: aggregate.nodes,
		edges: materializeEdges(edges, aggregate.nodeByItemId),
		contentHeight,
	};
}

export function materializeEdges(
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

interface SpatialPoint {
	readonly x: number;
	readonly y: number;
}

interface SpatialBucket<T extends SpatialPoint> {
	readonly cellX: number;
	readonly cellY: number;
	readonly values: T[];
	minY: T;
	maxY: T;
}

function spatialOrigin<T extends SpatialPoint>(
	points: ReadonlyArray<T>,
): { minX: number; minY: number } {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const point of points) {
		if (point.x < minX) minX = point.x;
		if (point.y < minY) minY = point.y;
	}
	return { minX, minY };
}

function addPointToBucket<T extends SpatialPoint>(
	byCell: Map<string, SpatialBucket<T>>,
	point: T,
	minX: number,
	minY: number,
): void {
	const cellX = Math.floor((point.x - minX) / OVERVIEW_CELL_WIDTH);
	const cellY = Math.floor((point.y - minY) / OVERVIEW_CELL_HEIGHT);
	const key = cellKey(cellX, cellY);
	const bucket = byCell.get(key);
	if (!bucket) {
		byCell.set(key, { cellX, cellY, values: [point], minY: point, maxY: point });
		return;
	}
	bucket.values.push(point);
	if (point.y < bucket.minY.y) bucket.minY = point;
	if (point.y > bucket.maxY.y) bucket.maxY = point;
}

function buildSpatialBuckets<T extends SpatialPoint>(points: ReadonlyArray<T>): SpatialBucket<T>[] {
	if (points.length === 0) return [];
	const { minX, minY } = spatialOrigin(points);
	const byCell = new Map<string, SpatialBucket<T>>();
	for (const point of points) addPointToBucket(byCell, point, minX, minY);
	const buckets = [...byCell.values()];
	for (const bucket of buckets) bucket.values.sort((a, b) => b.x - a.x);
	return buckets.sort((a, b) => b.cellX - a.cellX || a.cellY - b.cellY);
}

function forEachNeighborBucketPair<T extends SpatialPoint>(
	buckets: ReadonlyArray<SpatialBucket<T>>,
	bucketsByCell: ReadonlyMap<string, SpatialBucket<T>>,
	callback: (
		left: SpatialBucket<T>,
		right: SpatialBucket<T>,
		offsetX: number,
		offsetY: number,
	) => void,
): void {
	for (const bucket of buckets) {
		for (const [offsetX, offsetY] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
			const neighbor = bucketsByCell.get(cellKey(bucket.cellX + offsetX, bucket.cellY + offsetY));
			if (neighbor) callback(bucket, neighbor, offsetX, offsetY);
		}
	}
}

function findDiagonalCollisionBridge<T extends SpatialPoint>(
	left: SpatialBucket<T>,
	right: SpatialBucket<T>,
	offsetY: number,
	onCollisionCheck?: () => void,
): [T, T] | null {
	let leftIndex = 0;
	let extreme: T | null = null;
	for (const rightNode of right.values) {
		onCollisionCheck?.();
		while (
			leftIndex < left.values.length &&
			rightNode.x - left.values[leftIndex].x < OVERVIEW_CELL_WIDTH
		) {
			onCollisionCheck?.();
			const candidate = left.values[leftIndex++];
			if (!extreme || (offsetY > 0 ? candidate.y > extreme.y : candidate.y < extreme.y)) {
				extreme = candidate;
			}
		}
		if (extreme && positionsCollideCounted(extreme, rightNode, onCollisionCheck)) {
			return [extreme, rightNode];
		}
	}
	return null;
}

function findCollisionBridge<T extends SpatialPoint>(
	left: SpatialBucket<T>,
	right: SpatialBucket<T>,
	offsetX: number,
	offsetY: number,
	onCollisionCheck?: () => void,
): [T, T] | null {
	if (offsetX === 1 && offsetY === 0) {
		const leftNode = left.values[0];
		const rightNode = right.values[right.values.length - 1];
		return positionsCollideCounted(leftNode, rightNode, onCollisionCheck)
			? [leftNode, rightNode]
			: null;
	}
	if (offsetX === 0) {
		return positionsCollideCounted(left.maxY, right.minY, onCollisionCheck)
			? [left.maxY, right.minY]
			: null;
	}
	return findDiagonalCollisionBridge(left, right, offsetY, onCollisionCheck);
}

function cellKey(cellX: number, cellY: number): string {
	return `${cellX}:${cellY}`;
}

function positionsCollideCounted(
	left: SpatialPoint,
	right: SpatialPoint,
	onCollisionCheck?: () => void,
): boolean {
	onCollisionCheck?.();
	return positionsCollide(left, right);
}

function positionsCollide(left: SpatialPoint, right: SpatialPoint): boolean {
	return Math.abs(left.x - right.x) < OVERVIEW_CELL_WIDTH &&
		Math.abs(left.y - right.y) < OVERVIEW_CELL_HEIGHT;
}
