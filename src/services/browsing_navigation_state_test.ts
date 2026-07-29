import { assertEquals, assertNotStrictEquals } from "jsr:@std/assert@1";
import type { OutlineItem, OutlineSnapshot } from "../domain/models.ts";
import {
	activateBrowsingPane,
	ancestorBreadcrumb,
	browseToOccurrence,
	browseToOutlineOccurrence,
	canMoveBrowsingHistory,
	createBrowsingNavigationState,
	currentBrowsingLocation,
	moveBrowsingHistory,
	openBrowsingPane,
	projectBrowsingOutline,
	reconcileBrowsingState,
	setBrowsingHoist,
} from "./browsing_navigation_state.ts";

Deno.test("browsing history goes back and forward and truncates its forward branch", () => {
	let state = createBrowsingNavigationState();
	state = browseToOccurrence(state, "one");
	state = browseToOccurrence(state, "two");
	state = moveBrowsingHistory(state, -1);
	assertEquals(currentBrowsingLocation(state).selectedOccurrenceId, "one");
	assertEquals(canMoveBrowsingHistory(state, 1), true);

	state = browseToOccurrence(state, "three");
	assertEquals(currentBrowsingLocation(state).selectedOccurrenceId, "three");
	assertEquals(canMoveBrowsingHistory(state, 1), false);
	assertEquals(state.panes[0].history.map((entry) => entry.selectedOccurrenceId), [
		null,
		"one",
		"three",
	]);
});

Deno.test("opening an occurrence outside the active hoist clears hoist without hiding selection", () => {
	const snapshot = outline();
	let state = browseToOccurrence(createBrowsingNavigationState(), "child");
	state = setBrowsingHoist(state, "child");
	state = browseToOutlineOccurrence(state, snapshot, "leaf");
	assertEquals(currentBrowsingLocation(state), {
		selectedOccurrenceId: "leaf",
		hoistOccurrenceId: "child",
	});

	state = browseToOutlineOccurrence(state, snapshot, "other");
	assertEquals(currentBrowsingLocation(state), {
		selectedOccurrenceId: "other",
		hoistOccurrenceId: null,
	});
});

Deno.test("reconciliation clears deleted selections and dangling hoist roots", () => {
	let state = browseToOccurrence(createBrowsingNavigationState(), "child");
	state = setBrowsingHoist(state, "child");
	const snapshot = outline();
	snapshot.items = snapshot.items.filter((item) => item.id !== "child");
	state = reconcileBrowsingState(state, snapshot);
	assertEquals(currentBrowsingLocation(state), {
		selectedOccurrenceId: null,
		hoistOccurrenceId: null,
	});
});

Deno.test("each browsing pane retains an independent location and history", () => {
	let state = browseToOccurrence(createBrowsingNavigationState("left"), "left-one");
	state = openBrowsingPane(state, "right");
	state = browseToOccurrence(state, "right-two");
	state = activateBrowsingPane(state, "left");
	assertEquals(currentBrowsingLocation(state).selectedOccurrenceId, "left-one");
	assertEquals(canMoveBrowsingHistory(state, -1), true);

	state = activateBrowsingPane(state, "right");
	assertEquals(currentBrowsingLocation(state).selectedOccurrenceId, "right-two");
	state = moveBrowsingHistory(state, -1);
	assertEquals(currentBrowsingLocation(state).selectedOccurrenceId, "left-one");
});

Deno.test("breadcrumb and hoist projection are read-only views of the outline snapshot", () => {
	const snapshot = outline();
	const before = structuredClone(snapshot);
	const projection = projectBrowsingOutline(snapshot, "child");

	assertEquals(projection.rootOccurrenceIds, ["child"]);
	assertEquals(projection.items.map((item) => item.id), ["child", "leaf"]);
	assertEquals(projection.breadcrumb.map((item) => item.id), ["root"]);
	assertEquals(ancestorBreadcrumb(snapshot, "leaf").map((item) => item.id), ["root", "child"]);
	assertEquals(snapshot, before);
	assertNotStrictEquals(projection.items, snapshot.items);
	assertEquals(projection.items[0], snapshot.items[1]);
});

Deno.test("all browsing operations leave content and persisted placement fields untouched", () => {
	const snapshot = outline();
	const before = structuredClone(snapshot);
	let state = createBrowsingNavigationState();
	state = browseToOccurrence(state, "leaf");
	state = setBrowsingHoist(state, "child");
	state = moveBrowsingHistory(state, -1);
	state = moveBrowsingHistory(state, 1);
	state = openBrowsingPane(state, "second");
	state = activateBrowsingPane(state, "pane-1");
	projectBrowsingOutline(snapshot, currentBrowsingLocation(state).hoistOccurrenceId);

	assertEquals(snapshot, before);
	assertEquals(snapshot.items.map(persistedFields), before.items.map(persistedFields));
});

function persistedFields(item: OutlineItem) {
	return {
		text: item.text,
		parentId: item.parentId,
		orderKey: item.orderKey,
		collapsed: item.collapsed,
		revisionSelector: item.revisionSelector,
	};
}

function outline(): OutlineSnapshot {
	return {
		items: [
			item("root", null, 1, true),
			item("child", "root", 2, true),
			item("leaf", "child", 3, false),
			item("other", null, 4, false),
		],
		links: [],
		knots: [],
		stashItemIds: [],
	};
}

function item(
	id: string,
	parentId: string | null,
	orderKey: number,
	collapsed: boolean,
): OutlineItem {
	return {
		id,
		workId: id,
		text: `${id} body`,
		parentId,
		orderKey,
		collapsed,
		revisionSelector: { mode: "branch", branchId: id },
		createdAt: "2026-07-29T00:00:00.000Z",
		updatedAt: "2026-07-29T00:00:00.000Z",
	};
}
