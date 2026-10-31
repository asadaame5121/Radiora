import { expect, test } from "vitest";
import type { OutlineItem } from "../../../src/domain/models.ts";
import {
	DEFAULT_RECENT_EDITED_LIMIT,
	rankRecentEditedItems,
} from "../../../src/services/recent_edited_items.ts";

function createItem(
	id: string,
	workId: string,
	updatedAt: string,
	parentId: string | null = null,
): OutlineItem {
	return {
		id,
		workId,
		parentId,
		orderKey: 10,
		text: `text-${id}`,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: "b-main" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt,
	};
}

test("rankRecentEditedItems sorts by updatedAt descending with id tiebreaker", () => {
	const items = [
		createItem("item-b", "work-b", "2026-01-01T12:00:00Z"),
		createItem("item-c", "work-c", "2026-01-02T12:00:00Z"),
		createItem("item-a", "work-a", "2026-01-02T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items });
	expect(ranked.map((i: OutlineItem) => i.id)).toEqual(["item-a", "item-c", "item-b"]);
});

test("rankRecentEditedItems excludes stashed items", () => {
	const items = [
		createItem("item-1", "work-1", "2026-01-02T12:00:00Z"),
		createItem("item-2", "work-2", "2026-01-01T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items, stashItemIds: ["item-1"] });
	expect(ranked.map((i: OutlineItem) => i.id)).toEqual(["item-2"]);
});

test("rankRecentEditedItems deduplicates items with the same workId keeping the most recent", () => {
	const items = [
		createItem("item-w1-old", "work-1", "2026-01-01T12:00:00Z"),
		createItem("item-w1-new", "work-1", "2026-01-03T12:00:00Z"),
		createItem("item-w2", "work-2", "2026-01-02T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items });
	expect(ranked.map((i: OutlineItem) => i.id)).toEqual(["item-w1-new", "item-w2"]);
});

test("rankRecentEditedItems limits results to DEFAULT_RECENT_EDITED_LIMIT or custom limit", () => {
	const items = Array.from({ length: 10 }, (_, i) =>
		createItem(`item-${i}`, `work-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
	);

	const defaultRanked = rankRecentEditedItems({ items });
	expect(defaultRanked.length).toEqual(DEFAULT_RECENT_EDITED_LIMIT);
	expect(defaultRanked[0].id).toEqual("item-9");

	const customRanked = rankRecentEditedItems({ items, limit: 3 });
	expect(customRanked.length).toEqual(3);
	expect(customRanked.map((i: OutlineItem) => i.id)).toEqual(["item-9", "item-8", "item-7"]);
});

test("rankRecentEditedItems ranks 10,000 items with duplicate Works accurately", () => {
	const items = Array.from({ length: 10000 }, (_, i) =>
		createItem(
			`item-${String(i).padStart(5, "0")}`,
			`work-${String(i % 500).padStart(3, "0")}`,
			new Date(1700000000000 + i * 1000).toISOString(),
		),
	);

	const ranked = rankRecentEditedItems({ items, limit: 6 });
	expect(ranked.length).toEqual(6);
	// The most recent items should be the last ones with unique works
	// item-09999 is work-499
	// item-09998 is work-498
	// item-09997 is work-497
	// item-09996 is work-496
	// item-09995 is work-495
	// item-09994 is work-494
	expect(ranked.map((i) => i.id)).toEqual([
		"item-09999",
		"item-09998",
		"item-09997",
		"item-09996",
		"item-09995",
		"item-09994",
	]);
});

function legacyOracle(
	items: readonly OutlineItem[],
	options: { stashItemIds?: readonly string[]; limit?: number },
): OutlineItem[] {
	let limit = options.limit ?? DEFAULT_RECENT_EDITED_LIMIT;
	if (Number.isNaN(limit) || limit <= 0) return [];
	if (!Number.isFinite(limit)) limit = Number.MAX_SAFE_INTEGER;
	limit = Math.floor(limit);

	const stashedIds = new Set(options.stashItemIds ?? []);
	const valid = items
		.map((item, inputIndex) => {
			const parsed = Date.parse(item.updatedAt);
			return { item, time: Number.isNaN(parsed) ? 0 : parsed, inputIndex };
		})
		.filter((e) => !stashedIds.has(e.item.id));

	valid.sort(
		(a, b) => b.time - a.time || a.item.id.localeCompare(b.item.id) || a.inputIndex - b.inputIndex,
	);

	const seenWorks = new Set<string>();
	const result: OutlineItem[] = [];
	for (const e of valid) {
		if (seenWorks.has(e.item.workId)) continue;
		seenWorks.add(e.item.workId);
		result.push(e.item);
		if (result.length >= limit) break;
	}
	return result;
}

test("A09 - rankRecentEditedItems exactly matches legacy oracle across complex edge cases", () => {
	// 1. 10,000 distinct Works
	const distinctItems = Array.from({ length: 10000 }, (_, i) =>
		createItem(
			`dist-${String(i).padStart(5, "0")}`,
			`w-dist-${String(i).padStart(5, "0")}`,
			new Date(1700000000000 + (i % 100) * 1000).toISOString(),
		),
	);
	const oracle1 = legacyOracle(distinctItems, { limit: 6 });
	const actual1 = rankRecentEditedItems({ items: distinctItems, limit: 6 });
	expect(actual1.map((i) => i.id)).toEqual(oracle1.map((i) => i.id));

	// 2. NFC / NFD ID ties with identical timestamps
	const tieItems = [
		createItem("e\u0301-nfd", "w1", "2026-01-01T00:00:00Z"), // é decomposed
		createItem("\u00e9-nfc", "w2", "2026-01-01T00:00:00Z"), // é precomposed
		createItem("a-tie", "w3", "2026-01-01T00:00:00Z"),
		createItem("z-tie", "w4", "2026-01-01T00:00:00Z"),
	];
	const oracle2 = legacyOracle(tieItems, { limit: 4 });
	const actual2 = rankRecentEditedItems({ items: tieItems, limit: 4 });
	expect(actual2.map((i) => i.id)).toEqual(oracle2.map((i) => i.id));

	// 3. High duplicate occurrences for same Work (1000 occurrences per Work)
	const dupItems = Array.from({ length: 3000 }, (_, i) => {
		const workId = `work-${i % 3}`;
		// Some newer, some older timestamps mixed
		const timeOffset = (i * 37) % 500;
		return createItem(
			`dup-${i}`,
			workId,
			new Date(1700000000000 + timeOffset * 1000).toISOString(),
		);
	});
	const oracle3 = legacyOracle(dupItems, { limit: 3 });
	const actual3 = rankRecentEditedItems({ items: dupItems, limit: 3 });
	expect(actual3.map((i) => i.id)).toEqual(oracle3.map((i) => i.id));

	// 4. Invalid timestamps and NaN handling
	const invalidTimeItems = [
		createItem("inv-1", "w1", "not-a-valid-date"),
		createItem("inv-2", "w2", ""),
		createItem("valid-1", "w3", "2026-01-01T00:00:00Z"),
		createItem("inv-3", "w4", "another-invalid"),
	];
	const oracle4 = legacyOracle(invalidTimeItems, { limit: 3 });
	const actual4 = rankRecentEditedItems({ items: invalidTimeItems, limit: 3 });
	expect(actual4.map((i) => i.id)).toEqual(oracle4.map((i) => i.id));

	// 5. Limit edge cases: 0, negative, float, NaN, Infinity, undefined
	const sample = [
		createItem("s1", "w1", "2026-01-03T00:00:00Z"),
		createItem("s2", "w2", "2026-01-02T00:00:00Z"),
		createItem("s3", "w3", "2026-01-01T00:00:00Z"),
	];
	for (const testLimit of [0, -5, 1.8, 2.2, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
		const oracleLimit = legacyOracle(sample, { limit: testLimit });
		const actualLimit = rankRecentEditedItems({ items: sample, limit: testLimit });
		expect(
			actualLimit.map((i) => i.id),
			`Mismatch for limit: ${testLimit}`,
		).toEqual(oracleLimit.map((i) => i.id));
	}
});

test("recent ranking preserves stable locale ties after a Work winner changes", () => {
	const items = [
		createItem("old", "w1", "2025-01-01T00:00:00Z"),
		createItem("é", "w2", "2026-01-01T00:00:00Z"),
		createItem("e\u0301", "w1", "2026-01-01T00:00:00Z"),
	];
	expect(items[1].id.localeCompare(items[2].id)).toEqual(0);
	const before = structuredClone(items);
	const actual = rankRecentEditedItems({ items, limit: 2 });
	expect(actual.map((entry) => entry.workId)).toEqual(["w2", "w1"]);
	expect(items).toEqual(before);
	expect(actual[0]).toEqual(items[1]);
});

test("recent ranking normalizes negative and sub-unit limits to an empty result", () => {
	const items = [createItem("a", "w1", "2026-01-01T00:00:00Z")];
	for (const limit of [-1, Number.NEGATIVE_INFINITY, 0.5]) {
		expect(rankRecentEditedItems({ items, limit })).toEqual([]);
	}
});
