import type { LinkType, OutlineItem, OutlineSnapshot } from "../domain/models.ts";

export type TreeLod = "detail" | "context" | "overview";
export type TreeLinkType = LinkType;
export type TreeProjection = "chronology" | "lineage";

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
	isLineageKnot: boolean;
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
	expandedItemIds: Set<string>;
	expandedClusterCount: number;
}

export interface TreeLayoutOptions {
	width: number;
	height: number;
	projectX: (timestamp: number) => number;
	projection?: TreeProjection;
	projectGeneration?: (generation: number) => number;
	/** Item ids from one overview cluster to display as individual nodes. */
	expandedOverviewItemIds?: ReadonlySet<string>;
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
			expandedItemIds: new Set(),
			expandedClusterCount: 0,
		};
	}

	const lineage = options.projection === "lineage" ? calculateLineageProjection(snapshot) : null;
	const projected = snapshot.items.map((item) => ({
		item,
		x: lineage
			? (options.projectGeneration ?? options.projectX)(
				lineage.knotWorkIds.has(item.workId)
					? lineage.knotGeneration ?? 0
					: lineage.generationByWorkId.get(item.workId) ?? 0,
			)
			: options.projectX(parseTimestamp(item.createdAt)),
	}));
	const visibleCount = Math.max(
		1,
		projected.filter(({ x }) => x >= -80 && x <= options.width + 80).length,
	);
	const visibleDensity = options.width / visibleCount;
	const lod = lodForDensity(visibleDensity);
	const laidOut = assignLanes(projected, snapshot, lod, options.height, lineage?.knotWorkIds);

	if (lod === "overview") {
		return aggregateOverview(
			laidOut.nodes,
			rawEdges(snapshot),
			visibleDensity,
			laidOut.contentHeight,
			options.expandedOverviewItemIds,
		);
	}

	const nodesById = new Map(laidOut.nodes.map((node) => [node.id, node]));
	return {
		lod,
		nodes: laidOut.nodes,
		edges: materializeEdges(rawEdges(snapshot), nodesById),
		visibleDensity,
		contentHeight: laidOut.contentHeight,
		expandedItemIds: new Set(),
		expandedClusterCount: 0,
	};
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
	projected: Array<{ item: OutlineItem; x: number }>,
	snapshot: OutlineSnapshot,
	lod: TreeLod,
	height: number,
	lineageKnotWorkIds: Set<string> = new Set(),
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
			? Math.min(
				180,
				Math.max(48, Math.max(...lines.map((line) => splitGraphemes(line).length)) * 13),
			)
			: 0;
		const radius = knotIds.has(item.id) ? 10 : 6;
		const intervalStart = x - radius - 5;
		const intervalEnd = x + radius + (lod === "detail" ? labelWidth + 18 : 10);
		const available: number[] = [];
		for (let lane = 0; lane < laneEnds.length; lane++) {
			if (laneEnds[lane] + NODE_GAP <= intervalStart) available.push(lane);
		}

		const preferredLane = preferredLaneById.get(item.id) ??
			(item.parentId ? laneById.get(item.parentId) : undefined) ??
			0;
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
			isKnot: knotIds.has(item.id) || lineageKnotWorkIds.has(item.workId),
			isLineageKnot: lineageKnotWorkIds.has(item.workId),
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
	expandedOverviewItemIds: ReadonlySet<string> | undefined,
): TreeLayout {
	const buckets = new Map<string, TreeLayoutNode[]>();
	for (const node of nodes) {
		const key = `${Math.floor(node.x / OVERVIEW_CELL_WIDTH)}:${
			Math.floor(node.y / OVERVIEW_CELL_HEIGHT)
		}`;
		const bucket = buckets.get(key) ?? [];
		bucket.push(node);
		buckets.set(key, bucket);
	}

	const aggregatedNodes: TreeLayoutNode[] = [];
	const aggregateByItemId = new Map<string, TreeLayoutNode>();
	const expandedItemIds = new Set<string>();
	let expandedClusterCount = 0;
	for (const [key, bucket] of buckets) {
		const representative = [...bucket].sort((a, b) =>
			b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id)
		)[0];
		const count = bucket.length;
		const clusterId = `cluster:${key}`;
		const centerX = bucket.reduce((total, node) =>
			total + node.x, 0) / count;
		const centerY = bucket.reduce((total, node) => total + node.y, 0) / count;
		const isExpanded = count > 1 && bucket.every((node) => expandedOverviewItemIds?.has(node.id));
		if (isExpanded) {
			const members = [...bucket].sort((a, b) =>
				a.item.orderKey - b.item.orderKey || a.item.id.localeCompare(b.item.id)
			);
			const middle = (members.length - 1) / 2;
			for (const [index, member] of members.entries()) {
				const offset = index - middle;
				const expanded = {
					...member,
					x: centerX + offset * 10,
					y: centerY + offset * 52,
				};
				aggregatedNodes.push(expanded);
				aggregateByItemId.set(member.id, expanded);
				expandedItemIds.add(member.id);
			}
			expandedClusterCount = count;
			continue;
		}
		const aggregate: TreeLayoutNode = {
			...representative,
			id: clusterId,
			itemIds: bucket.map((node) => node.id),
			x: centerX,
			y: centerY,
			label: count > 1 ? String(count) : "",
			labelLines: count > 1 ? [String(count)] : [],
			labelWidth: 0,
			radius: count > 1 ? Math.min(16, 8 + Math.log2(count) * 2) : representative.radius,
			count,
			aggregate: count > 1,
			isKnot: bucket.some((node) => node.isKnot),
			isLineageKnot: bucket.some((node) => node.isLineageKnot),
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
		expandedItemIds,
		expandedClusterCount,
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
