import type { LinkType, OutlineItem, OutlineSnapshot } from "../domain/models.ts";

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

export interface LineageProjection {
	generationByWorkId: Map<string, number>;
	knotWorkIds: Set<string>;
	maxGeneration: number;
	knotGeneration: number | null;
}

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
	const lineage = options.projection === "lineage" ? calculateLineageProjection(snapshot) : null;
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
	const laidOut = assignLanes(projected, snapshot, options.height, lineage?.knotWorkIds);
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

export function calculateLineageProjection(snapshot: OutlineSnapshot): LineageProjection {
	const workIds = [...new Set(snapshot.items.map((item) => item.workId))].sort();
	const visibleWorkIds = new Set(workIds);
	const children = new Map(workIds.map((id) => [id, new Set<string>()]));
	const parents = new Map(workIds.map((id) => [id, new Set<string>()]));

	for (const link of snapshot.links) {
		if (
			link.type !== "FROM" ||
			!visibleWorkIds.has(link.fromId) ||
			!visibleWorkIds.has(link.toId)
		) continue;
		// Lineage levels follow the asserted FROM direction so every visible
		// source starts at G0 and each reachable target advances one generation.
		children.get(link.fromId)?.add(link.toId);
		parents.get(link.toId)?.add(link.fromId);
	}

	const knotWorkIds = findCyclicWorkIds(workIds, children);
	const generationByWorkId = new Map<string, number>();
	const indegree = new Map<string, number>();
	for (const workId of workIds) {
		if (knotWorkIds.has(workId)) continue;
		indegree.set(
			workId,
			[...(parents.get(workId) ?? [])].filter((parent) => !knotWorkIds.has(parent)).length,
		);
		generationByWorkId.set(workId, 0);
	}

	const ready = [...indegree]
		.filter(([, degree]) => degree === 0)
		.map(([id]) => id)
		.sort();
	while (ready.length > 0) {
		const parent = ready.shift()!;
		const parentGeneration = generationByWorkId.get(parent) ?? 0;
		for (const child of [...(children.get(parent) ?? [])].sort()) {
			if (knotWorkIds.has(child)) continue;
			generationByWorkId.set(
				child,
				Math.max(generationByWorkId.get(child) ?? 0, parentGeneration + 1),
			);
			const nextDegree = (indegree.get(child) ?? 0) - 1;
			indegree.set(child, nextDegree);
			if (nextDegree === 0) {
				ready.push(child);
				ready.sort();
			}
		}
	}

	const maxGeneration = Math.max(0, ...generationByWorkId.values());
	return {
		generationByWorkId,
		knotWorkIds,
		maxGeneration,
		knotGeneration: knotWorkIds.size > 0 ? maxGeneration + 1 : null,
	};
}

function findCyclicWorkIds(
	workIds: string[],
	children: Map<string, Set<string>>,
): Set<string> {
	let index = 0;
	const indexById = new Map<string, number>();
	const lowLinkById = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const cyclic = new Set<string>();

	const visit = (workId: string) => {
		indexById.set(workId, index);
		lowLinkById.set(workId, index);
		index++;
		stack.push(workId);
		onStack.add(workId);

		for (const child of [...(children.get(workId) ?? [])].sort()) {
			if (!indexById.has(child)) {
				visit(child);
				lowLinkById.set(
					workId,
					Math.min(lowLinkById.get(workId)!, lowLinkById.get(child)!),
				);
			} else if (onStack.has(child)) {
				lowLinkById.set(
					workId,
					Math.min(lowLinkById.get(workId)!, indexById.get(child)!),
				);
			}
		}

		if (lowLinkById.get(workId) !== indexById.get(workId)) return;
		const component: string[] = [];
		let member: string;
		do {
			member = stack.pop()!;
			onStack.delete(member);
			component.push(member);
		} while (member !== workId);
		if (
			component.length > 1 ||
			(children.get(workId)?.has(workId) ?? false)
		) {
			for (const id of component) cyclic.add(id);
		}
	};

	for (const workId of workIds) {
		if (!indexById.has(workId)) visit(workId);
	}
	return cyclic;
}

/**
 * Decides the LOD from screen-space collisions instead of a density proxy.
 * Nodes sharing a 48x36px screen cell are colliding; the fraction of colliding
 * nodes maps to the shared Chronology/Lineage LOD scale.
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
	const cells = new Map<string, number>();
	for (const position of screenPositions) {
		const key = cellKey(position.x - minX, position.y - minY);
		cells.set(key, (cells.get(key) ?? 0) + 1);
	}
	let colliding = 0;
	for (const count of cells.values()) {
		if (count > 1) colliding += count;
	}
	const fraction = colliding / screenPositions.length;
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

/**
 * Deterministic order for placing same-X items onto Y lanes.
 *
 * The order walks connected components of FROM links, outline parent/child
 * placement, and the other asserted semantic links, then falls back to
 * orderKey and item id. Non-FROM links influence only this proximity order and
 * never change a generation. Items without links still get their own lane.
 */
export function buildLaneOrder(snapshot: OutlineSnapshot): Map<string, number> {
	const ids = snapshot.items.map((item) => item.id);
	const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
	const addEdge = (a: string, b: string): void => {
		if (a === b) return;
		adjacency.get(a)?.add(b);
		adjacency.get(b)?.add(a);
	};
	const idSet = new Set(ids);
	const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
	for (const item of snapshot.items) {
		if (item.parentId && idSet.has(item.parentId)) addEdge(item.id, item.parentId);
	}
	const representativeByWork = new Map<string, string>();
	for (const item of snapshot.items) {
		if (!representativeByWork.has(item.workId)) representativeByWork.set(item.workId, item.id);
	}
	for (const link of snapshot.links) {
		if (link.status === "retracted") continue;
		const fromItemId = representativeByWork.get(link.fromId);
		const toItemId = representativeByWork.get(link.toId);
		if (fromItemId && toItemId) addEdge(fromItemId, toItemId);
	}

	const componentOf = new Map<string, number>();
	const membersByComponent = new Map<number, string[]>();
	let componentIndex = 0;
	for (const id of [...ids].sort()) {
		if (componentOf.has(id)) continue;
		const members: string[] = [];
		const stack = [id];
		while (stack.length > 0) {
			const current = stack.pop()!;
			if (componentOf.has(current)) continue;
			componentOf.set(current, componentIndex);
			members.push(current);
			for (const neighbor of adjacency.get(current) ?? []) {
				if (!componentOf.has(neighbor)) stack.push(neighbor);
			}
		}
		membersByComponent.set(componentIndex, members.sort());
		componentIndex++;
	}

	const componentKey = (members: string[]): [number, string] => {
		const ordered = [...members].sort(compareByOrderKeyThenId(itemById));
		const first = ordered[0];
		return [itemById.get(first)!.orderKey, first];
	};
	const orderedComponents = [...membersByComponent.keys()].sort((a, b) => {
		const [orderKeyA, idA] = componentKey(membersByComponent.get(a)!);
		const [orderKeyB, idB] = componentKey(membersByComponent.get(b)!);
		return orderKeyA - orderKeyB || idA.localeCompare(idB);
	});

	const order = new Map<string, number>();
	let cursor = 0;
	for (const index of orderedComponents) {
		const members = membersByComponent.get(index)!;
		const start = [...members].sort((a, b) => {
			const left = itemById.get(a)!;
			const right = itemById.get(b)!;
			return left.orderKey - right.orderKey || left.id.localeCompare(right.id);
		})[0];
		const visited = new Set<string>();
		const visit = (id: string) => {
			if (visited.has(id)) return;
			visited.add(id);
			order.set(id, cursor++);
			const current = itemById.get(id)!;
			const neighbors = [...(adjacency.get(id) ?? [])];
			const parentChildren = neighbors.filter((neighbor) =>
				itemById.get(neighbor)?.parentId === id || current.parentId === neighbor
			).sort(compareByOrderKeyThenId(itemById));
			const linked = neighbors.filter((neighbor) => !parentChildren.includes(neighbor))
				.sort(compareByOrderKeyThenId(itemById));
			for (const neighbor of [...parentChildren, ...linked]) visit(neighbor);
		};
		visit(start);
		for (const member of members) visit(member);
	}
	return order;
}

function compareByOrderKeyThenId(
	itemById: Map<string, OutlineItem>,
): (a: string, b: string) => number {
	return (a, b) => {
		const left = itemById.get(a)!;
		const right = itemById.get(b)!;
		return left.orderKey - right.orderKey || left.id.localeCompare(right.id);
	};
}

function assignLanes(
	projected: Array<{ item: OutlineItem; worldX: number }>,
	snapshot: OutlineSnapshot,
	height: number,
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

	for (const { item, worldX } of sorted) {
		const { label, lines } = labelForItem(item.text);
		const labelWidth = Math.min(
			180,
			Math.max(48, Math.max(...lines.map((line) => splitGraphemes(line).length)) * 13),
		);
		const radius = knotIds.has(item.id) ? 10 : 6;
		const intervalStart = worldX - radius - 5;
		// Labels are rendered to the right of the node. Reserve their full
		// horizontal extent here, otherwise nearby Chronology nodes can share a
		// lane even though their text overlaps.
		const intervalEnd = worldX + radius + 12 + labelWidth;
		let lane = -1;
		for (let candidate = 0; candidate < laneEnds.length; candidate++) {
			if (laneEnds[candidate] + NODE_GAP <= intervalStart) {
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

	const aggregatedNodes: TreeLayoutNode[] = [];
	const nodeByItemId = new Map<string, TreeLayoutNode>();
	for (const bucket of buckets.values()) {
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
