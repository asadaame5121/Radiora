import { array, boolean, check, type InferOutput, object, pipe, safeParse, string } from "valibot";
import type { LinkType } from "../domain/models.ts";
import { LINK_TYPES } from "../domain/models.ts";
import type { GlobalLineageFilter } from "../services/global_lineage_filter.ts";
import { defaultGlobalLineageFilter } from "../services/global_lineage_filter.ts";

export const TREE_FILTER_STORAGE_KEY = "radiora.treeFilter";

export interface TreeFilterStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const StoredTreeFilterSchema = object({
	includeIsolated: boolean(),
	linkTypes: array(string()),
});

export type StoredTreeFilter = InferOutput<typeof StoredTreeFilterSchema>;

export function createTreeFilterPreferenceSchema(allowedTypes: readonly string[] = LINK_TYPES) {
	const validTypes = new Set<string>(allowedTypes);
	return object({
		includeIsolated: boolean(),
		linkTypes: array(
			pipe(
				string(),
				check((type) => validTypes.has(type), "Invalid link type"),
			),
		),
	});
}

/**
 * Persists only the local display conditions. `includeWorkIds` is a transient
 * exception (the selected Work) and is deliberately never stored.
 */
export function loadTreeFilterPreference(
	storage: TreeFilterStorage | null = browserStorage(),
	allowedTypes: readonly LinkType[] = LINK_TYPES,
): GlobalLineageFilter {
	const defaults = defaultGlobalLineageFilter(allowedTypes);
	const stored = readStoredFilter(storage, allowedTypes);
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
function readStoredFilter(
	storage: TreeFilterStorage | null,
	allowedTypes: readonly LinkType[] = LINK_TYPES,
): StoredTreeFilter | null {
	if (storage === null) return null;
	try {
		const raw = storage.getItem(TREE_FILTER_STORAGE_KEY);
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		const schema = createTreeFilterPreferenceSchema(allowedTypes);
		const result = safeParse(schema, parsed);
		return result.success ? result.output : null;
	} catch {
		return null;
	}
}

function browserStorage(): TreeFilterStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
