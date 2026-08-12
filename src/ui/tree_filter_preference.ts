import { LINK_TYPES } from "../domain/models.ts";
import type { GlobalLineageFilter } from "../services/global_lineage_filter.ts";
import { defaultGlobalLineageFilter } from "../services/global_lineage_filter.ts";

export const TREE_FILTER_STORAGE_KEY = "radiora.treeFilter";

export interface TreeFilterStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface StoredTreeFilter {
	includeIsolated: boolean;
	linkTypes: string[];
}

/**
 * Persists only the local display conditions. `includeWorkIds` is a transient
 * exception (the selected Work) and is deliberately never stored.
 */
export function loadTreeFilterPreference(
	storage: TreeFilterStorage | null = browserStorage(),
): GlobalLineageFilter {
	const defaults = defaultGlobalLineageFilter();
	const stored = readStoredFilter(storage);
	return stored === null ? defaults : {
		includeIsolated: stored.includeIsolated,
		linkTypes: stored.linkTypes as GlobalLineageFilter["linkTypes"],
		includeWorkIds: [],
	};
}

export function saveTreeFilterPreference(
	filter: GlobalLineageFilter,
	storage: TreeFilterStorage | null = browserStorage(),
): void {
	if (storage === null) return;
	try {
		const stored: StoredTreeFilter = {
			includeIsolated: filter.includeIsolated,
			linkTypes: [...filter.linkTypes],
		};
		storage.setItem(TREE_FILTER_STORAGE_KEY, JSON.stringify(stored));
		// biome-ignore lint/plugin/noSwallowedRejection: Tree filter persistence is optional and must not make the tree unusable.
	} catch {
		// This UI preference is best-effort and must not make the tree unusable.
	}
}

/**
 * Invalid or outdated payloads fall back to the defaults: isolated Works shown
 * and every link type enabled.
 */
function readStoredFilter(storage: TreeFilterStorage | null): StoredTreeFilter | null {
	if (storage === null) return null;
	let parsed: unknown;
	try {
		const raw = storage.getItem(TREE_FILTER_STORAGE_KEY);
		if (raw === null) return null;
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = parsed as Partial<StoredTreeFilter>;
	if (typeof candidate.includeIsolated !== "boolean") return null;
	if (!Array.isArray(candidate.linkTypes)) return null;
	const validTypes = new Set<string>(LINK_TYPES);
	if (!candidate.linkTypes.every((type) => typeof type === "string" && validTypes.has(type))) {
		return null;
	}
	return { includeIsolated: candidate.includeIsolated, linkTypes: candidate.linkTypes };
}

function browserStorage(): TreeFilterStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
