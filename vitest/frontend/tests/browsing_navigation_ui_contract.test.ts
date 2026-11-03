import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
test("App exposes browsing scope, breadcrumb, and recent-edit navigation", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const outlineView = await readFile(
		new URL("../../../src/ui/OutlineView.svelte", import.meta.url),
		"utf8",
	);
	const outlineRowItem = await readFile(
		new URL("../../../src/ui/OutlineRowItem.svelte", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/navigation_controller.svelte.ts", import.meta.url),
		"utf8",
	);

	expect(app.includes("createNavigationController")).toBeTruthy();
	expect(app.includes("navigationController.projectBrowsing(snapshot)")).toBeTruthy();
	expect(app.includes("$derived(navigationController.browsingLocation)")).toBeTruthy();
	expect(app.includes("$derived(navigationController.browsingPane)")).toBeTruthy();
	expect(outlineView.includes("vocabulary.breadcrumb")).toBeTruthy();
	expect(outlineView.includes("vocabulary.hoist")).toBeTruthy();
	expect(outlineView.includes("onClearHoist")).toBeTruthy();
	expect(outlineRowItem.includes("vocabulary.work")).toBeTruthy();
	expect(app.includes("recentEditedItems")).toBeTruthy();
	expect(app.includes("openRecentItem")).toBeTruthy();
	expect(app.includes("outlineContextTitle")).toBeTruthy();
	expect(app.includes("goBrowsingHistory(-1)")).toBe(false);
	expect(app.includes("goBrowsingHistory(1)")).toBe(false);
	expect(app.includes("createBrowsingNavigationState(")).toBe(false);
	expect(app.includes("projectBrowsingOutline(")).toBe(false);

	expect(controller.includes("createBrowsingNavigationState(")).toBeTruthy();
	expect(controller.includes("projectBrowsingOutline(")).toBeTruthy();
	expect(controller.includes("openBrowsingPane(")).toBeTruthy();
	expect(controller.includes("activateBrowsingPane(")).toBeTruthy();
});

test("App delegates browsing transitions without persisting expansion or placement", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	const selection = await readFile(
		new URL("../../../src/ui/occurrence_selection_workspace.ts", import.meta.url),
		"utf8",
	);
	const controller = await readFile(
		new URL("../../../src/ui/navigation_controller.svelte.ts", import.meta.url),
		"utf8",
	);
	const selectItem = app.slice(
		app.indexOf("function selectItem"),
		app.indexOf("async function loadEmergence"),
	);
	const browsingControls = app.slice(
		app.indexOf("function selectOccurrence"),
		app.indexOf("// Side-effect boundary: view/selected Work/filter changes"),
	);

	expect(selectItem.includes("expandedIds: ancestorIds")).toBeTruthy();
	expect(selectItem.includes("screenNavigation.navigate")).toBeTruthy();
	expect(selectItem.includes("api.setCollapsed")).toBe(false);
	expect(browsingControls.includes("selectionWorkspace.select(id, afterSelection)")).toBeTruthy();
	expect(browsingControls.includes("selectionWorkspace.switchPane(paneId)")).toBeTruthy();
	expect(
		selection.includes("browseToOutlineOccurrence(this.ports.outline.browsing(), snapshot, id)"),
	).toBeTruthy();
	expect(selection.includes("activateBrowsingPane(state, paneId)")).toBeTruthy();
	expect(browsingControls.includes("navigationController.addBrowsingPane()")).toBeTruthy();
	const hoistSelected = browsingControls.slice(
		browsingControls.indexOf("function hoistSelected"),
		browsingControls.indexOf("function clearHoist"),
	);
	expect(hoistSelected.includes("outlineDisplay.expand(selectedId)")).toBeTruthy();
	expect(hoistSelected.includes("selectedId")).toBeTruthy();
	expect(hoistSelected.includes("selectionWorkspace.setHoist(selectedId)")).toBeTruthy();
	expect(hoistSelected.includes("setCollapsed")).toBe(false);
	expect(browsingControls.includes("api.")).toBe(false);
	expect(browsingControls.includes("browseToOutlineOccurrence(")).toBe(false);
	expect(browsingControls.includes("reconcileBrowsingState(")).toBe(false);
	expect(browsingControls.includes("parentId =")).toBe(false);
	expect(browsingControls.includes("orderKey =")).toBe(false);
	expect(browsingControls.includes("collapsed =")).toBe(false);

	expect(
		controller.includes("browseToOutlineOccurrence(browsing, snapshot, occurrenceId)"),
	).toBeTruthy();
	expect(controller.includes("reconcileBrowsingState(browsing, snapshot)")).toBeTruthy();
	expect(controller.includes("setBrowsingHoist(browsing, occurrenceId)")).toBeTruthy();
	expect(controller.includes("api.")).toBe(false);
});

test("reload delegates focus publication to the Outline owner with both receipts", async () => {
	const app = await readFile(new URL("../../../src/ui/App.svelte", import.meta.url), "utf8");
	expect(app).toMatch(/return outlineController\.reload\(\{/);
	expect(app).toMatch(/selectionReceipt: \(\) => selectionWorkspace\.currentReceipt\(\)/);
	expect(app).toMatch(
		/focus: \(id, reloadCurrent\) => selectOccurrence\(id, \(selectionCurrent\) => requestFocus\(id, undefined, \(\) => reloadCurrent\(\) && selectionCurrent\(\)\)\)/,
	);
});
