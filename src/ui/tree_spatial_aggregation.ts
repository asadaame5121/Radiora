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
): TreeLod {
	if (screenPositions.length === 0) return "detail";
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const position of screenPositions) {
		if (position.x < minX) minX = position.x;
		if (position.y < minY) minY = position.y;
	}
	const cells = new Map<string, Array<{ x: number; y: number }>>();
	for (const position of screenPositions) {
		const key = cellKey(position.x - minX, position.y - minY);
		const bucket = cells.get(key);
		if (bucket) {
			bucket.push(position);
		} else {
			cells.set(key, [position]);
		}
	}
	const colliding = new Set<{ x: number; y: number }>();
	for (const bucket of cells.values()) {
		if (bucket.length >= MIN_COLLIDING_BUCKET_SIZE) {
			for (const position of bucket) {
				colliding.add(position);
			}
		}
	}
	for (const [key, bucket] of cells) {
		for (const position of bucket) {
			if (colliding.has(position)) continue;
			forEachNeighboringBucket(cells, key, (neighbor) => {
				if (neighbor === bucket || colliding.has(position)) return;
				for (const candidate of neighbor) {
					if (positionsCollide(position, candidate)) {
						colliding.add(position);
						colliding.add(candidate);
						break;
					}
				}
			});
		}
	}
	const fraction = colliding.size / screenPositions.length;
	if (fraction >= OVERVIEW_COLLISION_THRESHOLD) return "overview";
	if (fraction > 0) return "context";
	return "detail";
}

export function aggregateScreenCells(
	nodes: TreeLayoutNode[],
	edges: RawEdge[],
	lod: TreeLod,
	contentHeight: number,
): TreeLayout {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	for (const node of nodes) {
		if (node.x < minX) minX = node.x;
		if (node.y < minY) minY = node.y;
	}
	const buckets = new Map<string, TreeLayoutNode[]>();
	for (const node of nodes) {
		const key = cellKey(node.x - minX, node.y - minY);
		const bucket = buckets.get(key);
		if (bucket) {
			bucket.push(node);
		} else {
			buckets.set(key, [node]);
		}
	}

	const collidingNodeIds = new Set<string>();
	const adjacentNodeIds = new Map<string, Set<string>>();
	const connectNodes = (aId: string, bId: string) => {
		collidingNodeIds.add(aId);
		collidingNodeIds.add(bId);
		let setA = adjacentNodeIds.get(aId);
		if (!setA) {
			setA = new Set();
			adjacentNodeIds.set(aId, setA);
		}
		setA.add(bId);
		let setB = adjacentNodeIds.get(bId);
		if (!setB) {
			setB = new Set();
			adjacentNodeIds.set(bId, setB);
		}
		setB.add(aId);
	};

	for (const bucket of buckets.values()) {
		if (bucket.length >= MIN_COLLIDING_BUCKET_SIZE) {
			const firstId = bucket[0].id;
			for (let i = 1; i < bucket.length; i++) {
				connectNodes(firstId, bucket[i].id);
			}
		}
	}

	for (const [key, bucket] of buckets) {
		forEachNeighboringBucket(buckets, key, (neighbor) => {
			if (neighbor === bucket) return;
			let connected = false;
			for (const node of bucket) {
				for (const candidate of neighbor) {
					if (positionsCollide(node, candidate)) {
						connectNodes(node.id, candidate.id);
						connected = true;
						break;
					}
				}
				if (connected) break;
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
		let sumX = 0;
		let sumY = 0;
		let sumWorldX = 0;
		let sumWorldY = 0;
		let minLane = Number.POSITIVE_INFINITY;
		let bMinX = Number.POSITIVE_INFINITY;
		let bMinY = Number.POSITIVE_INFINITY;
		let bMaxX = Number.NEGATIVE_INFINITY;
		let bMaxY = Number.NEGATIVE_INFINITY;
		let hasKnot = false;
		let hasLineageKnot = false;
		for (const node of members) {
			sumX += node.x;
			sumY += node.y;
			sumWorldX += node.worldX;
			sumWorldY += node.worldY;
			if (node.lane < minLane) minLane = node.lane;
			if (node.worldX < bMinX) bMinX = node.worldX;
			if (node.worldY < bMinY) bMinY = node.worldY;
			if (node.worldX > bMaxX) bMaxX = node.worldX;
			if (node.worldY > bMaxY) bMaxY = node.worldY;
			if (node.isKnot) hasKnot = true;
			if (node.isLineageKnot) hasLineageKnot = true;
		}
		// The cluster id derives from sorted constituent item ids so panning or
		// input reordering can never change it.
		const cluster: TreeLayoutNode = {
			id: `cluster:${itemIds.join(":")}`,
			item: members[members.length - 1].item,
			itemIds,
			x: sumX / members.length,
			y: sumY / members.length,
			worldX: sumWorldX / members.length,
			worldY: sumWorldY / members.length,
			lane: minLane,
			label: String(members.length),
			labelLines: [String(members.length)],
			labelWidth: 0,
			radius: Math.min(
				MAX_CLUSTER_RADIUS,
				BASE_CLUSTER_RADIUS + Math.log2(members.length) * CLUSTER_RADIUS_LOG_SCALE,
			),
			count: members.length,
			aggregate: true,
			isKnot: hasKnot,
			isLineageKnot: hasLineageKnot,
			bounds: {
				minX: bMinX,
				minY: bMinY,
				maxX: bMaxX,
				maxY: bMaxY,
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
