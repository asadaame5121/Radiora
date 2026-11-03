import { expect, test } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../../../../src/domain/models.ts";
import type { BrowsingOutlineProjection } from "../../../../src/services/browsing_navigation_state.ts";
import { buildVisibleRows } from "../../../../src/ui/outline_view_model.ts";

test("outline view model orders roots and children by orderKey", () => {
	const snapshot = outline([
		item("root-later", null, 20),
		item("child-later", "root-first", 11),
		item("root-first", null, 10),
		item("child-first", "root-first", 1),
	]);

	expect(rows(snapshot).map(rowSummary)).toEqual([
		["root-first", 0, true, false],
		["child-first", 1, false, false],
		["child-later", 1, false, false],
		["root-later", 0, false, false],
	]);
});

test("outline view model inserts an appended root after its preceding sibling without mutating inputs", () => {
	const orderStep = 1024;
	const snapshot = outline(
		["A", "B", "C", "D"].map((id, index) => item(id, null, (index + 1) * orderStep)),
	);
	const insertedOrder = (snapshot.items[1].orderKey + snapshot.items[2].orderKey) / 2;
	snapshot.items.push(item("new", null, insertedOrder));
	const projection = project(snapshot);
	const beforeSnapshot = structuredClone(snapshot);
	const beforeProjection = structuredClone(projection);

	expect(rows(snapshot, { projection }).map((row) => row.item.id)).toEqual([
		"A",
		"B",
		"new",
		"C",
		"D",
	]);
	expect(snapshot).toEqual(beforeSnapshot);
	expect(projection).toEqual(beforeProjection);
});

test("outline view model hides descendants of collapsed items", () => {
	const snapshot = outline([item("root", null, 1, { collapsed: true }), item("child", "root", 2)]);

	expect(rows(snapshot).map((row) => row.item.id)).toEqual(["root"]);
});

test("outline view model temporarily expands collapsed items", () => {
	const snapshot = outline([item("root", null, 1, { collapsed: true }), item("child", "root", 2)]);

	expect(rows(snapshot, { transientExpandedIds: ["root"] }).map((row) => row.item.id)).toEqual([
		"root",
		"child",
	]);
});

test("outline view model appends stash rows after ordinary rows", () => {
	const snapshot = outline(
		[item("stash-later", null, 30), item("ordinary", null, 20), item("stash-first", null, 10)],
		["stash-later", "stash-first"],
	);

	expect(rows(snapshot).map(rowSummary)).toEqual([
		["ordinary", 0, false, false],
		["stash-first", 0, false, true],
		["stash-later", 0, false, true],
	]);
});

test("outline view model does not show stash rows in a hoisted view", () => {
	const snapshot = outline([item("root", null, 1), item("stash", null, 2)], ["stash"]);
	const projection = project(snapshot, ["root"]);

	expect(rows(snapshot, { projection, showStash: false }).map((row) => row.item.id)).toEqual([
		"root",
	]);
});

test("outline view model treats reference stubs as leaves", () => {
	const snapshot = outline([
		item("stub", null, 1, { referenceStub: true }),
		item("hidden-child", "stub", 2),
	]);

	expect(rows(snapshot).map(rowSummary)).toEqual([["stub", 0, false, false]]);
});

test("outline view model follows only projection roots and items", () => {
	const snapshot = outline([
		item("outside", null, 1),
		item("hoist", "outside", 2),
		item("inside", "hoist", 3),
	]);
	const projection = project(snapshot, ["hoist", "inside"], ["hoist"]);

	expect(rows(snapshot, { projection, showStash: false }).map(rowSummary)).toEqual([
		["hoist", 0, true, false],
		["inside", 1, false, false],
	]);
});

test("outline view model is read-only and ignores missing projection roots", () => {
	const snapshot = outline([item("root", null, 1)]);
	const projection = project(snapshot, ["root"], ["missing", "root"]);
	const beforeSnapshot = structuredClone(snapshot);
	const beforeProjection = structuredClone(projection);

	const result = buildVisibleRows(snapshot, projection, [], true);

	expect(result.map((row) => row.item.id)).toEqual(["root"]);
	expect(snapshot).toEqual(beforeSnapshot);
	expect(projection).toEqual(beforeProjection);
	expect(result[0].item).toBe(snapshot.items[0]);
});

test("outline view model handles deep trees without call stack overflow", () => {
	const depth = 10_000;
	const items: OutlineItem[] = [];
	for (let i = 0; i < depth; i++) {
		items.push(item(`node-${i}`, i === 0 ? null : `node-${i - 1}`, i + 1));
	}
	const snapshot = outline(items);
	const res = rows(snapshot);
	expect(res.length).toEqual(depth);
	expect(res[0].item.id).toEqual("node-0");
	expect(res[depth - 1].item.id).toEqual(`node-${depth - 1}`);
	expect(res[depth - 1].depth).toEqual(depth - 1);
});

test("outline view model efficiently handles 5,000 root items", () => {
	const count = 5_000;
	const items: OutlineItem[] = [];
	for (let i = 0; i < count; i++) {
		items.push(item(`root-${i}`, null, i + 1));
	}
	const snapshot = outline(items);
	const res = rows(snapshot);
	expect(res.length).toEqual(count);
});

function rows(
	snapshot: OutlineSnapshot,
	options: {
		projection?: BrowsingOutlineProjection;
		transientExpandedIds?: readonly string[];
		showStash?: boolean;
	} = {},
) {
	return buildVisibleRows(
		snapshot,
		options.projection ?? project(snapshot),
		options.transientExpandedIds ?? [],
		options.showStash ?? true,
	);
}

function rowSummary(row: ReturnType<typeof rows>[number]) {
	return [row.item.id, row.depth, row.hasChildren, row.stash];
}

function project(
	snapshot: OutlineSnapshot,
	items = snapshot.items.map((item) => item.id),
	rootOccurrenceIds = snapshot.items
		.filter((item) => item.parentId === null)
		.map((item) => item.id),
): BrowsingOutlineProjection {
	const included = new Set(items);
	return {
		items: snapshot.items.filter((item) => included.has(item.id)),
		rootOccurrenceIds,
		breadcrumb: [],
	};
}

function outline(items: OutlineItem[], stashItemIds: string[] = []): OutlineSnapshot {
	return { items, links: [], knots: [], stashItemIds };
}

function item(
	id: string,
	parentId: string | null,
	orderKey: number,
	options: { collapsed?: boolean; referenceStub?: boolean } = {},
): OutlineItem {
	return {
		id,
		workId: id,
		text: id,
		parentId,
		orderKey,
		collapsed: options.collapsed ?? false,
		revisionSelector: { mode: "branch", branchId: `${id}-branch` },
		...(options.referenceStub ? { referenceStub: true } : {}),
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
	};
}
