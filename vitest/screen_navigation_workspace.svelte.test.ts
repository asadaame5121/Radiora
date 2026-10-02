import { afterEach, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { createBrowsingNavigationState } from "../src/services/browsing_navigation_state.ts";
import { ScreenNavigationWorkspace } from "../src/ui/screen_navigation_workspace.svelte.ts";

vi.mock("svelte", () => ({ tick: vi.fn(async () => undefined) }));

afterEach(() => {
	vi.mocked(tick).mockReset();
	vi.unstubAllGlobals();
});

function setup() {
	vi.stubGlobal("CSS", { escape: (value: string) => value });
	vi.stubGlobal("document", { querySelector: vi.fn().mockReturnValue(null) });
	const browsing = {
		captureBrowsing: () =>
			createBrowsingNavigationState("pane-2", {
				selectedOccurrenceId: "selected",
				hoistOccurrenceId: "root",
			}),
		restore: vi.fn().mockReturnValue(true),
	};
	let filter = { freeText: "original", tagsAll: "", tagsNone: "" };
	let expanded = ["root", "deleted"];
	let inspector = { mode: "history" as "history" | "query", collapsed: false };
	const comparison = {
		captureNavigationContext: vi.fn(() => ({
			preferredRevisionId: "revision",
			link: null,
			work: null,
		})),
		restoreNavigationContext: vi.fn(),
	};
	const editor = {
		save: vi.fn().mockResolvedValue(true),
		flush: vi.fn().mockResolvedValue(undefined),
		longFormActive: () => false,
	};
	const workspace = new ScreenNavigationWorkspace({
		browsing,
		comparison,
		editor,
		selection: { current: () => "selected", hasItem: (id) => id !== "deleted" },
		outline: {
			filter: () => filter,
			setFilter: (next) => filter = next,
			expanded: () => expanded,
			setExpanded: (next) => expanded = next,
		},
		inspector: {
			capture: () => inspector,
			restore: (next) => inspector = next as typeof inspector,
		},
	});
	return {
		workspace,
		browsing,
		editor,
		comparison,
		changeFilter: (text = "changed") => filter.freeText = text,
		resetFilter: () => filter = { freeText: "", tagsAll: "", tagsNone: "" },
		filter: () => filter,
		expanded: () => expanded,
		inspector: () => inspector,
	};
}

test("workspace restores isolated screen context through feature ports", async () => {
	const { workspace, browsing, comparison, changeFilter, filter, expanded } = setup();
	workspace.open("options");
	changeFilter();
	await workspace.goBack();
	expect(browsing.restore).toHaveBeenCalledWith(createBrowsingNavigationState("pane-2", {
		selectedOccurrenceId: "selected",
		hoistOccurrenceId: "root",
	}));
	expect(filter().freeText).toBe("original");
	expect(expanded()).toEqual(["root"]);
	expect(comparison.restoreNavigationContext).toHaveBeenCalledWith({
		preferredRevisionId: "revision",
		link: null,
		work: null,
	});
});

test("saved filters survive the destination screen's reset effect", async () => {
	const { workspace, changeFilter, resetFilter, filter } = setup();
	changeFilter("saved filter");
	filter().tagsAll = "#keep";
	filter().tagsNone = "#exclude";
	workspace.open("options");
	resetFilter();
	// Model App's view-dependent reset at the transition's next render flush.
	vi.mocked(tick).mockImplementationOnce(async () => {
		expect(workspace.view).toBe("outline");
		resetFilter();
	});
	await workspace.goBack();
	expect(filter()).toEqual({ freeText: "saved filter", tagsAll: "#keep", tagsNone: "#exclude" });
});

test("failed save or guarded browsing leaves the screen history available", async () => {
	const { workspace, browsing, editor, comparison } = setup();
	workspace.open("options");
	editor.save.mockResolvedValueOnce(false);
	await workspace.goBack();
	expect(browsing.restore).not.toHaveBeenCalled();
	browsing.restore.mockReturnValueOnce(false);
	await workspace.goBack();
	expect(comparison.restoreNavigationContext).not.toHaveBeenCalled();
	expect(workspace.view).toBe("options");
	expect(workspace.canGoBack).toBe(true);
});

test("Query remembers and restores the inspector without duplicate entries", async () => {
	const { workspace, inspector } = setup();
	workspace.openInspectorTool("query", false);
	workspace.openInspectorTool("query", false);
	expect(inspector().mode).toBe("query");
	await workspace.goBack();
	expect(inspector().mode).toBe("history");
	expect(workspace.canGoBack).toBe(false);
});

test("tree focus prioritizes the selected node and falls back when none is selected", async () => {
	const { workspace } = setup();
	const selected = { focus: vi.fn() };
	const first = { focus: vi.fn() };
	const query = vi.fn((selector: string) => selector === ".tree-node.selected" ? selected : first);
	vi.stubGlobal("document", { querySelector: query });
	workspace.open("globalLineage");
	workspace.open("help");
	await workspace.goBack();
	expect(selected.focus).toHaveBeenCalledOnce();
	expect(first.focus).not.toHaveBeenCalled();
	query.mockImplementation((selector) => selector === ".tree-node.selected" ? null : first);
	workspace.open("help");
	await workspace.goBack();
	expect(first.focus).toHaveBeenCalledOnce();
});
