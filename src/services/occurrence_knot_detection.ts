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

export function markRecursivePlacements(items: OutlineItem[]): OutlineItem[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const children = new Map<string | null, OutlineItem[]>();
	const recursiveItemIds = new Set<string>();

	for (const item of items) {
		const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
		const bucket = children.get(parent) ?? [];
		bucket.push(item);
		children.set(parent, bucket);
	}

	const visited = new Set<string>();
	const workCounts = new Map<string, number>();

	const roots = children.get(null) ?? [];
	type Frame = { item: OutlineItem; entered: boolean };
	const stack: Frame[] = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		stack.push({ item: roots[i], entered: false });
	}

	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.entered) {
			const currentCount = workCounts.get(frame.item.workId) ?? 1;
			if (currentCount <= 1) {
				workCounts.delete(frame.item.workId);
			} else {
				workCounts.set(frame.item.workId, currentCount - 1);
			}
			continue;
		}

		if (visited.has(frame.item.id)) continue;
		visited.add(frame.item.id);

		if ((workCounts.get(frame.item.workId) ?? 0) > 0) {
			recursiveItemIds.add(frame.item.id);
		}

		workCounts.set(frame.item.workId, (workCounts.get(frame.item.workId) ?? 0) + 1);
		stack.push({ item: frame.item, entered: true });

		const itemChildren = children.get(frame.item.id) ?? [];
		for (let i = itemChildren.length - 1; i >= 0; i--) {
			if (!visited.has(itemChildren[i].id)) {
				stack.push({ item: itemChildren[i], entered: false });
			}
		}
	}

	if (visited.size < items.length) {
		for (const item of items) {
			if (!visited.has(item.id)) {
				const pathVisited = new Set<string>();
				let parentId = item.parentId;
				while (parentId) {
					if (pathVisited.has(parentId)) break;
					pathVisited.add(parentId);
					const parent = byId.get(parentId);
					if (!parent) break;
					if (parent.workId === item.workId) {
						recursiveItemIds.add(item.id);
						break;
					}
					parentId = parent.parentId;
				}
				visited.add(item.id);
			}
		}
	}

	if (recursiveItemIds.size === 0) return items;
	return items.map((item) =>
		recursiveItemIds.has(item.id) ? { ...item, referenceStub: true } : item
	);
}

export function detectOutlineKnots(
	items: OutlineItem[],
	existingKnots?: readonly Knot[],
): Knot[] {
	const existingById = existingKnots ? new Map(existingKnots.map((k) => [k.id, k])) : null;
	const byId = new Map(items.map((item) => [item.id, item]));
	const signatures = new Set<string>();
	const knots: Knot[] = [];
	const visitedState = new Map<string, number>();

	for (const start of items) {
		if (visitedState.get(start.id) === KNOT_VISITED_COMPLETE) continue;

		const path: string[] = [];
		const position = new Map<string, number>();
		let current: OutlineItem | undefined = start;

		while (current) {
			const state = visitedState.get(current.id);
			if (state === KNOT_VISITED_COMPLETE) {
				break;
			}
			const existing = position.get(current.id);
			if (existing !== undefined) {
				const cycleIds = path.slice(existing).sort();
				const signature = cycleIds.join(":");
				if (!signatures.has(signature)) {
					signatures.add(signature);
					const knotId = fingerprint(`knot:${signature}`);
					const prevKnot = existingById?.get(knotId);
					knots.push({
						id: knotId,
						cycleIds,
						createdAt: prevKnot ? prevKnot.createdAt : new Date().toISOString(),
					});
				}
				break;
			}
			position.set(current.id, path.length);
			path.push(current.id);
			visitedState.set(current.id, KNOT_VISITED_ON_PATH);

			if (current.parentId && !byId.has(current.parentId)) {
				const signature = `orphan:${current.id}`;
				if (!signatures.has(signature)) {
					signatures.add(signature);
					const knotId = fingerprint(`knot:${signature}`);
					const prevKnot = existingById?.get(knotId);
					knots.push({
						id: knotId,
						cycleIds: [current.id],
						createdAt: prevKnot ? prevKnot.createdAt : new Date().toISOString(),
					});
				}
				break;
			}
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}

		for (const id of path) {
			visitedState.set(id, KNOT_VISITED_COMPLETE);
		}
	}
	return knots;
}
