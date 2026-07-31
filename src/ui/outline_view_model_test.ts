// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals, assertStrictEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import type { BrowsingOutlineProjection } from "../services/browsing_navigation_state.ts";
import { buildVisibleRows } from "./outline_view_model.ts";

Deno.test("outline view model orders roots and children by orderKey", () => {
	const snapshot = outline([
		item("root-later", null, 20),
		item("child-later", "root-first", 11),
		item("root-first", null, 10),
		item("child-first", "root-first", 1),
	]);

	assertEquals(rows(snapshot).map(rowSummary), [
		["root-later", 0, false, false],
		["root-first", 0, true, false],
		["child-first", 1, false, false],
		["child-later", 1, false, false],
	]);
});

Deno.test("outline view model hides descendants of collapsed items", () => {
	const snapshot = outline([item("root", null, 1, { collapsed: true }), item("child", "root", 2)]);

	assertEquals(rows(snapshot).map((row) => row.item.id), ["root"]);
});

Deno.test("outline view model temporarily expands collapsed items", () => {
	const snapshot = outline([item("root", null, 1, { collapsed: true }), item("child", "root", 2)]);

	assertEquals(rows(snapshot, { transientExpandedIds: ["root"] }).map((row) => row.item.id), [
		"root",
		"child",
	]);
});

Deno.test("outline view model appends stash rows after ordinary rows", () => {
	const snapshot = outline([
		item("stash-later", null, 30),
		item("ordinary", null, 20),
		item("stash-first", null, 10),
	], ["stash-later", "stash-first"]);

	assertEquals(rows(snapshot).map(rowSummary), [
		["ordinary", 0, false, false],
		["stash-first", 0, false, true],
		["stash-later", 0, false, true],
	]);
});

Deno.test("outline view model does not show stash rows in a hoisted view", () => {
	const snapshot = outline([item("root", null, 1), item("stash", null, 2)], ["stash"]);
	const projection = project(snapshot, ["root"]);

	assertEquals(rows(snapshot, { projection, showStash: false }).map((row) => row.item.id), [
		"root",
	]);
});

Deno.test("outline view model treats reference stubs as leaves", () => {
	const snapshot = outline([
		item("stub", null, 1, { referenceStub: true }),
		item("hidden-child", "stub", 2),
	]);

	assertEquals(rows(snapshot).map(rowSummary), [["stub", 0, false, false]]);
});

Deno.test("outline view model follows only projection roots and items", () => {
	const snapshot = outline([
		item("outside", null, 1),
		item("hoist", "outside", 2),
		item("inside", "hoist", 3),
	]);
	const projection = project(snapshot, ["hoist", "inside"], ["hoist"]);

	assertEquals(rows(snapshot, { projection, showStash: false }).map(rowSummary), [
		["hoist", 0, true, false],
		["inside", 1, false, false],
	]);
});

Deno.test("outline view model is read-only and ignores missing projection roots", () => {
	const snapshot = outline([item("root", null, 1)]);
	const projection = project(snapshot, ["root"], ["missing", "root"]);
	const beforeSnapshot = structuredClone(snapshot);
	const beforeProjection = structuredClone(projection);

	const result = buildVisibleRows(snapshot, projection, [], true);

	assertEquals(result.map((row) => row.item.id), ["root"]);
	assertEquals(snapshot, beforeSnapshot);
	assertEquals(projection, beforeProjection);
	assertStrictEquals(result[0].item, snapshot.items[0]);
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
	rootOccurrenceIds = snapshot.items.filter((item) => item.parentId === null).map((item) =>
		item.id
	),
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
