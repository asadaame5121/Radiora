import type { OutlineSnapshot } from "../domain/models.ts";
import { buildDirectNeighborSet } from "./tree_layout.ts";

export function resolveTreeSelectionId(
	snapshot: OutlineSnapshot,
	selectedId: string | null,
	selectedWorkId: string | null,
): string | null {
	if (selectedId && snapshot.items.some((item) => item.id === selectedId)) return selectedId;
	return snapshot.items.find((item) => item.workId === selectedWorkId)?.id ?? null;
}

export function buildTreeHighlightSet(
	snapshot: OutlineSnapshot,
	selectionId: string | null,
	hoveredId: string | null,
): Set<string> {
	if (hoveredId) return buildDirectNeighborSet(snapshot, hoveredId);
	if (!selectionId) return new Set();
	return new Set([
		...buildStructuralClosure(snapshot, selectionId),
		...buildDirectNeighborSet(snapshot, selectionId),
	]);
}

/** Every structural ancestor and descendant of an Occurrence. */
export function buildStructuralClosure(snapshot: OutlineSnapshot, id: string): Set<string> {
	const [parentsById, childrenById] = buildStructuralAdjacency(snapshot);
	return new Set([...collectReachable(id, parentsById), ...collectReachable(id, childrenById)]);
}

function buildStructuralAdjacency(
	snapshot: OutlineSnapshot,
): readonly [Map<string, Set<string>>, Map<string, Set<string>>] {
	const itemIds = new Set(snapshot.items.map((item) => item.id));
	const itemIdsByWork = new Map<string, string[]>();
	const parentsById = new Map<string, Set<string>>();
	const childrenById = new Map<string, Set<string>>();

	for (const item of snapshot.items) {
		const workItems = itemIdsByWork.get(item.workId) ?? [];
		workItems.push(item.id);
		itemIdsByWork.set(item.workId, workItems);
		if (item.parentId) {
			addStructuralRelation(itemIds, parentsById, childrenById, item.parentId, item.id);
		}
	}
	for (const link of snapshot.links) {
		if (link.status === "retracted" || link.type !== "FROM") continue;
		for (const parentId of itemIdsByWork.get(link.fromId) ?? []) {
			for (const childId of itemIdsByWork.get(link.toId) ?? []) {
				addStructuralRelation(itemIds, parentsById, childrenById, parentId, childId);
			}
		}
	}
	return [parentsById, childrenById];
}

function addStructuralRelation(
	itemIds: ReadonlySet<string>,
	parentsById: Map<string, Set<string>>,
	childrenById: Map<string, Set<string>>,
	parentId: string,
	childId: string,
): void {
	if (parentId === childId || !itemIds.has(parentId) || !itemIds.has(childId)) return;
	addToSetMap(childrenById, parentId, childId);
	addToSetMap(parentsById, childId, parentId);
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string): void {
	const values = map.get(key) ?? new Set<string>();
	values.add(value);
	map.set(key, values);
}

function collectReachable(
	id: string,
	adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
	const result = new Set<string>([id]);
	const queue = [id];
	for (let index = 0; index < queue.length; index++) {
		for (const neighborId of adjacency.get(queue[index]) ?? []) {
			if (result.has(neighborId)) continue;
			result.add(neighborId);
			queue.push(neighborId);
		}
	}
	return result;
}
