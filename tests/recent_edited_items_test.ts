import { assertEquals } from "jsr:@std/assert";
import type { OutlineItem } from "../src/domain/models.ts";
import {
	DEFAULT_RECENT_EDITED_LIMIT,
	rankRecentEditedItems,
} from "../src/services/recent_edited_items.ts";

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

Deno.test("rankRecentEditedItems sorts by updatedAt descending with id tiebreaker", () => {
	const items = [
		createItem("item-b", "work-b", "2026-01-01T12:00:00Z"),
		createItem("item-c", "work-c", "2026-01-02T12:00:00Z"),
		createItem("item-a", "work-a", "2026-01-02T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items });
	assertEquals(ranked.map((i: OutlineItem) => i.id), ["item-a", "item-c", "item-b"]);
});

Deno.test("rankRecentEditedItems excludes stashed items", () => {
	const items = [
		createItem("item-1", "work-1", "2026-01-02T12:00:00Z"),
		createItem("item-2", "work-2", "2026-01-01T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items, stashItemIds: ["item-1"] });
	assertEquals(ranked.map((i: OutlineItem) => i.id), ["item-2"]);
});

Deno.test("rankRecentEditedItems deduplicates items with the same workId keeping the most recent", () => {
	const items = [
		createItem("item-w1-old", "work-1", "2026-01-01T12:00:00Z"),
		createItem("item-w1-new", "work-1", "2026-01-03T12:00:00Z"),
		createItem("item-w2", "work-2", "2026-01-02T12:00:00Z"),
	];

	const ranked = rankRecentEditedItems({ items });
	assertEquals(ranked.map((i: OutlineItem) => i.id), ["item-w1-new", "item-w2"]);
});

Deno.test("rankRecentEditedItems limits results to DEFAULT_RECENT_EDITED_LIMIT or custom limit", () => {
	const items = Array.from(
		{ length: 10 },
		(_, i) =>
			createItem(`item-${i}`, `work-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
	);

	const defaultRanked = rankRecentEditedItems({ items });
	assertEquals(defaultRanked.length, DEFAULT_RECENT_EDITED_LIMIT);
	assertEquals(defaultRanked[0].id, "item-9");

	const customRanked = rankRecentEditedItems({ items, limit: 3 });
	assertEquals(customRanked.length, 3);
	assertEquals(customRanked.map((i: OutlineItem) => i.id), ["item-9", "item-8", "item-7"]);
});
