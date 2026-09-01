import type { LinkType, OutlineItem, OutlineLink } from "../domain/models.ts";
import { LINK_TYPES } from "../domain/models.ts";

/**
 * Display conditions applied when a GlobalLineageProjection is built.
 *
 * The filter deliberately lives at projection time so layout, rendering, and IPC
 * transfer all see a reduced Work set. Storage-side pushdown stays possible
 * because this shape is plain data and carries no UI state.
 */
export interface GlobalLineageFilter {
	/** Show Works that have no valid link to another Work under the selected types. */
	includeIsolated: boolean;
	/** Link types that count as connections. Works reachable only through other types are isolated. */
	linkTypes: readonly LinkType[];
	/** Transient exceptions (for example the currently selected Work) that are shown even when isolated. */
	includeWorkIds: readonly string[];
}

export interface FilteredGlobalLineage {
	items: OutlineItem[];
	links: OutlineLink[];
}

export function defaultGlobalLineageFilter(
	allowedTypes: readonly LinkType[] = LINK_TYPES,
): GlobalLineageFilter {
	return {
		includeIsolated: true,
		linkTypes: [...allowedTypes],
		includeWorkIds: [],
	};
}

export function isValidGlobalLineageFilter(
	value: unknown,
	allowedTypes: readonly string[] = LINK_TYPES,
): value is GlobalLineageFilter {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<GlobalLineageFilter>;
	if (typeof candidate.includeIsolated !== "boolean") return false;
	if (!Array.isArray(candidate.linkTypes)) return false;
	const validTypes = new Set<string>(allowedTypes);
	if (!candidate.linkTypes.every((type) => typeof type === "string" && validTypes.has(type))) {
		return false;
	}
	if (!Array.isArray(candidate.includeWorkIds)) return false;
	return candidate.includeWorkIds.every((id) => typeof id === "string");
}

/**
 * Applies the filter to representative Occurrences and their links.
 *
 * Order is fixed: the link type set is applied first, the connected Work set is
 * derived from the surviving links, and isolated Works are removed last. A Work
 * is isolated when it has no valid non-retracted link to a different Work whose
 * type is selected; self links, links to absent Works, and links of hidden types
 * never count as connections.
 */
export function applyGlobalLineageFilter(
	filter: GlobalLineageFilter,
	items: readonly OutlineItem[],
	links: readonly OutlineLink[],
): FilteredGlobalLineage {
	const selectedTypes = new Set(filter.linkTypes);
	const activeWorkIds = new Set(items.map((item) => item.workId));
	const valid: OutlineLink[] = [];
	for (const link of links) {
		if (link.status === "retracted") continue;
		if (!selectedTypes.has(link.type)) continue;
		const fromWorkId = link.from.workId;
		const toWorkId = link.to.workId;
		if (fromWorkId === toWorkId) continue;
		if (!activeWorkIds.has(fromWorkId) || !activeWorkIds.has(toWorkId)) continue;
		valid.push(link);
	}

	const connectedWorkIds = new Set<string>();
	for (const link of valid) {
		connectedWorkIds.add(link.from.workId);
		connectedWorkIds.add(link.to.workId);
	}

	const keptWorkIds = filter.includeIsolated
		? activeWorkIds
		: new Set([...connectedWorkIds, ...filter.includeWorkIds]);
	const keptItems = items.filter((item) => keptWorkIds.has(item.workId));
	const keptSet = new Set(keptItems.map((item) => item.workId));
	const keptLinks = valid.filter((link) =>
		keptSet.has(link.from.workId) && keptSet.has(link.to.workId)
	);
	return { items: keptItems, links: keptLinks };
}
