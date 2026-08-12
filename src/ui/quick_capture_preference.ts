export type QuickCaptureDestination = "root" | "unplaced";

export const QUICK_CAPTURE_PREFERENCE_STORAGE_KEY = "radiora.quickCapturePreference";

export interface QuickCapturePreference {
	readonly destination: QuickCaptureDestination;
}

export interface QuickCapturePreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export const DEFAULT_QUICK_CAPTURE_PREFERENCE: QuickCapturePreference = Object.freeze({
	destination: "root",
});

export function loadQuickCapturePreference(
	storage: QuickCapturePreferenceStorage | null = browserStorage(),
): QuickCapturePreference {
	try {
		const raw = storage?.getItem(QUICK_CAPTURE_PREFERENCE_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
		const value: unknown = JSON.parse(raw);
		if (!isQuickCapturePreference(value)) return { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
		return { destination: value.destination };
	} catch {
		return { ...DEFAULT_QUICK_CAPTURE_PREFERENCE };
	}
}

export function saveQuickCapturePreference(
	preference: QuickCapturePreference,
	storage: QuickCapturePreferenceStorage | null = browserStorage(),
): void {
	try {
		storage?.setItem(QUICK_CAPTURE_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
		// biome-ignore lint/plugin/noSwallowedRejection: Quick-capture preferences are optional and storage failure must not block input.
	} catch {
		// Quick capture preferences are best-effort and must not block input.
	}
}

function isQuickCapturePreference(value: unknown): value is QuickCapturePreference {
	if (typeof value !== "object" || value === null) return false;
	const destination = (value as Record<string, unknown>).destination;
	return destination === "root" || destination === "unplaced";
}

function browserStorage(): QuickCapturePreferenceStorage | null {
	try {
		return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
	} catch {
		return null;
	}
}
