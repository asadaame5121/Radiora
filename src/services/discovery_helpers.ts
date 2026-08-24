import type { OutlineItem, OutlineLink, SearchAlias } from "../domain/models.ts";

export function neighborMap(links: readonly OutlineLink[]): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();
	for (const link of links) {
		const from = result.get(link.fromId) ?? new Set<string>();
		const to = result.get(link.toId) ?? new Set<string>();
		from.add(link.toId);
		to.add(link.fromId);
		result.set(link.fromId, from);
		result.set(link.toId, to);
	}
	return result;
}

export function rootId(item: OutlineItem, byId: ReadonlyMap<string, OutlineItem>): string {
	const visited = new Set([item.id]);
	let current = item;
	while (current.parentId && !visited.has(current.parentId)) {
		visited.add(current.parentId);
		const parent = byId.get(current.parentId);
		if (!parent) break;
		current = parent;
	}
	return current.id;
}

export function isReservedTagAlias(alias: SearchAlias): boolean {
	return alias.canonical.startsWith("#") &&
		alias.variants.every((variant) => variant.startsWith("#"));
}

export function ancestorsOf(item: OutlineItem, byId: ReadonlyMap<string, OutlineItem>): string[] {
	const result: string[] = [];
	const visited = new Set([item.id]);
	let parentId = item.parentId;
	while (parentId && !visited.has(parentId)) {
		visited.add(parentId);
		result.unshift(parentId);
		parentId = byId.get(parentId)?.parentId ?? null;
	}
	return result;
}
