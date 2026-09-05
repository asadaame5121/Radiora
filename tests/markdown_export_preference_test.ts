import { assertEquals } from "jsr:@std/assert@1";
import {
	DEFAULT_MARKDOWN_EXPORT_PREFERENCE,
	loadMarkdownExportPreference,
	MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY,
	MarkdownExportPreferenceSchema,
	type MarkdownExportPreferenceStorage,
	MarkdownExportReferenceModeSchema,
	MarkdownExportScopeSchema,
	saveMarkdownExportPreference,
} from "../src/ui/markdown_export_preference.ts";
import * as v from "valibot";

Deno.test("MarkdownExportPreferenceSchema validates preference payloads", () => {
	const valid = {
		scope: "all",
		referenceMode: "radiora",
		includeAncestors: true,
		includeDescendants: true,
		includeSemanticNeighbors: false,
	};
	assertEquals(v.safeParse(MarkdownExportPreferenceSchema, valid).success, true);
	assertEquals(v.safeParse(MarkdownExportScopeSchema, "invalid").success, false);
	assertEquals(v.safeParse(MarkdownExportReferenceModeSchema, "invalid").success, false);
});

Deno.test("Markdown export preference defaults to the full outline", () => {
	assertEquals(loadMarkdownExportPreference(memoryStorage()), DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
});

Deno.test("Markdown export preference saves and loads independent advanced options", () => {
	const storage = memoryStorage();
	const preference = {
		scope: "selected" as const,
		referenceMode: "obsidian" as const,
		includeAncestors: false,
		includeDescendants: true,
		includeSemanticNeighbors: true,
	};
	saveMarkdownExportPreference(preference, storage);
	assertEquals(loadMarkdownExportPreference(storage), preference);
});

Deno.test("Markdown export preference supplements legacy values with the Radiora reference mode", () => {
	const storage = memoryStorage();
	storage.values.set(
		MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY,
		'{"scope":"selected","includeAncestors":false,"includeDescendants":true,"includeSemanticNeighbors":true}',
	);
	assertEquals(loadMarkdownExportPreference(storage), {
		scope: "selected",
		referenceMode: "radiora",
		includeAncestors: false,
		includeDescendants: true,
		includeSemanticNeighbors: true,
	});
});

Deno.test("Markdown export preference falls back safely for invalid values", () => {
	const storage = memoryStorage();
	for (
		const invalid of [
			"not-json",
			"{}",
			'{"scope":"selected"}',
			'{"scope":"unknown"}',
			'{"scope":"all","referenceMode":"unknown","includeAncestors":true,"includeDescendants":true,"includeSemanticNeighbors":false}',
		]
	) {
		storage.values.set(MARKDOWN_EXPORT_PREFERENCE_STORAGE_KEY, invalid);
		assertEquals(loadMarkdownExportPreference(storage), DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
	}
});

Deno.test("Markdown export preference tolerates unavailable storage", () => {
	const unavailable: MarkdownExportPreferenceStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};
	assertEquals(loadMarkdownExportPreference(unavailable), DEFAULT_MARKDOWN_EXPORT_PREFERENCE);
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
