import { assertEquals } from "jsr:@std/assert@1";
import {
	applyThemeToDocument,
	DEFAULT_THEME_PREFERENCE,
	isThemePreference,
	loadThemePreference,
	resolveTheme,
	saveThemePreference,
	THEME_PREFERENCE_STORAGE_KEY,
	type ThemePreferenceStorage,
} from "../src/ui/theme_preference.ts";

Deno.test("theme preference defaults to auto and accepts valid preferences", () => {
	assertEquals(DEFAULT_THEME_PREFERENCE, "auto");
	assertEquals(isThemePreference("auto"), true);
	assertEquals(isThemePreference("dark"), true);
	assertEquals(isThemePreference("light"), true);
	assertEquals(isThemePreference("other"), false);
	assertEquals(isThemePreference(null), false);
	assertEquals(isThemePreference(123), false);
});

Deno.test("theme preference loads from storage and falls back on invalid data", () => {
	const storage = memoryStorage();
	assertEquals(loadThemePreference(storage), "auto");

	saveThemePreference("dark", storage);
	assertEquals(loadThemePreference(storage), "dark");

	saveThemePreference("light", storage);
	assertEquals(loadThemePreference(storage), "light");

	saveThemePreference("auto", storage);
	assertEquals(loadThemePreference(storage), "auto");

	for (const invalid of ["invalid", "{}", "null", "undefined", "123"]) {
		storage.values.set(THEME_PREFERENCE_STORAGE_KEY, invalid);
		assertEquals(loadThemePreference(storage), "auto");
	}
});

Deno.test("theme preference tolerates unavailable storage gracefully", () => {
	const unavailable: ThemePreferenceStorage = {
		getItem: () => {
			throw new Error("storage disabled");
		},
		setItem: () => {
			throw new Error("storage disabled");
		},
	};
	assertEquals(loadThemePreference(unavailable), "auto");
	saveThemePreference("dark", unavailable);
});

Deno.test("resolveTheme computes effective theme considering OS preference", () => {
	assertEquals(resolveTheme("dark", false), "dark");
	assertEquals(resolveTheme("dark", true), "dark");
	assertEquals(resolveTheme("light", false), "light");
	assertEquals(resolveTheme("light", true), "light");

	assertEquals(resolveTheme("auto", true), "dark");
	assertEquals(resolveTheme("auto", false), "light");
});

Deno.test("applyThemeToDocument sets dataset and colorScheme on document element", () => {
	const doc = mockDocument();
	applyThemeToDocument("light", doc);
	assertEquals(doc.documentElement.dataset.theme, "light");
	assertEquals(doc.documentElement.style.colorScheme, "light");

	applyThemeToDocument("dark", doc);
	assertEquals(doc.documentElement.dataset.theme, "dark");
	assertEquals(doc.documentElement.style.colorScheme, "dark");

	applyThemeToDocument("auto", doc);
	assertEquals(doc.documentElement.dataset.theme, "auto");
	assertEquals(doc.documentElement.style.colorScheme, "");
});

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
			getAttribute: (name: string) => (name === "data-theme" ? dataset.theme ?? null : null),
		},
	};
	return doc as unknown as Document;
}
