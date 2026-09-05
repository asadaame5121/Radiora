import { boolean, finite, type InferOutput, is, number, object, pipe, safeParse } from "valibot";

export const UI_LAYOUT_PREFERENCE_STORAGE_KEY = "radiora.uiLayoutPreference";
export const MIN_INSPECTOR_WIDTH = 240;
export const MAX_INSPECTOR_WIDTH = 560;

export const UiLayoutPreferenceSchema = object({
	navCollapsed: boolean(),
	inspectorCollapsed: boolean(),
	inspectorWidth: pipe(number(), finite()),
});

export type UiLayoutPreference = Readonly<InferOutput<typeof UiLayoutPreferenceSchema>>;

export interface UiLayoutPreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_UI_LAYOUT_PREFERENCE: UiLayoutPreference = Object.freeze({
	navCollapsed: false,
	inspectorCollapsed: false,
	inspectorWidth: 320,
});

export function isLayoutPreference(value: unknown): value is UiLayoutPreference {
	return is(UiLayoutPreferenceSchema, value);
}

export function loadUiLayoutPreference(
	storage: UiLayoutPreferenceStorage | null = browserStorage(),
): UiLayoutPreference {
	try {
		const raw = storage?.getItem(UI_LAYOUT_PREFERENCE_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_UI_LAYOUT_PREFERENCE };
		const value: unknown = JSON.parse(raw);
		const result = safeParse(UiLayoutPreferenceSchema, value);
		if (!result.success) return { ...DEFAULT_UI_LAYOUT_PREFERENCE };
		return { ...result.output, inspectorWidth: clampInspectorWidth(result.output.inspectorWidth) };
	} catch {
		return { ...DEFAULT_UI_LAYOUT_PREFERENCE };
	}
}

export function saveUiLayoutPreference(
	preference: UiLayoutPreference,
	storage: UiLayoutPreferenceStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(
			UI_LAYOUT_PREFERENCE_STORAGE_KEY,
			JSON.stringify({
				...preference,
				inspectorWidth: clampInspectorWidth(preference.inspectorWidth),
			}),
		);
		// biome-ignore lint/plugin/noSwallowedRejection: Layout persistence is optional and must not make the UI unusable.
	} catch {
		// Layout preferences are best-effort and must not make the UI unusable.
	}
}

export function clampInspectorWidth(width: number): number {
	return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, width));
}

function browserStorage(): UiLayoutPreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
