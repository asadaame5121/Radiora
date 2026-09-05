import { type InferOutput, picklist, safeParse } from "valibot";

export const TREE_PROJECTION_STORAGE_KEY = "radiora.treeProjection";

export const TreeProjectionSchema = picklist(["lineage", "chronology"]);
export type TreeProjection = InferOutput<typeof TreeProjectionSchema>;

export const DEFAULT_TREE_PROJECTION: TreeProjection = "chronology";

export interface TreeProjectionStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function loadTreeProjectionPreference(
	storage: TreeProjectionStorage | null = browserStorage(),
): TreeProjection {
	try {
		const stored = storage?.getItem(TREE_PROJECTION_STORAGE_KEY);
		if (!stored) return DEFAULT_TREE_PROJECTION;
		const result = safeParse(TreeProjectionSchema, stored);
		return result.success ? result.output : DEFAULT_TREE_PROJECTION;
	} catch {
		return DEFAULT_TREE_PROJECTION;
	}
}

export function saveTreeProjectionPreference(
	projection: TreeProjection,
	storage: TreeProjectionStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(TREE_PROJECTION_STORAGE_KEY, projection);
		// biome-ignore lint/plugin/noSwallowedRejection: Tree projection persistence is optional and must not make the tree unusable.
	} catch {
		// This UI preference is best-effort and must not make the tree unusable.
	}
}

function browserStorage(): TreeProjectionStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
