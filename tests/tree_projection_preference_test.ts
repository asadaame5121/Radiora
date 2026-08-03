import { assertEquals } from "jsr:@std/assert@1";
import {
	loadTreeProjectionPreference,
	saveTreeProjectionPreference,
	TREE_PROJECTION_STORAGE_KEY,
	type TreeProjectionStorage,
} from "../src/ui/tree_projection_preference.ts";

Deno.test("tree projection preference defaults to chronology and accepts known values", () => {
	const storage = memoryStorage();
	assertEquals(loadTreeProjectionPreference(storage), "chronology");

	storage.values.set(TREE_PROJECTION_STORAGE_KEY, "lineage");
	assertEquals(loadTreeProjectionPreference(storage), "lineage");

	storage.values.set(TREE_PROJECTION_STORAGE_KEY, "unsupported");
	assertEquals(loadTreeProjectionPreference(storage), "chronology");
});

Deno.test("tree projection preference saves the selected projection", () => {
	const storage = memoryStorage();
	saveTreeProjectionPreference("lineage", storage);
	assertEquals(storage.values.get(TREE_PROJECTION_STORAGE_KEY), "lineage");
});

Deno.test("tree projection preference tolerates unavailable storage", () => {
	const unavailable: TreeProjectionStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};

	assertEquals(loadTreeProjectionPreference(unavailable), "chronology");
	saveTreeProjectionPreference("lineage", unavailable);
});

function memoryStorage(): TreeProjectionStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}
