import { expect, test } from "vitest";
import {
	loadTreeProjectionPreference,
	saveTreeProjectionPreference,
	TREE_PROJECTION_STORAGE_KEY,
	TreeProjectionSchema,
	type TreeProjectionStorage,
} from "../../../src/ui/tree_projection_preference.ts";
import * as v from "valibot";

test("TreeProjectionSchema validates tree projection picklist", () => {
	expect(v.safeParse(TreeProjectionSchema, "lineage").success).toEqual(true);
	expect(v.safeParse(TreeProjectionSchema, "chronology").success).toEqual(true);
	expect(v.safeParse(TreeProjectionSchema, "unknown").success).toEqual(false);
});

test("tree projection preference defaults to chronology and accepts known values", () => {
	const storage = memoryStorage();
	expect(loadTreeProjectionPreference(storage)).toEqual("chronology");

	storage.values.set(TREE_PROJECTION_STORAGE_KEY, "lineage");
	expect(loadTreeProjectionPreference(storage)).toEqual("lineage");

	storage.values.set(TREE_PROJECTION_STORAGE_KEY, "unsupported");
	expect(loadTreeProjectionPreference(storage)).toEqual("chronology");
});

test("tree projection preference saves the selected projection", () => {
	const storage = memoryStorage();
	saveTreeProjectionPreference("lineage", storage);
	expect(storage.values.get(TREE_PROJECTION_STORAGE_KEY)).toEqual("lineage");
});

test("tree projection preference tolerates unavailable storage", () => {
	const unavailable: TreeProjectionStorage = {
		getItem: () => {
			throw new Error("unavailable");
		},
		setItem: () => {
			throw new Error("unavailable");
		},
	};

	expect(loadTreeProjectionPreference(unavailable)).toEqual("chronology");
	saveTreeProjectionPreference("lineage", unavailable);

	// null storage
	expect(loadTreeProjectionPreference(null)).toEqual("chronology");
	saveTreeProjectionPreference("lineage", null);

	// default browserStorage fallback with hermetic stub
	const stub = createFakeLocalStorage();
	withStubbedLocalStorage(stub, () => {
		expect(loadTreeProjectionPreference()).toEqual("chronology");
		saveTreeProjectionPreference("lineage");
		expect(loadTreeProjectionPreference()).toEqual("lineage");
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

test("failed projection persistence retains the last saved value for restart", () => {
	const storage = memoryStorage();
	saveTreeProjectionPreference("lineage", storage);
	const readOnly: TreeProjectionStorage = {
		getItem: storage.getItem,
		setItem: () => {
			throw new Error("storage is read-only");
		},
	};
	saveTreeProjectionPreference("chronology", readOnly);
	expect(loadTreeProjectionPreference(readOnly)).toEqual("lineage");
});
