import { boolean, type InferOutput, object, optional, picklist, safeParse } from "valibot";

export const MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY = "radiora.markdownExportPreference";

export const MarkdownExportScopeSchema = picklist(["all", "selected"]);
export const MarkdownExportReferenceModeSchema = picklist(["radiora", "portable", "obsidian"]);

export const MarkdownExportPreferenceSchema = object({
	scope: MarkdownExportScopeSchema,
	referenceMode: MarkdownExportReferenceModeSchema,
	includeAncestors: boolean(),
	includeDescendants: boolean(),
	includeSemanticNeighbors: boolean(),
});

export type MarkdownExportPreference = Readonly<InferOutput<typeof MarkdownExportPreferenceSchema>>;

const StoredMarkdownExportPreferenceSchema = object({
	scope: MarkdownExportScopeSchema,
	referenceMode: optional(MarkdownExportReferenceModeSchema),
	includeAncestors: boolean(),
	includeDescendants: boolean(),
	includeSemanticNeighbors: boolean(),
});

export interface MarkdownExportPreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_MARKDOWN_EXPORT_PREFERENCE: MarkdownExportPreference = Object.freeze({
	scope: "all",
	referenceMode: "radiora",
	includeAncestors: true,
	includeDescendants: true,
	includeSemanticNeighbors: false,
});

export function loadMarkdownExportPreference(
	storage: MarkdownExportPreferenceStorage | null = browserStorage(),
): MarkdownExportPreference {
	try {
		const raw = storage?.getItem(MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE };
		const value: unknown = JSON.parse(raw);
		const result = safeParse(StoredMarkdownExportPreferenceSchema, value);
		if (!result.success) return { ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE };
		return {
			...result.output,
			referenceMode: result.output.referenceMode ??
				DEFAULT_MARKDOWN_EXPORT_PREFERENCE.referenceMode,
		};
	} catch {
		return { ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE };
	}
}

export function saveMarkdownExportPreference(
	preference: MarkdownExportPreference,
	storage: MarkdownExportPreferenceStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
		// biome-ignore lint/plugin/noSwallowedRejection: Export preferences are optional and storage failure must not block an export.
	} catch {
		// Export preferences are best-effort and must never prevent an export.
	}
}

function browserStorage(): MarkdownExportPreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
