import { expect, test } from "vitest";
import { LINK_TYPES } from "../../../../src/domain/models.ts";
import { defaultGlobalLineageFilter } from "../../../../src/services/global_lineage_filter.ts";
import {
	createTreeFilterPreferenceSchema,
	loadTreeFilterPreference,
	saveTreeFilterPreference,
	StoredTreeFilterSchema,
	TREE_FILTER_STORAGE_KEY,
	type TreeFilterStorage,
} from "../../../../src/ui/tree_filter_preference.ts";
import * as v from "valibot";

test("StoredTreeFilterSchema and createTreeFilterPreferenceSchema validate filter structures", () => {
	const valid = { includeIsolated: true, linkTypes: ["FROM", "VS"] };
	expect(v.safeParse(StoredTreeFilterSchema, valid).success).toEqual(true);
	const dynamicSchema = createTreeFilterPreferenceSchema(["FROM", "VS"]);
	expect(v.safeParse(dynamicSchema, valid).success).toEqual(true);
	expect(
		v.safeParse(dynamicSchema, { includeIsolated: true, linkTypes: ["INVALID"] }).success,
	).toEqual(false);
});

class MemoryStorage implements TreeFilterStorage {
	readonly map = new Map<string, string>();
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.map.set(key, value);
	}
}

test("tree filter preference round-trips includeIsolated and linkTypes only", () => {
	const storage = new MemoryStorage();
	const filter = {
		includeIsolated: false,
		linkTypes: ["FROM", "VS"] as const,
		includeWorkIds: ["selected-work"],
	};

	saveTreeFilterPreference(filter, storage);
	expect(loadTreeFilterPreference(storage)).toEqual({
		includeIsolated: false,
		linkTypes: ["FROM", "VS"],
		includeWorkIds: [],
	});
	const stored = storage.map.get(TREE_FILTER_STORAGE_KEY);
	if (stored === undefined) throw new Error("expected stored tree filter preference");
	expect(JSON.parse(stored)).toEqual({
		includeIsolated: false,
		linkTypes: ["FROM", "VS"],
	});
});

test("an empty storage returns the defaults with every link type enabled", () => {
	const loaded = loadTreeFilterPreference(new MemoryStorage());
	expect(loaded.includeIsolated).toEqual(true);
	expect([...loaded.linkTypes]).toEqual([...LINK_TYPES]);
	expect(loaded.includeWorkIds).toEqual([]);
});

test("invalid stored settings fall back to the defaults", () => {
	const cases: Array<string | null> = [
		"not json",
		JSON.stringify({ includeIsolated: "yes", linkTypes: ["FROM"] }),
		JSON.stringify({ includeIsolated: true }),
		JSON.stringify({ includeIsolated: true, linkTypes: ["NONSENSE"] }),
		JSON.stringify({ includeIsolated: false, linkTypes: ["FROM", 42] }),
		JSON.stringify([]),
	];
	for (const raw of cases) {
		const storage = new MemoryStorage();
		if (raw !== null) storage.setItem(TREE_FILTER_STORAGE_KEY, raw);
		const loaded = loadTreeFilterPreference(storage);
		expect(loaded.includeIsolated).toEqual(true);
		expect([...loaded.linkTypes]).toEqual([...LINK_TYPES]);
	}
});

test("save and load tolerate an unavailable storage", () => {
	saveTreeFilterPreference(
		{ includeIsolated: false, linkTypes: ["FROM"], includeWorkIds: [] },
		null,
	);
	const loaded = loadTreeFilterPreference(null);
	expect(loaded.includeIsolated).toEqual(true);
	expect([...loaded.linkTypes]).toEqual([...LINK_TYPES]);
});

test("loadTreeFilterPreference loads custom allowed link types and falls back on unallowed types", () => {
	const customAllowed = [...LINK_TYPES, "CAUSES"] as const;
	const storage = new MemoryStorage();
	storage.setItem(
		TREE_FILTER_STORAGE_KEY,
		JSON.stringify({ includeIsolated: false, linkTypes: ["CAUSES"] }),
	);

	const loadedCustom = loadTreeFilterPreference(storage, customAllowed);
	expect(loadedCustom).toEqual({
		includeIsolated: false,
		linkTypes: ["CAUSES"],
		includeWorkIds: [],
	});

	const loadedDefault = loadTreeFilterPreference(storage);
	expect(loadedDefault).toEqual(defaultGlobalLineageFilter());
});
