import { assertEquals } from "jsr:@std/assert@1";
import {
	DEFAULT_UI_LAYOUT_PREFERENCE,
	loadUiLayoutPreference,
	saveUiLayoutPreference,
	UI_LAYOUT_PREFERENCE_STORAGE_KEY,
	type UiLayoutPreferenceStorage,
} from "../src/ui/ui_layout_preference.ts";

Deno.test("UI layout preference defaults safely and persists its values", () => {
	const storage = memoryStorage();
	assertEquals(loadUiLayoutPreference(storage), DEFAULT_UI_LAYOUT_PREFERENCE);
	const preference = { navCollapsed: true, inspectorCollapsed: false, inspectorWidth: 480 };
	saveUiLayoutPreference(preference, storage);
	assertEquals(loadUiLayoutPreference(storage), preference);
});

Deno.test("UI layout preference clamps saved and loaded inspector widths", () => {
	const storage = memoryStorage();
	saveUiLayoutPreference(
		{ navCollapsed: false, inspectorCollapsed: true, inspectorWidth: 999 },
		storage,
	);
	assertEquals(loadUiLayoutPreference(storage), {
		navCollapsed: false,
		inspectorCollapsed: true,
		inspectorWidth: 560,
	});
	storage.values.set(
		UI_LAYOUT_PREFERENCE_STORAGE_KEY,
		'{"navCollapsed":true,"inspectorCollapsed":false,"inspectorWidth":10}',
	);
	assertEquals(loadUiLayoutPreference(storage).inspectorWidth, 240);
});

Deno.test("UI layout preference falls back when stored data or storage is unavailable", () => {
	const storage = memoryStorage();
	for (
		const invalid of [
			"not-json",
			"{}",
			'{"navCollapsed":false,"inspectorCollapsed":true,"inspectorWidth":"320"}',
		]
	) {
		storage.values.set(UI_LAYOUT_PREFERENCE_STORAGE_KEY, invalid);
		assertEquals(loadUiLayoutPreference(storage), DEFAULT_UI_LAYOUT_PREFERENCE);
	}
	const unavailable: UiLayoutPreferenceStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};
	assertEquals(loadUiLayoutPreference(unavailable), DEFAULT_UI_LAYOUT_PREFERENCE);
	saveUiLayoutPreference(DEFAULT_UI_LAYOUT_PREFERENCE, unavailable);
});

function memoryStorage(): UiLayoutPreferenceStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}
