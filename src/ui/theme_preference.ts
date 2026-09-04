import { type InferOutput, is, picklist, safeParse } from "valibot";

export const THEME_PREFERENCE_STORAGE_KEY = "radiora.themePreference";

export const ThemePreferenceSchema = picklist(["auto", "dark", "light"]);
export type ThemePreference = InferOutput<typeof ThemePreferenceSchema>;
export type ResolvedTheme = "dark" | "light";

export interface ThemePreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "auto";

export function isThemePreference(value: unknown): value is ThemePreference {
	return is(ThemePreferenceSchema, value);
}

export function loadThemePreference(
	storage: ThemePreferenceStorage | null = browserStorage(),
): ThemePreference {
	try {
		const raw = storage?.getItem(THEME_PREFERENCE_STORAGE_KEY);
		if (!raw) {
			return DEFAULT_THEME_PREFERENCE;
		}
		const result = safeParse(ThemePreferenceSchema, raw);
		return result.success ? result.output : DEFAULT_THEME_PREFERENCE;
	} catch {
		return DEFAULT_THEME_PREFERENCE;
	}
}

export function saveThemePreference(
	preference: ThemePreference,
	storage: ThemePreferenceStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
		// biome-ignore lint/plugin/noSwallowedRejection: Theme persistence is optional and must not crash the UI.
	} catch {
		// Theme persistence is best-effort.
	}
}

export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean,
): ResolvedTheme {
	if (preference === "dark") return "dark";
	if (preference === "light") return "light";
	return systemPrefersDark ? "dark" : "light";
}

export function applyThemeToDocument(
	preference: ThemePreference,
	doc?: Document,
): void {
	const targetDoc = doc ?? (typeof document !== "undefined" ? document : null);
	if (!targetDoc?.documentElement) return;

	targetDoc.documentElement.dataset.theme = preference;
	if (preference === "auto") {
		targetDoc.documentElement.style.colorScheme = "";
	} else {
		targetDoc.documentElement.style.colorScheme = preference;
	}
}

export function getSystemPrefersDark(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return true;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const NOOP_CLEANUP = (): void => {
	// No-op cleanup for non-browser or unsupported environments.
};

export function listenSystemThemeChange(callback: (prefersDark: boolean) => void): () => void {
	if (typeof window === "undefined" || !window.matchMedia) return NOOP_CLEANUP;
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handler = (event: MediaQueryListEvent) => {
		callback(event.matches);
	};
	mediaQuery.addEventListener("change", handler);
	return () => {
		mediaQuery.removeEventListener("change", handler);
	};
}

function browserStorage(): ThemePreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
