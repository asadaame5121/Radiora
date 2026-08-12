import type {
	MarkdownExportReferenceMode,
	MarkdownExportScope,
} from "../services/markdown_export.ts";

export const MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY = "radiora.markdownExportPreference";

export interface MarkdownExportPreference {
	readonly scope: MarkdownExportScope;
	readonly referenceMode: MarkdownExportReferenceMode;
	readonly includeAncestors: boolean;
	readonly includeDescendants: boolean;
	readonly includeSemanticNeighbors: boolean;
}

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
		if (!hasValidExportSettings(value)) return { ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE };
		if (value.referenceMode !== undefined && !isReferenceMode(value.referenceMode)) {
			return { ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE };
		}
		return {
			...DEFAULT_MARKDOWN_EXPORT_PREFERENCE,
			...value,
			referenceMode: value.referenceMode ?? DEFAULT_MARKDOWN_EXPORT_PREFERENCE.referenceMode,
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

function hasValidExportSettings(
	value: unknown,
): value is Omit<MarkdownExportPreference, "referenceMode"> & { referenceMode?: unknown } {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (candidate.scope === "all" || candidate.scope === "selected") &&
		typeof candidate.includeAncestors === "boolean" &&
		typeof candidate.includeDescendants === "boolean" &&
		typeof candidate.includeSemanticNeighbors === "boolean";
}

function isReferenceMode(value: unknown): value is MarkdownExportReferenceMode {
	return value === "radiora" || value === "portable" || value === "obsidian";
}

function browserStorage(): MarkdownExportPreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
