import { assertEquals } from "jsr:@std/assert@1";
import {
	DEFAULT_QUICK_CAPTURE_PREFERENCE,
	loadQuickCapturePreference,
	saveQuickCapturePreference,
} from "../src/ui/quick_capture_preference.ts";

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
}

Deno.test("quick capture defaults to the root outline", () => {
	assertEquals(loadQuickCapturePreference(memoryStorage()), DEFAULT_QUICK_CAPTURE_PREFERENCE);
});

Deno.test("quick capture preference persists the unplaced destination", () => {
	const storage = memoryStorage();
	saveQuickCapturePreference({ destination: "unplaced" }, storage);
	assertEquals(loadQuickCapturePreference(storage), { destination: "unplaced" });
});

Deno.test("invalid quick capture preference falls back to the root outline", () => {
	const storage = memoryStorage({
		"radiora.quickCapturePreference": JSON.stringify({ destination: "unknown" }),
	});
	assertEquals(loadQuickCapturePreference(storage), DEFAULT_QUICK_CAPTURE_PREFERENCE);
});
