import type { LinkType, OutlineItem, OutlineSnapshot } from "../domain/models.ts";

export type TreeLod = "detail" | "context" | "overview";
export type TreeLinkType = "FROM" | LinkType;

export interface TreeLayoutNode {
	id: string;
	item: OutlineItem;
	itemIds: string[];
	x: number;
	y: number;
	lane: number;
	label: string;
	labelLines: string[];
	labelWidth: number;
	radius: number;
	count: number;
	aggregate: boolean;
	isKnot: boolean;
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
	visibleDensity: number;
	contentHeight: number;
}

export interface TreeLayoutOptions {
	width: number;
	height: number;
	projectX: (timestamp: number) => number;
}

interface RawEdge {
	sourceId: string;
	targetId: string;
	type: TreeLinkType;
}

const DETAIL_DENSITY = 96;
const CONTEXT_DENSITY = 32;
const NODE_GAP = 12;
const OVERVIEW_CELL_WIDTH = 48;
const OVERVIEW_CELL_HEIGHT = 36;

export function calculateTreeLayout(
	snapshot: OutlineSnapshot,
	options: TreeLayoutOptions,
): TreeLayout {
	if (snapshot.items.length === 0) {
		return {
			lod: "detail",
			nodes: [],
			edges: [],
			visibleDensity: options.width,
			contentHeight: options.height,
		};
	}

	const projected = snapshot.items.map((item) => ({
		item,
		x: options.projectX(parseTimestamp(item.createdAt)),
	}));
	const visibleCount = Math.max(
		1,
		projected.filter(({ x }) => x >= -80 && x <= options.width + 80).length,
	);
	const visibleDensity = options.width / visibleCount;
	const lod = lodForDensity(visibleDensity);
	const laidOut = assignLanes(projected, snapshot, lod, options.height);

	if (lod === "overview") {
		return aggregateOverview(laidOut.nodes, rawEdges(snapshot), visibleDensity, laidOut.contentHeight);
	}

	const nodesById = new Map(laidOut.nodes.map((node) => [node.id, node]));
	return {
		lod,
		nodes: laidOut.nodes,
		edges: materializeEdges(rawEdges(snapshot), nodesById),
		visibleDensity,
		contentHeight: laidOut.contentHeight,
	};
}

export function lodForDensity(density: number): TreeLod {
	if (density >= DETAIL_DENSITY) return "detail";
	if (density >= CONTEXT_DENSITY) return "context";
	return "overview";
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
	for (const item of snapshot.items) {
		if (item.id === id && item.parentId) result.add(item.parentId);
		if (item.parentId === id) result.add(item.id);
	}
	for (const link of snapshot.links) {
		if (link.fromId === id) result.add(link.toId);
		if (link.toId === id) result.add(link.fromId);
	}
	return result;
}

function assignLanes(
	projected: Array<{ item: OutlineItem; x: number }>,
	snapshot: OutlineSnapshot,
	lod: TreeLod,
	height: number,
): { nodes: TreeLayoutNode[]; contentHeight: number } {
	const knotIds = new Set(snapshot.stashItemIds);
	const baseLaneCount = lod === "detail"
		? Math.min(10, Math.max(1, Math.ceil(Math.sqrt(projected.length))))
		: Math.min(12, Math.max(4, Math.ceil(Math.sqrt(projected.length) * 1.5)));
	const preferredLaneById = structuralLanes(snapshot, baseLaneCount);
	const laneEnds: number[] = Array.from({ length: baseLaneCount }, () => Number.NEGATIVE_INFINITY);
	const laneById = new Map<string, number>();
	const laneSpacing = lod === "detail" ? 52 : lod === "context" ? 38 : 16;
	const sorted = [...projected].sort((a, b) =>
		a.x - b.x || a.item.orderKey - b.item.orderKey || a.item.id.localeCompare(b.item.id)
	);
	const pending: Array<Omit<TreeLayoutNode, "y">> = [];

	for (const { item, x } of sorted) {
		const { label, lines } = labelForItem(item.text);
		const labelWidth = lod !== "overview"
			? Math.min(180, Math.max(48, Math.max(...lines.map((line) => splitGraphemes(line).length)) * 13))
			: 0;
		const radius = knotIds.has(item.id) ? 10 : 6;
		const intervalStart = x - radius - 5;
		const intervalEnd = x + radius + (lod === "detail" ? labelWidth + 18 : 10);
		const available: number[] = [];
		for (let lane = 0; lane < laneEnds.length; lane++) {
			if (laneEnds[lane] + NODE_GAP <= intervalStart) available.push(lane);
		}

		const preferredLane = preferredLaneById.get(item.id)
			?? (item.parentId ? laneById.get(item.parentId) : undefined)
			?? 0;
		let lane: number;
		if (available.length > 0) {
			lane = available.reduce((best, candidate) =>
				Math.abs(candidate - preferredLane) < Math.abs(best - preferredLane) ? candidate : best
			);
		} else {
			lane = laneEnds.length;
			laneEnds.push(Number.NEGATIVE_INFINITY);
		}
		laneEnds[lane] = intervalEnd;
		laneById.set(item.id, lane);
		pending.push({
			id: item.id,
			item,
			itemIds: [item.id],
			x,
			lane,
			label,
			labelLines: lines,
			labelWidth,
			radius,
			count: 1,
			aggregate: false,
			isKnot: knotIds.has(item.id),
		});
	}

	const occupiedHeight = Math.max(0, laneEnds.length - 1) * laneSpacing;
	const top = Math.max(60, (height - occupiedHeight) / 2);
	const contentHeight = Math.max(height, top + occupiedHeight + 60);
	return {
		nodes: pending.map((node) => ({ ...node, y: top + node.lane * laneSpacing })),
		contentHeight,
	};
}

function structuralLanes(snapshot: OutlineSnapshot, laneCount: number): Map<string, number> {
	const byParent = new Map<string | null, OutlineItem[]>();
	const ids = new Set(snapshot.items.map((item) => item.id));
	for (const item of snapshot.items) {
		const parentId = item.parentId && ids.has(item.parentId) ? item.parentId : null;
		const bucket = byParent.get(parentId) ?? [];
		bucket.push(item);
		byParent.set(parentId, bucket);
	}
	for (const bucket of byParent.values()) {
		bucket.sort((a, b) => a.orderKey - b.orderKey || a.id.localeCompare(b.id));
	}

	const ordered: OutlineItem[] = [];
	const visited = new Set<string>();
	const visit = (item: OutlineItem) => {
		if (visited.has(item.id)) return;
		visited.add(item.id);
		ordered.push(item);
		for (const child of byParent.get(item.id) ?? []) visit(child);
	};
	for (const root of byParent.get(null) ?? []) visit(root);
	for (const item of snapshot.items) visit(item);

	const result = new Map<string, number>();
	const denominator = Math.max(1, ordered.length - 1);
	ordered.forEach((item, index) => {
		result.set(item.id, Math.round(index / denominator * Math.max(0, laneCount - 1)));
	});
	return result;
}

function aggregateOverview(
	nodes: TreeLayoutNode[],
	edges: RawEdge[],
	visibleDensity: number,
	contentHeight: number,
): TreeLayout {
	const buckets = new Map<string, TreeLayoutNode[]>();
	for (const node of nodes) {
		const key = `${Math.floor(node.x / OVERVIEW_CELL_WIDTH)}:${Math.floor(node.y / OVERVIEW_CELL_HEIGHT)}`;
		const bucket = buckets.get(key) ?? [];
		bucket.push(node);
		buckets.set(key, bucket);
	}

	const aggregatedNodes: TreeLayoutNode[] = [];
	const aggregateByItemId = new Map<string, TreeLayoutNode>();
	for (const [key, bucket] of buckets) {
		const representative = [...bucket].sort((a, b) =>
			b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id)
		)[0];
		const count = bucket.length;
		const aggregate: TreeLayoutNode = {
			...representative,
			id: `cluster:${key}`,
			itemIds: bucket.map((node) => node.id),
			x: bucket.reduce((total, node) => total + node.x, 0) / count,
			y: bucket.reduce((total, node) => total + node.y, 0) / count,
			label: count > 1 ? String(count) : "",
			labelLines: count > 1 ? [String(count)] : [],
			labelWidth: 0,
			radius: count > 1 ? Math.min(16, 8 + Math.log2(count) * 2) : representative.radius,
			count,
			aggregate: count > 1,
			isKnot: bucket.some((node) => node.isKnot),
		};
		aggregatedNodes.push(aggregate);
		for (const node of bucket) aggregateByItemId.set(node.id, aggregate);
	}

	return {
		lod: "overview",
		nodes: aggregatedNodes,
		edges: materializeEdges(edges, aggregateByItemId),
		visibleDensity,
		contentHeight,
	};
}

function rawEdges(snapshot: OutlineSnapshot): RawEdge[] {
	const ids = new Set(snapshot.items.map((item) => item.id));
	const result: RawEdge[] = [];
	for (const item of snapshot.items) {
		if (item.parentId && ids.has(item.parentId)) {
			result.push({ sourceId: item.parentId, targetId: item.id, type: "FROM" });
		}
	}
	for (const link of snapshot.links) {
		if (ids.has(link.fromId) && ids.has(link.toId)) {
			result.push({ sourceId: link.fromId, targetId: link.toId, type: link.type });
		}
	}
	return result;
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
