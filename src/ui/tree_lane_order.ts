import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

type Adjacency = Map<string, Set<string>>;
type Compare = (a: string, b: string) => number;

interface LaneComponent {
	members: string[];
	firstId: string;
}

function firstOrderedId(members: readonly string[], compare: Compare): string {
	let firstId = members[0];
	for (let index = 1; index < members.length; index++) {
		if (compare(members[index], firstId) < 0) firstId = members[index];
	}
	return firstId;
}

function orderedComponents(ids: string[], adjacency: Adjacency, compare: Compare): LaneComponent[] {
	const components = connectedComponents(ids, adjacency).map((members) => ({
		members,
		firstId: firstOrderedId(members, compare),
	}));
	return components.sort((a, b) => compare(a.firstId, b.firstId));
}

function visitLaneFrom(
	startId: string,
	adjacency: Adjacency,
	itemById: Map<string, OutlineItem>,
	compare: Compare,
	order: Map<string, number>,
): void {
	if (order.has(startId)) return;
	const stack = [startId];
	while (stack.length > 0) {
		const id = stack.pop();
		if (id === undefined || order.has(id)) continue;
		order.set(id, order.size);
		const neighbors = orderedNeighbors(id, adjacency, itemById, compare);
		for (let i = neighbors.length - 1; i >= 0; i--) {
			if (!order.has(neighbors[i])) stack.push(neighbors[i]);
		}
	}
}

/**
 * Deterministic proximity order: outline neighbors first, then semantic links.
 * Lane representatives retain input order; edge projection has a separate policy.
 */
export function buildLaneOrder(snapshot: OutlineSnapshot): Map<string, number> {
	const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
	const adjacency = buildAdjacency(snapshot);
	const compare = compareByOrderKeyThenId(itemById);
	const components = orderedComponents([...itemById.keys()], adjacency, compare);
	const order = new Map<string, number>();
	for (const { members, firstId } of components) {
		visitLaneFrom(firstId, adjacency, itemById, compare, order);
		for (const id of members) visitLaneFrom(id, adjacency, itemById, compare, order);
	}
	return order;
}

function buildAdjacency(snapshot: OutlineSnapshot): Adjacency {
	const adjacency = new Map(snapshot.items.map((item) => [item.id, new Set<string>()]));
	const addEdge = (a: string, b: string): void => {
		if (a === b) return;
		adjacency.get(a)?.add(b);
		adjacency.get(b)?.add(a);
	};
	const representativeByWork = new Map<string, string>();
	for (const item of snapshot.items) {
		if (item.parentId && adjacency.has(item.parentId)) addEdge(item.id, item.parentId);
		if (!representativeByWork.has(item.workId)) representativeByWork.set(item.workId, item.id);
	}
	for (const link of snapshot.links) {
		if (link.status === "retracted") continue;
		const from = representativeByWork.get(link.fromId);
		const to = representativeByWork.get(link.toId);
		if (from && to) addEdge(from, to);
	}
	return adjacency;
}

function connectedComponents(ids: string[], adjacency: Adjacency): string[][] {
	const visited = new Set<string>();
	const components: string[][] = [];
	for (const id of [...ids].sort()) {
		if (visited.has(id)) continue;
		const members = collectComponent(id, adjacency, visited);
		components.push(members.sort());
	}
	return components;
}

function orderedNeighbors(
	id: string,
	adjacency: Adjacency,
	itemById: Map<string, OutlineItem>,
	compare: Compare,
): string[] {
	const current = requireItem(itemById, id);
	const outline: string[] = [];
	const linked: string[] = [];
	for (const neighbor of adjacency.get(id) ?? []) {
		if (itemById.get(neighbor)?.parentId === id || current.parentId === neighbor) {
			outline.push(neighbor);
		} else {
			linked.push(neighbor);
		}
	}
	outline.sort(compare);
	linked.sort(compare);
	return [...outline, ...linked];
}

function compareByOrderKeyThenId(itemById: Map<string, OutlineItem>): Compare {
	return (a, b) => {
		const left = requireItem(itemById, a);
		const right = requireItem(itemById, b);
		return left.orderKey - right.orderKey || left.id.localeCompare(right.id);
	};
}

function requireItem(itemById: Map<string, OutlineItem>, id: string): OutlineItem {
	const item = itemById.get(id);
	if (!item) throw new Error(`Missing lane item: ${id}`);
	return item;
}

function collectComponent(id: string, adjacency: Adjacency, visited: Set<string>): string[] {
	const members: string[] = [];
	const stack = [id];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined || visited.has(current)) continue;
		visited.add(current);
		members.push(current);
		for (const neighbor of adjacency.get(current) ?? []) {
			if (!visited.has(neighbor)) stack.push(neighbor);
		}
	}
	return members;
}
