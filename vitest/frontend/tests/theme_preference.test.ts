import { expect, test } from "vitest";
import {
	applyThemeToDocument,
	DEFAULT_THEME_PREFERENCE,
	getSystemPrefersDark,
	isThemePreference,
	listenSystemThemeChange,
	loadThemePreference,
	resolveTheme,
	saveThemePreference,
	THEME_PREFERENCE_STORAGE_KEY,
	ThemePreferenceSchema,
	type ThemePreferenceStorage,
} from "../../../src/ui/theme_preference.ts";
import * as v from "valibot";

test("ThemePreferenceSchema validates theme preference picklist", () => {
	expect(v.safeParse(ThemePreferenceSchema, "auto").success).toEqual(true);
	expect(v.safeParse(ThemePreferenceSchema, "dark").success).toEqual(true);
	expect(v.safeParse(ThemePreferenceSchema, "light").success).toEqual(true);
	expect(v.safeParse(ThemePreferenceSchema, "solarized").success).toEqual(false);
	expect(v.safeParse(ThemePreferenceSchema, 123).success).toEqual(false);
});

test("theme preference defaults to auto and accepts valid preferences", () => {
	expect(DEFAULT_THEME_PREFERENCE).toEqual("auto");
	expect(isThemePreference("auto")).toEqual(true);
	expect(isThemePreference("dark")).toEqual(true);
	expect(isThemePreference("light")).toEqual(true);
	expect(isThemePreference("other")).toEqual(false);
	expect(isThemePreference(null)).toEqual(false);
	expect(isThemePreference(123)).toEqual(false);
});

test("theme preference loads from storage and falls back on invalid data", () => {
	const storage = memoryStorage();
	expect(loadThemePreference(storage)).toEqual("auto");

	saveThemePreference("dark", storage);
	expect(loadThemePreference(storage)).toEqual("dark");

	saveThemePreference("light", storage);
	expect(loadThemePreference(storage)).toEqual("light");

	saveThemePreference("auto", storage);
	expect(loadThemePreference(storage)).toEqual("auto");

	for (const invalid of ["invalid", "{}", "null", "undefined", "123"]) {
		storage.values.set(THEME_PREFERENCE_STORAGE_KEY, invalid);
		expect(loadThemePreference(storage)).toEqual("auto");
	}
});

test("theme preference tolerates unavailable storage gracefully", () => {
	const unavailable: ThemePreferenceStorage = {
		getItem: () => {
			throw new Error("storage disabled");
		},
		setItem: () => {
			throw new Error("storage disabled");
		},
	};
	expect(loadThemePreference(unavailable)).toEqual("auto");
	saveThemePreference("dark", unavailable);

	// null storage
	expect(loadThemePreference(null)).toEqual("auto");
	saveThemePreference("dark", null);

	// default browserStorage fallback with hermetic stub
	const stub = createFakeLocalStorage();
	withStubbedLocalStorage(stub, () => {
		expect(loadThemePreference()).toEqual("auto");
		saveThemePreference("dark");
		expect(loadThemePreference()).toEqual("dark");
	});
});

test("getSystemPrefersDark and listenSystemThemeChange tolerate non-browser environment", () => {
	expect(typeof getSystemPrefersDark()).toEqual("boolean");
	const cleanup = listenSystemThemeChange(() => {
		// intentional no-op
	});
	expect(typeof cleanup).toEqual("function");
	cleanup();
});

test("resolveTheme computes effective theme considering OS preference", () => {
	expect(resolveTheme("dark", false)).toEqual("dark");
	expect(resolveTheme("dark", true)).toEqual("dark");
	expect(resolveTheme("light", false)).toEqual("light");
	expect(resolveTheme("light", true)).toEqual("light");

	expect(resolveTheme("auto", true)).toEqual("dark");
	expect(resolveTheme("auto", false)).toEqual("light");
});

test("applyThemeToDocument sets dataset and colorScheme on document element", () => {
	const doc = mockDocument();
	applyThemeToDocument("light", doc);
	expect(doc.documentElement.dataset.theme).toEqual("light");
	expect(doc.documentElement.style.colorScheme).toEqual("light");

	applyThemeToDocument("dark", doc);
	expect(doc.documentElement.dataset.theme).toEqual("dark");
	expect(doc.documentElement.style.colorScheme).toEqual("dark");

	applyThemeToDocument("auto", doc);
	expect(doc.documentElement.dataset.theme).toEqual("auto");
	expect(doc.documentElement.style.colorScheme).toEqual("");
});

function withStubbedLocalStorage<T>(stub: Storage, fn: () => T): T {
	const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	try {
		Object.defineProperty(globalThis, "localStorage", {
			value: stub,
			configurable: true,
			writable: true,
		});
		return fn();
	} finally {
		if (original) {
			Object.defineProperty(globalThis, "localStorage", original);
		} else {
			// @ts-expect-error cleanup undefined
			delete globalThis.localStorage;
		}
	}
}

function createFakeLocalStorage(initial: Record<string, string> = {}): Storage {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
		key: (index: number) => Array.from(values.keys())[index] ?? null,
		get length() {
			return values.size;
		},
	};
}

function memoryStorage(): ThemePreferenceStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

function mockDocument(): Document {
	const dataset: Record<string, string> = {};
	const style = { colorScheme: "" };
	const doc = {
		documentElement: {
			dataset,
			style,
			setAttribute: (name: string, value: string) => {
				if (name === "data-theme") dataset.theme = value;
			},
			getAttribute: (name: string) => (name === "data-theme" ? (dataset.theme ?? null) : null),
		},
	};
	return doc as Document;
}
