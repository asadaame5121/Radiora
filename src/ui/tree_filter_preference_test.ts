// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import { LINK_TYPES } from "../domain/models.ts";
import {
	loadTreeFilterPreference,
	saveTreeFilterPreference,
	TREE_FILTER_STORAGE_KEY,
	type TreeFilterStorage,
} from "./tree_filter_preference.ts";

class MemoryStorage implements TreeFilterStorage {
	readonly map = new Map<string, string>();
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

Deno.test("tree filter preference round-trips includeIsolated and linkTypes only", () => {
	const storage = new MemoryStorage();
	const filter = {
		includeIsolated: false,
		linkTypes: ["FROM", "VS"] as const,
		includeWorkIds: ["selected-work"],
	};

	saveTreeFilterPreference(filter, storage);
	assertEquals(
		loadTreeFilterPreference(storage),
		{ includeIsolated: false, linkTypes: ["FROM", "VS"], includeWorkIds: [] },
	);
	assertEquals(
		JSON.parse(storage.map.get(TREE_FILTER_STORAGE_KEY)!),
		{ includeIsolated: false, linkTypes: ["FROM", "VS"] },
	);
});

Deno.test("tree filter preference preserves user-defined relation names", () => {
	const storage = new MemoryStorage();
	saveTreeFilterPreference(
		{ includeIsolated: true, linkTypes: ["FROM", "CAUSES_2"], includeWorkIds: [] },
		storage,
	);
	assertEquals(loadTreeFilterPreference(storage).linkTypes, ["FROM", "CAUSES_2"]);
});

Deno.test("an empty storage returns the defaults with every link type enabled", () => {
	const loaded = loadTreeFilterPreference(new MemoryStorage());
	assertEquals(loaded.includeIsolated, true);
	assertEquals([...loaded.linkTypes], [...LINK_TYPES]);
	assertEquals(loaded.includeWorkIds, []);
});

Deno.test("invalid stored settings fall back to the defaults", () => {
	const cases: Array<string | null> = [
		"not json",
		JSON.stringify({ includeIsolated: "yes", linkTypes: ["FROM"] }),
		JSON.stringify({ includeIsolated: true }),
		JSON.stringify({ includeIsolated: true, linkTypes: ["not-valid!"] }),
		JSON.stringify({ includeIsolated: false, linkTypes: ["FROM", 42] }),
		JSON.stringify([]),
	];
	for (const raw of cases) {
		const storage = new MemoryStorage();
		if (raw !== null) storage.setItem(TREE_FILTER_STORAGE_KEY, raw);
		const loaded = loadTreeFilterPreference(storage);
		assertEquals(loaded.includeIsolated, true);
		assertEquals([...loaded.linkTypes], [...LINK_TYPES]);
	}
});

Deno.test("save and load tolerate an unavailable storage", () => {
	saveTreeFilterPreference(
		{ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: [] },
		null,
	);
	const loaded = loadTreeFilterPreference(null);
	assertEquals(loaded.includeIsolated, true);
	assertEquals([...loaded.linkTypes], [...LINK_TYPES]);
});
