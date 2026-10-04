import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";

type Adjacency = Map<string, Set<string>>;
type Compare = (a: string, b: string) => number;

/**
 * Deterministic proximity order: outline neighbors first, then semantic links.
 * Lane representatives retain input order; edge projection has a separate policy.
 */
export function buildLaneOrder(snapshot: OutlineSnapshot): Map<string, number> {
	const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
	const adjacency = buildAdjacency(snapshot);
	const compare = compareByOrderKeyThenId(itemById);
	const components = connectedComponents([...itemById.keys()], adjacency);
	const first = (members: string[]) => [...members].sort(compare)[0];
	components.sort((a, b) => compare(first(a), first(b)));
	const order = new Map<string, number>();
	for (const members of components) {
		const visit = (id: string): void => {
			if (order.has(id)) return;
			order.set(id, order.size);
			for (const neighbor of orderedNeighbors(id, adjacency, itemById, compare)) visit(neighbor);
		};
		visit(first(members));
		for (const id of members) visit(id);
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
	const neighbors = [...(adjacency.get(id) ?? [])];
	const outline = neighbors.filter((neighbor) =>
		itemById.get(neighbor)?.parentId === id || current.parentId === neighbor
	).sort(compare);
	const linked = neighbors.filter((neighbor) => !outline.includes(neighbor)).sort(compare);
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
