import { expect, test } from "vitest";
import {
	DEFAULT_QUICK_CAPTURE_PREFERENCE,
	loadQuickCapturePreference,
	saveQuickCapturePreference,
} from "../../../src/ui/quick_capture_preference.ts";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

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

test("quick capture defaults to the root outline", () => {
	expect(loadQuickCapturePreference(memoryStorage())).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);
});

test("quick capture preference persists the unplaced destination", () => {
	const storage = memoryStorage();
	saveQuickCapturePreference({ destination: "unplaced" }, storage);
	expect(loadQuickCapturePreference(storage)).toEqual({ destination: "unplaced" });
});

test("invalid quick capture preference falls back to the root outline", () => {
	const storage = memoryStorage({
		"radiora.quickCapturePreference": JSON.stringify({ destination: "unknown" }),
	});
	expect(loadQuickCapturePreference(storage)).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);
});

test("quick capture preference tolerates unavailable storage gracefully", () => {
	const throwingStorage = {
		getItem: () => {
			throw new Error("Storage blocked");
		},
		setItem: () => {
			throw new Error("Storage blocked");
		},
	};

	// null storage
	expect(loadQuickCapturePreference(null)).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);
	saveQuickCapturePreference({ destination: "unplaced" }, null);

	// throwing storage
	expect(loadQuickCapturePreference(throwingStorage)).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);
	saveQuickCapturePreference({ destination: "unplaced" }, throwingStorage);

	// corrupted JSON
	const corruptedStorage = memoryStorage({
		"radiora.quickCapturePreference": "invalid-json{",
	});
	expect(loadQuickCapturePreference(corruptedStorage)).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);

	// default browserStorage fallback with hermetic stub
	const stub = createFakeLocalStorage();
	withStubbedLocalStorage(stub, () => {
		expect(loadQuickCapturePreference()).toEqual(DEFAULT_QUICK_CAPTURE_PREFERENCE);
		saveQuickCapturePreference({ destination: "unplaced" });
		expect(loadQuickCapturePreference()).toEqual({ destination: "unplaced" });
	});
});
