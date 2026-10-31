import type { Knot, OutlineItem } from "../domain/models.ts";

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const HEX_RADIX = 16;
const KNOT_VISITED_ON_PATH = 1;
const KNOT_VISITED_COMPLETE = 2;

function fingerprint(value: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (const char of value) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, FNV_PRIME);
	}
	return `s-${(hash >>> 0).toString(HEX_RADIX)}`;
}

export interface MarkRecursivePlacementsOptions {
	onHop?: () => void;
}

interface PlacementTraversal {
	children: ReadonlyMap<string | null, OutlineItem[]>;
	visited: Set<string>;
	recursiveItemIds: Set<string>;
	onHop?: () => void;
}

interface PlacementFrame {
	item: OutlineItem;
	entered: boolean;
}

function leavePlacement(item: OutlineItem, workCounts: Map<string, number>): void {
	const count = workCounts.get(item.workId) ?? 1;
	if (count <= 1) workCounts.delete(item.workId);
	else workCounts.set(item.workId, count - 1);
}

function enterPlacement(
	item: OutlineItem,
	context: PlacementTraversal,
	workCounts: Map<string, number>,
	stack: PlacementFrame[],
): void {
	if (context.visited.has(item.id)) return;
	context.visited.add(item.id);
	context.onHop?.();
	const count = workCounts.get(item.workId) ?? 0;
	if (count > 0) context.recursiveItemIds.add(item.id);
	workCounts.set(item.workId, count + 1);
	stack.push({ item, entered: true });
	const children = context.children.get(item.id) ?? [];
	for (let index = children.length - 1; index >= 0; index--) {
		if (!context.visited.has(children[index].id)) {
			stack.push({ item: children[index], entered: false });
		}
	}
}

function traversePlacements(
	roots: readonly OutlineItem[],
	context: PlacementTraversal,
	initialWorkCounts?: ReadonlyMap<string, number>,
): void {
	const workCounts = initialWorkCounts ? new Map(initialWorkCounts) : new Map<string, number>();
	const stack: PlacementFrame[] = [];
	for (let index = roots.length - 1; index >= 0; index--) {
		stack.push({ item: roots[index], entered: false });
	}
	while (stack.length > 0) {
		const frame = stack.pop();
		if (!frame) continue;
		if (frame.entered) leavePlacement(frame.item, workCounts);
		else enterPlacement(frame.item, context, workCounts, stack);
	}
}

function handlePlacementCycle(
	path: readonly OutlineItem[],
	cycleStart: number,
	context: PlacementTraversal,
): void {
	const cycleItems = path.slice(cycleStart);
	const cycleSet = new Set(cycleItems.map((item) => item.id));
	const cycleWorkCounts = new Map<string, number>();
	for (const item of cycleItems) {
		context.recursiveItemIds.add(item.id);
		context.visited.add(item.id);
		cycleWorkCounts.set(item.workId, (cycleWorkCounts.get(item.workId) ?? 0) + 1);
	}
	const attachedBranches: OutlineItem[] = [];
	for (const item of cycleItems) {
		for (const child of context.children.get(item.id) ?? []) {
			if (!cycleSet.has(child.id) && !context.visited.has(child.id)) attachedBranches.push(child);
		}
	}
	traversePlacements(attachedBranches, context, cycleWorkCounts);
}

function traverseUnvisitedComponent(
	startItem: OutlineItem,
	byId: ReadonlyMap<string, OutlineItem>,
	context: PlacementTraversal,
): void {
	const path: OutlineItem[] = [];
	const pathIndex = new Map<string, number>();
	let current: OutlineItem | undefined = startItem;
	while (current) {
		context.onHop?.();
		if (context.visited.has(current.id)) break;
		const cycleStart = pathIndex.get(current.id);
		if (cycleStart !== undefined) {
			handlePlacementCycle(path, cycleStart, context);
			return;
		}
		pathIndex.set(current.id, path.length);
		path.push(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	if (!current && path.length > 0 && pathIndex.size === path.length) {
		const topItem = path[path.length - 1];
		if (!context.visited.has(topItem.id)) traversePlacements([topItem], context);
	}
}

function placementChildren(
	items: OutlineItem[],
	byId: ReadonlyMap<string, OutlineItem>,
): Map<string | null, OutlineItem[]> {
	const children = new Map<string | null, OutlineItem[]>();
	for (const item of items) {
		const parentId = item.parentId && byId.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parentId) ?? [];
		bucket.push(item);
		children.set(parentId, bucket);
	}
	return children;
}

export function markRecursivePlacements(
	items: OutlineItem[],
	options?: MarkRecursivePlacementsOptions,
): OutlineItem[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const context: PlacementTraversal = {
		children: placementChildren(items, byId),
		visited: new Set(),
		recursiveItemIds: new Set(),
		onHop: options?.onHop,
	};
	traversePlacements(context.children.get(null) ?? [], context);
	for (const item of items) {
		if (!context.visited.has(item.id)) traverseUnvisitedComponent(item, byId, context);
	}
	if (context.recursiveItemIds.size === 0) return items;
	return items.map((item) =>
		context.recursiveItemIds.has(item.id) ? { ...item, referenceStub: true } : item,
	);
}

function recordKnot(
	signature: string,
	cycleIds: string[],
	existingById: ReadonlyMap<string, Knot> | null,
	signatures: Set<string>,
	knots: Knot[],
): void {
	if (signatures.has(signature)) return;
	signatures.add(signature);
	const knotId = fingerprint(`knot:${signature}`);
	const previous = existingById?.get(knotId);
	knots.push({
		id: knotId,
		cycleIds,
		createdAt: previous ? previous.createdAt : new Date().toISOString(),
	});
}

function inspectKnotPath(
	start: Pick<OutlineItem, "id" | "parentId">,
	byId: ReadonlyMap<string, Pick<OutlineItem, "id" | "parentId">>,
	visitedState: Map<string, number>,
	existingById: ReadonlyMap<string, Knot> | null,
	signatures: Set<string>,
	knots: Knot[],
): void {
	const path: string[] = [];
	const position = new Map<string, number>();
	let current: Pick<OutlineItem, "id" | "parentId"> | undefined = start;
	while (current) {
		if (visitedState.get(current.id) === KNOT_VISITED_COMPLETE) break;
		const cycleStart = position.get(current.id);
		if (cycleStart !== undefined) {
			const cycleIds = path.slice(cycleStart).sort();
			recordKnot(cycleIds.join(":"), cycleIds, existingById, signatures, knots);
			break;
		}
		position.set(current.id, path.length);
		path.push(current.id);
		visitedState.set(current.id, KNOT_VISITED_ON_PATH);
		if (current.parentId && !byId.has(current.parentId)) {
			recordKnot(`orphan:${current.id}`, [current.id], existingById, signatures, knots);
			break;
		}
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	for (const id of path) visitedState.set(id, KNOT_VISITED_COMPLETE);
}

export function detectOutlineKnots(
	items: readonly Pick<OutlineItem, "id" | "parentId">[],
	existingKnots?: readonly Knot[],
): Knot[] {
	const existingById = existingKnots ? new Map(existingKnots.map((k) => [k.id, k])) : null;
	const byId = new Map(items.map((item) => [item.id, item]));
	const signatures = new Set<string>();
	const knots: Knot[] = [];
	const visitedState = new Map<string, number>();
	for (const start of items) {
		if (visitedState.get(start.id) === KNOT_VISITED_COMPLETE) continue;
		inspectKnotPath(start, byId, visitedState, existingById, signatures, knots);
	}
	return knots;
}
