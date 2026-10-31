import { expect, test } from "vitest";
import {
	DEFAULT_UI_LAYOUT_PREFERENCE,
	loadUiLayoutPreference,
	saveUiLayoutPreference,
	UI_LAYOUT_PREFERENCE_STORAGE_KEY,
	UiLayoutPreferenceSchema,
	type UiLayoutPreferenceStorage,
} from "../../../src/ui/ui_layout_preference.ts";
import * as v from "valibot";

test("UiLayoutPreferenceSchema validates layout preference payloads", () => {
	const valid = { navCollapsed: true, inspectorCollapsed: false, inspectorWidth: 480 };
	expect(v.safeParse(UiLayoutPreferenceSchema, valid).success).toEqual(true);
	expect(v.safeParse(UiLayoutPreferenceSchema, { navCollapsed: "yes" }).success).toEqual(false);
});

test("UI layout preference defaults safely and persists its values", () => {
	const storage = memoryStorage();
	expect(loadUiLayoutPreference(storage)).toEqual(DEFAULT_UI_LAYOUT_PREFERENCE);
	const preference = { navCollapsed: true, inspectorCollapsed: false, inspectorWidth: 480 };
	saveUiLayoutPreference(preference, storage);
	expect(loadUiLayoutPreference(storage)).toEqual(preference);
});

test("UI layout preference clamps saved and loaded inspector widths", () => {
	const storage = memoryStorage();
	saveUiLayoutPreference(
		{ navCollapsed: false, inspectorCollapsed: true, inspectorWidth: 999 },
		storage,
	);
	expect(loadUiLayoutPreference(storage)).toEqual({
		navCollapsed: false,
		inspectorCollapsed: true,
		inspectorWidth: 560,
	});
	storage.values.set(
		UI_LAYOUT_PREFERENCE_STORAGE_KEY,
		'{"navCollapsed":true,"inspectorCollapsed":false,"inspectorWidth":10}',
	);
	expect(loadUiLayoutPreference(storage).inspectorWidth).toEqual(240);
});

test("UI layout preference falls back when stored data or storage is unavailable", () => {
	const storage = memoryStorage();
	for (const invalid of [
		"not-json",
		"{}",
		'{"navCollapsed":false,"inspectorCollapsed":true,"inspectorWidth":"320"}',
	]) {
		storage.values.set(UI_LAYOUT_PREFERENCE_STORAGE_KEY, invalid);
		expect(loadUiLayoutPreference(storage)).toEqual(DEFAULT_UI_LAYOUT_PREFERENCE);
	}
	const unavailable: UiLayoutPreferenceStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};
	expect(loadUiLayoutPreference(unavailable)).toEqual(DEFAULT_UI_LAYOUT_PREFERENCE);
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
