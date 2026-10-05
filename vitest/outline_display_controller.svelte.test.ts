import { expect, it } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import { projectBrowsingOutline } from "../src/services/browsing_navigation_state.ts";
import { OutlineDisplayController } from "../src/ui/outline_display_controller.svelte.ts";
import { EMPTY_OUTLINE_FILTER } from "../src/services/outline_filter.ts";
it("keeps live conditions independent of captured restoration values", () => {
	const display = new OutlineDisplayController();
	const ids = ["a", "a", "b"];
	display.setExpanded(ids);
	ids.push("c");
	expect(display.expanded).toEqual(["a", "b"]);
	display.clearExpansion("a");
	display.expand("b");
	expect(display.expanded).toEqual(["b"]);
	const filter = { freeText: "draft", tagsAll: "tag", tagsNone: "hidden" };
	display.setFilter(filter);
	filter.freeText = "changed";
	expect(display.filter.freeText).toBe("draft");
	display.clearFilter();
	expect(display.filter).toEqual(EMPTY_OUTLINE_FILTER);
});

function item(id: string, parentId: string | null, orderKey: number): OutlineItem {
	return {
		id,
		parentId,
		orderKey,
		workId: `work-${id}`,
		text: id,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `branch-${id}` },
		createdAt: "now",
		updatedAt: "now",
	};
}

function snapshot(): OutlineSnapshot {
	return {
		items: [
			item("other", null, 20),
			item("later", "root", 20),
			{ ...item("root", null, 10), collapsed: true },
			item("first", "root", 10),
			item("stash", null, 5),
		],
		links: [],
		knots: [],
		stashItemIds: ["stash"],
	};
}

it("projects ordered rows using live expansion without changing saved collapse", () => {
	const display = new OutlineDisplayController();
	const saved = snapshot();
	const projection = projectBrowsingOutline(saved, null);
	const rows = () => display.visibleRows(saved, projection, false);
	expect(rows().map((row) => [row.item.id, row.depth, row.hasChildren])).toEqual([
		["root", 0, true],
		["other", 0, false],
	]);
	display.expand("root");
	expect(rows().map((row) => [row.item.id, row.depth])).toEqual([
		["root", 0],
		["first", 1],
		["later", 1],
		["other", 0],
	]);
	expect(saved.items.find((value) => value.id === "root")?.collapsed).toBe(true);
	display.clearExpansion("root");
	expect(rows().map((row) => row.item.id)).toEqual(["root", "other"]);
});

it("uses the pane projection for hoist and includes stash only on request", () => {
	const display = new OutlineDisplayController();
	const saved = snapshot();
	const projection = projectBrowsingOutline(saved, "first");
	expect(display.visibleRows(saved, projection, false).map((row) => row.item.id)).toEqual([
		"first",
	]);
	expect(display.visibleRows(saved, projection, true).map((row) => [row.item.id, row.stash]))
		.toEqual([
			["first", false],
			["stash", true],
		]);
});
