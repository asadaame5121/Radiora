import { expect, test } from "vitest";
import {
	DEFAULT_MARKDOWN_EXPORT_PREFERENCE,
	loadMarkdownExportPreference,
	MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY,
	MarkdownExportPreferenceSchema,
	type MarkdownExportPreferenceStorage,
	MarkdownExportReferenceModeSchema,
	MarkdownExportScopeSchema,
	saveMarkdownExportPreference,
} from "../../../src/ui/markdown_export_preference.ts";
import * as v from "valibot";

test("MarkdownExportPreferenceSchema validates preference payloads", () => {
	const valid = {
		scope: "all",
		referenceMode: "radiora",
		includeAncestors: true,
		includeDescendants: true,
		includeSemanticNeighbors: false,
	};
	expect(v.safeParse(MarkdownExportPreferenceSchema, valid).success).toEqual(true);
	expect(v.safeParse(MarkdownExportScopeSchema, "invalid").success).toEqual(false);
	expect(v.safeParse(MarkdownExportReferenceModeSchema, "invalid").success).toEqual(false);
});

test("Markdown export preference defaults to the full outline", () => {
	expect(loadMarkdownExportPreference(memoryStorage())).toEqual(DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
});

test("Markdown export preference saves and loads independent advanced options", () => {
	const storage = memoryStorage();
	const preference = {
		scope: "selected" as const,
		referenceMode: "obsidian" as const,
		includeAncestors: false,
		includeDescendants: true,
		includeSemanticNeighbors: true,
	};
	saveMarkdownExportPreference(preference, storage);
	expect(loadMarkdownExportPreference(storage)).toEqual(preference);
});

test("Markdown export preference supplements legacy values with the Radiora reference mode", () => {
	const storage = memoryStorage();
	storage.values.set(
		MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY,
		'{"scope":"selected","includeAncestors":false,"includeDescendants":true,"includeSemanticNeighbors":true}',
	);
	expect(loadMarkdownExportPreference(storage)).toEqual({
		scope: "selected",
		referenceMode: "radiora",
		includeAncestors: false,
		includeDescendants: true,
		includeSemanticNeighbors: true,
	});
});

test("Markdown export preference falls back safely for invalid values", () => {
	const storage = memoryStorage();
	for (const invalid of [
		"not-json",
		"{}",
		'{"scope":"selected"}',
		'{"scope":"unknown"}',
		'{"scope":"all","referenceMode":"unknown","includeAncestors":true,"includeDescendants":true,"includeSemanticNeighbors":false}',
	]) {
		storage.values.set(MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY, invalid);
		expect(loadMarkdownExportPreference(storage)).toEqual(DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
	}
});

test("Markdown export preference tolerates unavailable storage", () => {
	const unavailable: MarkdownExportPreferenceStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};
	expect(loadMarkdownExportPreference(unavailable)).toEqual(DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
	saveMarkdownExportPreference(DEFAULT_MARKDOWN_EXPORT_PREFERENCE, unavailable);
});

function memoryStorage(): MarkdownExportPreferenceStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}
