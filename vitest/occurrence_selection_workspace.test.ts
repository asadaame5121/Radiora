import { expect, test, vi } from "vitest";
import type { OutlineItem, OutlineSnapshot } from "../src/domain/models.ts";
import { createNavigationController } from "../src/ui/navigation_controller.svelte.ts";
import { HistoricalTimeController } from "../src/ui/historical_time_controller.svelte.ts";
import { OccurrenceSelectionWorkspace } from "../src/ui/occurrence_selection_workspace.ts";
import { KeyboardWorkspaceController } from "../src/ui/keyboard_workspace_controller.svelte.ts";

function item(id: string, workId = id, parentId: string | null = null): OutlineItem {
	return {
		id,
		workId,
		parentId,
		text: id,
		orderKey: 0,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: `${workId}-main` },
		createdAt: "2026-10-04T00:00:00Z",
		updatedAt: "2026-10-04T00:00:00Z",
	};
}

function setup() {
	let selectedId: string | null = "a";
	let visible = true;
	let expanded = ["a"];
	let snapshot: OutlineSnapshot = {
		items: [item("a"), item("b", "b", "a"), item("c"), item("mirror", "a")],
		links: [],
		knots: [],
		stashItemIds: [],
	};
	const navigation = createNavigationController({
		initialLocation: { selectedOccurrenceId: "a", hoistOccurrenceId: "a" },
	});
	const save = vi.fn(async () => undefined);
	const form = new HistoricalTimeController({
		save,
		reload: async () => selection.reconcile(),
		select: vi.fn(),
	});
	form.reset(snapshot.items[0]);
	const clearCompletions = vi.fn();
	const interruptNavigation = vi.fn();
	const capturePanels = vi.fn();
	const restorePane = vi.fn(async (_id: string | null, _current: () => boolean) => undefined);
	const reportError = vi.fn();
	const selection = new OccurrenceSelectionWorkspace({
		current: () => selectedId,
		publish: (id) => selectedId = id,
		snapshot: () => snapshot,
		publishStartupSnapshot: (next) => snapshot = next,
		clearCompletions,
		interruptNavigation,
		form,
		reportError,
		outline: {
			visible: () => visible,
			browsing: () => navigation.captureBrowsing(),
			publishBrowsing: (next) => navigation.commitBrowsing(next),
			expanded: () => expanded,
			publishExpanded: (next) => expanded = next,
			capturePanels,
			restorePane,
		},
	});
	return {
		selection,
		navigation,
		form,
		save,
		clearCompletions,
		capturePanels,
		restorePane,
		reportError,
		interruptNavigation,
		selected: () => selectedId,
		expanded: () => expanded,
		snapshot: () => snapshot,
		replace: (items: OutlineItem[]) => snapshot = { ...snapshot, items },
		hide: () => visible = false,
		dirty: () => {
			form.draft.start.year = "2026";
			form.draft.original = "unsaved";
		},
		addPane: (id = "b") => {
			const pane = navigation.addBrowsingPane();
			navigation.browseToOccurrence(snapshot, id);
			navigation.activateBrowsingPane("pane-1", snapshot);
			return pane;
		},
	};
}

test.each(["save", "discard", "cancel"] as const)(
	"Zoom Out changes selection, scope and focus only after %s accepts its guard",
	async (choice) => {
		const s = setup();
		s.selection.select("b");
		s.dirty();
		const focus = vi.fn();
		const keyboard = new KeyboardWorkspaceController({
			selectedId: s.selected,
			hoistId: () => s.navigation.browsingLocation.hoistOccurrenceId,
			view: () => "outline",
			navigation: { origin: 0, navigate: vi.fn() },
			longFormActive: () => false,
			select: (id, after) => s.selection.select(id, after),
			focus,
			setHoist: (id) => s.selection.setHoist(id),
			projection: vi.fn(),
			items: () => s.snapshot().items,
			clearTemporaryExpansion: vi.fn(),
			setCollapsed: vi.fn(),
			reload: vi.fn(),
		});
		await keyboard.zoomOut();
		expect(s.selected()).toBe("b");
		expect(s.navigation.browsingLocation.hoistOccurrenceId).toBe("a");
		expect(focus).not.toHaveBeenCalled();
		await s.form.resolvePending(choice);
		await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(choice === "cancel" ? 0 : 1));
		expect(s.selected()).toBe(choice === "cancel" ? "b" : "a");
		expect(s.navigation.browsingLocation.hoistOccurrenceId).toBe(choice === "cancel" ? "a" : null);
		expect(s.navigation.browsingLocation.selectedOccurrenceId).toBe(s.selected());
	},
);

test("accepted direct selection synchronously aligns the form and pane before its callback", () => {
	const s = setup();
	const after = vi.fn(() => {
		expect(s.selected()).toBe("b");
		expect(s.navigation.browsingLocation.selectedOccurrenceId).toBe("b");
		expect(s.navigation.browsingLocation.hoistOccurrenceId).toBe("a");
		expect(s.form.item?.id).toBe("b");
		expect(s.clearCompletions).toHaveBeenCalledOnce();
	});
	expect(s.selection.select("b", after)).toBe(true);
	expect(after).toHaveBeenCalledOnce();
});

test.each(["save", "discard", "cancel"] as const)(
	"direct selection waits for %s before publishing",
	async (choice) => {
		const s = setup();
		s.dirty();
		const after = vi.fn();
		expect(s.selection.select("b", after)).toBe(false);
		expect(s.selected()).toBe("a");
		expect(s.form.item?.id).toBe("a");
		expect(s.navigation.browsingLocation.selectedOccurrenceId).toBe("a");
		await s.form.resolvePending(choice);
		await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(choice === "cancel" ? 0 : 1));
		expect(s.selected()).toBe(choice === "cancel" ? "a" : "b");
		expect(s.form.item?.id).toBe(s.selected());
		expect(s.navigation.browsingLocation.selectedOccurrenceId).toBe(s.selected());
	},
);

test("save failure keeps selection, pane, form draft and pending guard until retry", async () => {
	const s = setup();
	s.dirty();
	s.save.mockRejectedValueOnce(new Error("offline"));
	s.selection.select("b");
	await s.form.resolvePending("save");
	expect(s.selected()).toBe("a");
	expect(s.navigation.browsingLocation.selectedOccurrenceId).toBe("a");
	expect(s.form.draft.original).toBe("unsaved");
	expect(s.form.error).toBe("offline");
	expect(s.clearCompletions).not.toHaveBeenCalled();
	await s.form.resolvePending("save");
	await vi.waitFor(() => expect(s.selected()).toBe("b"));
});

test("a superseded guard cannot publish its selection or callback", async () => {
	const s = setup();
	s.dirty();
	const old = vi.fn(), latest = vi.fn();
	s.selection.select("b", old);
	s.selection.select("c", latest);
	await s.form.resolvePending("discard");
	await vi.waitFor(() => expect(latest).toHaveBeenCalledOnce());
	expect(old).not.toHaveBeenCalled();
	expect(s.selected()).toBe("c");
	expect(s.navigation.browsingLocation.hoistOccurrenceId).toBeNull();
});

test("same-Work mirrors preserve their shared dirty form and invalidate completion", () => {
	const s = setup();
	s.dirty();
	expect(s.selection.select("mirror")).toBe(true);
	expect(s.form.item?.id).toBe("mirror");
	expect(s.form.draft.original).toBe("unsaved");
	expect(s.form.dirty).toBe(true);
	expect(s.form.pending).toBeNull();
	expect(s.clearCompletions).toHaveBeenCalledOnce();
});

test("Tree selection leaves the suspended Outline pane and Hoist untouched", () => {
	const s = setup();
	const browsing = s.navigation.captureBrowsing();
	s.hide();
	s.selection.select("c");
	expect(s.selected()).toBe("c");
	expect(s.form.item?.id).toBe("c");
	expect(s.navigation.captureBrowsing()).toEqual(browsing);
});

test("blank deselection releases focus only after accepting its guard", async () => {
	const s = setup();
	s.dirty();
	const blur = vi.fn();
	s.selection.select(null, blur);
	await s.form.resolvePending("cancel");
	expect(blur).not.toHaveBeenCalled();
	s.selection.select(null, blur);
	await s.form.resolvePending("discard");
	await vi.waitFor(() => expect(blur).toHaveBeenCalledOnce());
	expect(s.selected()).toBeNull();
	expect(s.navigation.browsingLocation.selectedOccurrenceId).toBeNull();
});

test("reload deletion corrects IDs and expansion without resurrecting or discarding the form draft", async () => {
	const s = setup();
	s.dirty();
	s.selection.select("c");
	s.replace(s.snapshot().items.filter((value) => value.id !== "a"));
	s.selection.reconcile();
	expect(s.selected()).toBeNull();
	expect(s.navigation.browsingLocation).toEqual({
		selectedOccurrenceId: null,
		hoistOccurrenceId: null,
	});
	expect(s.expanded()).toEqual([]);
	expect(s.form.item?.id).toBe("a");
	expect(s.form.draft.original).toBe("unsaved");
	expect(s.form.pending).toBeNull();
	s.save.mockRejectedValueOnce(new Error("Work no longer exists"));
	s.selection.select("c");
	await s.form.resolvePending("save");
	expect(s.selected()).toBeNull();
	expect(s.form.dirty).toBe(true);
	expect(s.form.error).toBe("Work no longer exists");
});

test("reload preserves current drafts/text and synchronizes clean form metadata without a guard", () => {
	const s = setup();
	const historicalTime = {
		kind: "point",
		date: { precision: "year", year: 1700, approximate: false },
	} as const;
	s.replace(
		s.snapshot().items.map((value) =>
			value.id === "a" ? { ...value, text: "editor draft", historicalTime } : value
		),
	);
	s.selection.reconcile();
	expect(s.snapshot().items[0].text).toBe("editor draft");
	expect(s.form.draft.start.year).toBe("1700");
	expect(s.form.pending).toBeNull();
	expect(s.selected()).toBe("a");
	expect(s.clearCompletions).toHaveBeenCalledOnce();
});

test("a deleted destination cannot be selected by a pending approval", async () => {
	const s = setup();
	s.dirty();
	const after = vi.fn();
	s.selection.select("b", after);
	s.replace(s.snapshot().items.filter((value) => value.id !== "b"));
	s.selection.reconcile();
	await s.form.resolvePending("discard");
	await Promise.resolve();
	expect(s.selected()).toBe("a");
	expect(s.form.item?.id).toBe("a");
	expect(after).not.toHaveBeenCalled();
});

test("pane switch validates the pane and atomically commits its guarded selection and expansion", async () => {
	const s = setup();
	const pane = s.addPane();
	s.dirty();
	expect(s.selection.switchPane("missing")).toBe(false);
	expect(s.form.pending).toBeNull();
	expect(s.selection.switchPane(pane)).toBe(false);
	expect(s.navigation.browsing.activePaneId).toBe("pane-1");
	await s.form.resolvePending("discard");
	await vi.waitFor(() => expect(s.navigation.browsing.activePaneId).toBe(pane));
	expect(s.selected()).toBe("b");
	expect(s.expanded()).toEqual(["a"]);
	expect(s.form.item?.id).toBe("b");
	expect(s.clearCompletions).toHaveBeenCalledOnce();
	expect(s.capturePanels).toHaveBeenCalledOnce();
	expect(s.restorePane).toHaveBeenCalledOnce();
});

test("pane focus and caret receipts expire even when selection returns to the same ID", () => {
	const s = setup();
	const pane = s.addPane();
	s.selection.switchPane(pane);
	const current = s.restorePane.mock.calls[0][1];
	expect(current()).toBe(true);
	s.selection.select("c");
	s.selection.select("b");
	expect(current()).toBe(false);
});

test("Hoist scope changes preserve the accepted global selection and pane alignment", () => {
	const s = setup();
	s.selection.select("b");
	s.selection.setHoist(null);
	s.selection.setHoist("a");
	expect(s.selected()).toBe("b");
	expect(s.navigation.browsingLocation).toEqual({
		selectedOccurrenceId: "b",
		hoistOccurrenceId: "a",
	});
});

test("prepared screen commits do not add a second browsing history entry", () => {
	const s = setup();
	s.navigation.browseToOccurrence(s.snapshot(), "b");
	const history = s.navigation.browsingPane.history;
	s.selection.commitPrepared("b", s.snapshot().items[1]);
	expect(s.selected()).toBe("b");
	expect(s.form.item?.id).toBe("b");
	expect(s.navigation.browsingPane.history).toEqual(history);
});

test("startup restoration initializes only a current untouched session", () => {
	const s = setup();
	const location = { selectedOccurrenceId: "b", hoistOccurrenceId: "a" };
	expect(s.selection.restoreInitial(s.snapshot(), location, () => false)).toBe(false);
	expect(s.selected()).toBe("a");
	expect(s.selection.restoreInitial(s.snapshot(), location, () => true)).toBe(true);
	expect(s.selected()).toBe("b");
	expect(s.form.item?.id).toBe("b");
	expect(s.navigation.browsingLocation).toEqual(location);
	s.selection.select("c");
	expect(s.selection.restoreInitial(s.snapshot(), location, () => true)).toBe(false);
	expect(s.selected()).toBe("c");
});

test("cancelled user requests and formal reload close startup restoration authority", async () => {
	const s = setup();
	s.dirty();
	s.selection.select("b");
	await s.form.resolvePending("cancel");
	expect(
		s.selection.restoreInitial(
			s.snapshot(),
			{ selectedOccurrenceId: "c", hoistOccurrenceId: null },
			() => true,
		),
	).toBe(false);
	const untouched = setup();
	untouched.selection.reconcile();
	expect(
		untouched.selection.restoreInitial(untouched.snapshot(), {
			selectedOccurrenceId: "c",
			hoistOccurrenceId: null,
		}, () => true),
	).toBe(false);
});

test("dispose cancels pending approvals, receipts and future publication", async () => {
	const s = setup();
	s.dirty();
	s.selection.select("b");
	const current = s.selection.currentReceipt();
	s.selection.dispose();
	await s.form.resolvePending("discard");
	expect(s.selected()).toBe("a");
	expect(current()).toBe(false);
	expect(s.selection.select("c")).toBe(false);
	s.selection.commitPrepared(null, null);
	s.selection.reconcile();
	expect(s.selected()).toBe("a");
});

test("startup cache cannot replace an existing historical draft even before a selection request", () => {
	const s = setup();
	s.dirty();
	expect(
		s.selection.restoreInitial(
			s.snapshot(),
			{ selectedOccurrenceId: "b", hoistOccurrenceId: "a" },
			() => true,
		),
	).toBe(false);
	expect(s.selected()).toBe("a");
	expect(s.form.draft.original).toBe("unsaved");
});
