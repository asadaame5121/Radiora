import { assertEquals } from "jsr:@std/assert@1";
import {
	loadTreeProjectionPreference,
	saveTreeProjectionPreference,
	TREE_PROJECTION_STORAGE_KEY,
	TreeProjectionSchema,
	type TreeProjectionStorage,
} from "../src/ui/tree_projection_preference.ts";
import * as v from "valibot";

Deno.test("TreeProjectionSchema validates tree projection picklist", () => {
	assertEquals(v.safeParse(TreeProjectionSchema, "lineage").success, true);
	assertEquals(v.safeParse(TreeProjectionSchema, "chronology").success, true);
	assertEquals(v.safeParse(TreeProjectionSchema, "unknown").success, false);
});

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

	// null storage
	assertEquals(loadTreeProjectionPreference(null), "chronology");
	saveTreeProjectionPreference("lineage", null);

	// default browserStorage fallback with hermetic stub
	const stub = createFakeLocalStorage();
	withStubbedLocalStorage(stub, () => {
		assertEquals(loadTreeProjectionPreference(), "chronology");
		saveTreeProjectionPreference("lineage");
		assertEquals(loadTreeProjectionPreference(), "lineage");
	});
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

function memoryStorage(): TreeProjectionStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}
