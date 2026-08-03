export const UI_LAYOUT_PREFERENCE_STORAGE_KEY = "radiora.uiLayoutPreference";
export const MIN_INSPECTOR_WIDTH = 240;
export const MAX_INSPECTOR_WIDTH = 560;

export interface UiLayoutPreference {
	readonly navCollapsed: boolean;
	readonly inspectorCollapsed: boolean;
	readonly inspectorWidth: number;
}

export interface UiLayoutPreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_UI_LAYOUT_PREFERENCE: UiLayoutPreference = Object.freeze({
	navCollapsed: false,
	inspectorCollapsed: false,
	inspectorWidth: 320,
});

export function loadUiLayoutPreference(
	storage: UiLayoutPreferenceStorage | null = browserStorage(),
): UiLayoutPreference {
	try {
		const raw = storage?.getItem(UI_LAYOUT_PREFERENCE_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_UI_LAYOUT_PREFERENCE };
		const value: unknown = JSON.parse(raw);
		if (!isLayoutPreference(value)) return { ...DEFAULT_UI_LAYOUT_PREFERENCE };
		return { ...value, inspectorWidth: clampInspectorWidth(value.inspectorWidth) };
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
	} catch {
		// Layout preferences are best-effort and must not make the UI unusable.
	}
}

export function clampInspectorWidth(width: number): number {
	return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, width));
}

function isLayoutPreference(value: unknown): value is UiLayoutPreference {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.navCollapsed === "boolean" &&
		typeof candidate.inspectorCollapsed === "boolean" &&
		typeof candidate.inspectorWidth === "number" &&
		Number.isFinite(candidate.inspectorWidth);
}

function browserStorage(): UiLayoutPreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
